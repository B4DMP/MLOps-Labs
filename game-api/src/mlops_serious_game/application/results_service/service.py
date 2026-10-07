"""Loads one run's rows and turns them into the results payload (docs/plans/results-screen.md).

The database half of the results service. Everything that decides a number lives in `compute`,
which is pure; this module's only job is to fetch the right rows for the right run and hand them
over. Keeping the split sharp is what lets the grade be tested on hand-built inputs.

Reads are scoped by the run chain, so a fresh start reports on itself alone while a next
iteration reports on the system it carried forward, and a finished run can always be re-read by
passing its `run_index`.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.application.event_log_service import store as event_store
from mlops_serious_game.application.event_log_service.serialize import serialize_event
from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.graph_state_view import build_graph_state
from mlops_serious_game.application.graph_service.phase_stage import stage_for_phase
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.application.results_service import compute
from mlops_serious_game.domain.epilogue_factory import epilogue_for
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.pattern import PatternFactory
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.domain.requirement import StakeholderIntelItem
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.setting_factory import SettingFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import (
    Campaign,
    GameChallenge,
    GameProgression,
    GameResult,
    GameSession,
    User,
)
from mlops_serious_game.infrastructure.database.run_scope import (
    current_run_index,
    parent_run,
    run_chain,
)

# Tutorial-phase metrics: they belong to the introduction, and carrying them into the headline
# would dilute the read of the real run.
TUTORIAL_METRIC_IDS = {"efficiency_intro", "model_intro"}

# Three per game, never regenerated (D15). Spent points are the difference from this.
DEFAULT_ESCALATION_POINTS = 3

# Progression indexes the questionnaire answers are stored against (see game_handler).
INTRO_PROGRESS_INDEX = 1
OUTRO_PROGRESS_INDEX = 4

# A knowledge question's correct answer is always option 0 (see admin_service).
CORRECT_ANSWER_ID = 0


def _graph_view(user_id: int, run_index: Optional[int], phase_id: Optional[int]) -> dict:
    """The `graph:state` payload as of a given run: the same view the Performance Dashboard
    renders, so the results Pipeline tab reads as that dashboard at rest."""
    graph = GraphFactory.get_graph()
    replay = graph_store.load_state(user_id, run_index)
    evaluation = evaluate_graph(graph, replay.state, PatternFactory.patterns, PatternFactory.order)
    return build_graph_state(
        graph=graph,
        state=replay.state,
        effective=evaluation.effective,
        stage_view=evaluation.stage_graph,
        patterns=PatternFactory.patterns,
        active_patterns=evaluation.active_patterns,
        current_phase_id=phase_id,
    )


def _room_for_phases(phase_ids: set[int]) -> list[tuple[str, str, str]]:
    """Everyone who sat in the room during this run, with their power and interest.

    A stakeholder can appear in several phases; the strongest standing they held is the one that
    counts, since that is the weight their displeasure actually carried.
    """
    best: dict[str, tuple[str, str]] = {}
    phases = PhaseFactory.get_phases()
    for phase_id in phase_ids:
        if phase_id < 0 or phase_id >= len(phases):
            continue
        for ps in phases[phase_id].stakeholders:
            current = best.get(ps.stakeholder_id)
            if current is None or (ps.power == "high" and current[0] != "high"):
                best[ps.stakeholder_id] = (ps.power, ps.interest)
    return [(st_id, power, interest) for st_id, (power, interest) in best.items()]


def _intel_facts(
    user_id: int, run_index: Optional[int], challenge_ids: set[int], exclude_challenge_ids: set[int] = frozenset()
) -> dict[str, Any]:
    """How much of the available intel the player found, and how much of it they read correctly.

    `available` counts the requirements belonging to the challenges this run actually dealt, not
    every requirement in the config: intel for a challenge the player never saw was never theirs
    to miss.
    """
    from mlops_serious_game.application.intel_handler import intel_rows

    with get_session() as session:
        rows = intel_rows(session, user_id, run_index)
        items: list[StakeholderIntelItem] = []
        for row in rows:
            if isinstance(row.intel_item_data, dict):
                try:
                    item = StakeholderIntelItem(**row.intel_item_data)
                except Exception:
                    continue
                if item.challenge_id not in exclude_challenge_ids:
                    items.append(item)

    available = 0
    available_by_stakeholder: dict[str, int] = {}
    for challenge_id in challenge_ids:
        try:
            requirements = RequirementFactory.get_requirements_for_challenge(challenge_id)
        except Exception:
            continue
        available += len(requirements)
        for requirement in requirements:
            owner = getattr(requirement, "stakeholder_id", None) or compute.ENVIRONMENT
            available_by_stakeholder[owner] = available_by_stakeholder.get(owner, 0) + 1

    tagged = [item for item in items if getattr(item, "categorized_type", None) is not None]
    correct = sum(1 for item in tagged if item.is_correct())

    def tag_value(tag: Any) -> Optional[str]:
        return str(getattr(tag, "value", tag)) if tag is not None else None

    breakdown = compute.intel_breakdown(
        [
            {
                "stakeholder_id": getattr(item, "stakeholder_id", None),
                "true_tag": tag_value(item.type),
                "tagged_tag": tag_value(item.categorized_type),
                "confidence": tag_value(item.intel_type),
            }
            for item in items
        ],
        available_by_stakeholder,
    )
    return {
        "counts": {
            "gathered": len(items),
            "available": max(available, len(items)),
            "tagged_total": len(tagged),
            "tagged_correct": correct,
        },
        "breakdown": breakdown,
    }


def _knowledge_correct(additional_data: Any, questions) -> Optional[int]:
    """How many knowledge questions were answered correctly, or None when nothing was answered.

    None and zero are different answers: a campaign with the questionnaire turned off has not
    measured the player, which is not the same as the player scoring nothing.
    """
    if not additional_data or not isinstance(additional_data, list):
        return None
    correct = 0
    for index, question in enumerate(questions):
        if not question.knowledge_question:
            continue
        answer = additional_data[index] if index < len(additional_data) else None
        if isinstance(answer, dict) and answer.get("id") == CORRECT_ANSWER_ID:
            correct += 1
    return correct


def _stage_moves(user_id: int, run: int, challenge_rows: list[dict]) -> list[tuple[float, float]]:
    """`(before, after)` health of each challenge's own stage, read from the report its simulation
    stored: `before` is the stage once the challenge had hit it, `after` once the run's card and
    its consequences had landed. Only this run's challenges count, and one that never reached its
    simulation has no report and is left out."""
    graph = GraphFactory.get_graph()
    moves: list[tuple[float, float]] = []
    for row in challenge_rows:
        if row["run_index"] != run:
            continue
        challenge = PhaseFactory.translate_challenge_index(
            phase_index=row["phase_index"], challenge_index=row["challenge_index"]
        )
        stage = stage_for_phase(graph, row["phase_index"])
        if challenge is None or stage is None:
            continue
        report = graph_store.load_report(user_id, f"sim:{challenge.template_id}:3")
        pair = ((report or {}).get("stage_health") or {}).get(stage.id)
        if pair:
            moves.append((float(pair["before"]), float(pair["after"])))
    return moves


def _par_for(key: tuple[int, int]) -> str:
    """The best outcome the room of `(phase_id, challenge_id)` allows (`Challenge.par_outcome`)."""
    try:
        return PhaseFactory.translate_challenge_index(challenge_index=key[1], phase_index=key[0]).par_outcome
    except Exception:
        return "PASS"


def _distinct_fired_grudges(events: list[Any]) -> int:
    """How many grudges the player wrote that went on to fire, not how many times they fired.

    A grudge keeps firing for its lifetime, so counting fires charges one soft pass twice or more.
    Per stakeholder, written and fired events are matched one to one: a grudge that never fired
    cost nothing yet.
    """
    written: dict[str, int] = {}
    fired: dict[str, int] = {}
    for event in events:
        if event.cause == "grudge.written":
            written[event.subject_id] = written.get(event.subject_id, 0) + 1
        elif event.cause == "grudge.fired":
            fired[event.subject_id] = fired.get(event.subject_id, 0) + 1
    return sum(min(count, fired.get(owner, 0)) for owner, count in written.items())


def _gate7_target_rows(graph_view: dict[str, Any]) -> list[dict[str, Any]]:
    """One row per component/edge, for the change-scope and drift-magnitude readings (compute.py)."""
    rows: list[dict[str, Any]] = []
    for stage in graph_view.get("technical", {}).values():
        for target in [*stage.get("components", []), *stage.get("edges", [])]:
            automation = target.get("nominal_automation", target.get("automation"))
            if automation is None:
                continue
            rows.append({
                "nominal_automation": automation,
                "has_debt": bool(target.get("debt")),
            })
    return rows


def _knowledge(user_id: int) -> dict[str, Any]:
    """The before/after read, across every run the player has finished (D3).

    Deliberately **not** run-scoped: the whole point is the series, and a later run's outro is
    another point on it rather than a fresh start.
    """
    knowledge_questions = [q for q in QuestionFactory.intro_questions if q.knowledge_question]
    total = len(knowledge_questions)

    with get_session() as session:
        rows = session.scalars(
            select(GameProgression)
            .where(GameProgression.user_id == user_id)
            .order_by(GameProgression.run_index, GameProgression.id)
        ).all()
        intro_data = next(
            (r.additional_data for r in rows if r.game_progress_index == INTRO_PROGRESS_INDEX), None
        )
        outro_by_run: dict[int, Any] = {}
        for row in rows:
            if row.game_progress_index == OUTRO_PROGRESS_INDEX and row.additional_data:
                outro_by_run[int(row.run_index or 1)] = row.additional_data
        highest_run = max([int(r.run_index or 1) for r in rows], default=1)

    intro_correct = _knowledge_correct(intro_data, QuestionFactory.intro_questions)
    outro_per_run = [
        _knowledge_correct(outro_by_run.get(run), QuestionFactory.outro_questions)
        for run in range(1, highest_run + 1)
    ]
    return compute.knowledge_delta(intro_correct, outro_per_run, total)


def build_results(user_id: int, run_index: Optional[int] = None) -> dict[str, Any]:
    """The whole results payload for one run: pillars, grade, and every detail section."""
    with get_session() as session:
        if session.get(User, user_id) is None:
            raise ValueError(f"unknown player {user_id}")
        run = run_index if run_index is not None else current_run_index(session, user_id)
        baseline_run = parent_run(session, user_id, run)
        chain = run_chain(session, user_id, run)

        challenges = session.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id, GameChallenge.run_index.in_(chain))
            .order_by(GameChallenge.id)
        ).all()
        game_session = session.scalars(
            select(GameSession)
            .where(GameSession.user_id == user_id, GameSession.run_index == run)
            .order_by(GameSession.id.desc())
        ).first()

        user = session.get(User, user_id)
        campaign = session.get(Campaign, user.campaign_id) if user else None
        replay_allowed = bool(campaign and campaign.allow_replay)

        # The demo phase is a tutorial: nothing it produced counts towards the results.
        demo_phases = PhaseFactory.demo_phase_ids()
        demo_ids = PhaseFactory.demo_challenge_ids()  # events and intel carry a challenge, not a reliable phase
        challenge_rows = [
            {
                "run_index": int(row.run_index or 1),
                "phase_index": row.phase_index,
                "challenge_index": row.challenge_index,
                "metric_values": list(row.metric_values or []),
                "action_card": dict(row.action_card or {}),
                "attention_tokens": row.attention_tokens,
                "emotion_values": dict(row.emotion_values or {}),
            }
            for row in challenges
            if row.phase_index not in demo_phases
        ]
        escalation_left = (
            int(game_session.escalation_points)
            if game_session and game_session.escalation_points is not None
            else DEFAULT_ESCALATION_POINTS
        )

    phase_ids = {row["phase_index"] for row in challenge_rows}
    challenge_ids = {row["challenge_index"] for row in challenge_rows}
    latest_phase = max(phase_ids) if phase_ids else None

    events = [e for e in event_store.load_events(user_id, run_index=run) if e.challenge_id not in demo_ids]
    fired_grudges = _distinct_fired_grudges(events)

    graph_view = _graph_view(user_id, run, latest_phase)
    baseline_view = _graph_view(user_id, baseline_run, latest_phase) if baseline_run else None

    final_emotions: dict[str, dict[str, float]] = {}
    for row in reversed(challenge_rows):
        if row["emotion_values"]:
            final_emotions = row["emotion_values"]
            break

    intel = _intel_facts(user_id, run, challenge_ids, exclude_challenge_ids=demo_ids)
    counts = intel["counts"]

    outcomes_by_key = compute.outcomes_by_challenge(events)
    outcomes_in_order = [outcomes_by_key[key] for key in sorted(outcomes_by_key)]
    stage_moves = _stage_moves(user_id, run, challenge_rows)
    pillars = [
        compute.pipeline_progress(stage_moves)
        if stage_moves
        else compute.pipeline_health(
            graph_view.get("stages", []),
            baseline_view.get("stages", []) if baseline_view else None,
        ),
        compute.stakeholder_relations(
            final_emotions,
            _room_for_phases(phase_ids),
            fired_grudges,
            history=[r["emotion_values"] for r in challenge_rows if r["run_index"] == run and r["emotion_values"]],
        ),
        compute.intel_accuracy(
            tagged_correct=counts["tagged_correct"],
            tagged_total=counts["tagged_total"],
            gathered=counts["gathered"],
            available=counts["available"],
        ),
        compute.decision_quality(
            outcomes_in_order,
            escalation_spent=max(0, DEFAULT_ESCALATION_POINTS - escalation_left),
            pars=[_par_for(key) for key in sorted(outcomes_by_key)],
        ),
    ]
    overall = compute.overall_score(pillars)
    grade = compute.grade_for(overall)

    metric_ids = MetricFactory.get_available_metrics()
    metric_rows = [row for row in challenge_rows if row["metric_values"]]
    # Where this run's own challenges begin within the (possibly inherited) trajectory.
    own_from = next((i for i, row in enumerate(metric_rows) if row["run_index"] == run), 0)
    metrics = compute.metric_summary(
        metric_ids=list(metric_ids),
        trajectory=[row["metric_values"] for row in metric_rows],
        max_values={m.id: m.max_value for m in MetricFactory.metrics},
        excluded=TUTORIAL_METRIC_IDS,
        own_from=own_from,
    )

    gate7_target_rows = _gate7_target_rows(graph_view)
    stakeholder_relations_score = next(p.score for p in pillars if p.id == "stakeholder_relations")
    gate7 = compute.gate7_outcome(
        stakeholder_satisfaction=stakeholder_relations_score,
        metric_compliance_score=compute.metric_compliance(metrics["metrics"]).score,
        change_scope_score=compute.change_scope(gate7_target_rows).score,
        drift_magnitude_score=compute.drift_magnitude(gate7_target_rows).score,
    )

    challenge_names = {}
    for cid in challenge_ids:
        try:
            challenge_names[cid] = PhaseFactory.get_challenge_by_id(cid).name
        except ValueError:
            continue
    decisions = compute.decision_rows(
        challenge_rows, compute.outcomes_by_challenge(events), challenge_names
    )
    mood = compute.mood_trajectory(challenge_rows)

    epilogue_facts = _epilogue_facts(pillars, graph_view, final_emotions, fired_grudges, events)
    epilogue = epilogue_for(grade.grade, epilogue_facts, spiral=baseline_run is not None)
    epilogue = _personalize_epilogue(epilogue, epilogue_facts)

    return {
        "run_index": run,
        "setting": {"company": SettingFactory.company(), "system": SettingFactory.system()},
        "seeded_from_run": baseline_run,
        "is_spiral": baseline_run is not None,
        "replay_allowed": replay_allowed,
        "grade": grade.model_dump(),
        "gate7": gate7.model_dump(),
        "epilogue": epilogue,
        "pillars": [p.model_dump() for p in pillars],
        "metrics": metrics,
        "knowledge": _knowledge(user_id),
        "intel": intel["breakdown"],
        "decisions": decisions,
        "mood": mood,
        # Every configured stakeholder in config order, so the UI can bind a colour to the entity
        # itself rather than to its position among whoever happened to appear in this run.
        "stakeholder_order": list(StakeholderFactory.get_available_stakeholders()),
        "stakeholders": _stakeholder_names(set(mood["series"]) | {r["id"] for r in intel["breakdown"]["per_stakeholder"]}),
        "escalation": {"total": DEFAULT_ESCALATION_POINTS, "left": escalation_left},
        "pipeline": {
            "system_health": graph_view.get("system_health"),
            "stages": graph_view.get("stages", []),
            "inherited_system_health": baseline_view.get("system_health") if baseline_view else None,
        },
        "challenges": challenge_rows,
        "events": [serialize_event(e) for e in events],
    }


# ── Caching ──────────────────────────────────────────────────────────────────


def load_cached(user_id: int, run_index: int) -> Optional[dict[str, Any]]:
    """The stored payload for a finished run, or None if it was never computed."""
    with get_session() as session:
        row = session.scalar(
            select(GameResult).where(
                GameResult.user_id == user_id, GameResult.run_index == run_index
            )
        )
        return dict(row.payload) if row and row.payload else None


def store_results(user_id: int, run_index: int, payload: dict[str, Any]) -> None:
    """Writes the payload for a run, replacing any earlier one.

    Replacing rather than erroring matters for a run still in progress: the player can open the
    screen, keep playing and open it again, and the cache should track the run rather than pin it
    to whatever the first look happened to catch.
    """
    with get_session() as session:
        row = session.scalar(
            select(GameResult).where(
                GameResult.user_id == user_id, GameResult.run_index == run_index
            )
        )
        if row is None:
            session.add(
                GameResult(
                    user_id=user_id, run_index=run_index, payload=payload
                )
            )
        else:
            row.payload = payload
            flag_modified(row, "payload")


def results_for(
    user_id: int,
    run_index: Optional[int] = None,
    *,
    refresh: bool = False,
) -> dict[str, Any]:
    """The results payload for a run, from cache when there is one.

    `refresh` forces a recompute, which is what the admin uses after a config change and what a
    replaying player gets when they reopen a run they have since played further.
    """
    with get_session() as session:
        run = run_index if run_index is not None else current_run_index(session, user_id)

    if not refresh:
        cached = load_cached(user_id, run)
        if cached is not None:
            return cached

    payload = build_results(user_id, run)
    store_results(user_id, run, payload)
    return payload


# ── Epilogue (D5/D12) ────────────────────────────────────────────────────────


def _epilogue_facts(
    pillars: list[compute.Pillar],
    graph_view: dict,
    final_emotions: dict[str, dict[str, float]],
    fired_grudges: int,
    events: list[Any],
) -> dict[str, Any]:
    """The readings the epilogue's beats are keyed on, plus who to name in them.

    Named subjects matter: a beat that says "{st} never came round" has to name the stakeholder
    the player actually left cold, or it reads as boilerplate. The coldest in the room is the one
    the player will recognise.
    """
    by_id = {p.id: p for p in pillars}
    outcomes = compute.outcomes_from_events(events)

    coldest_id, coldest_mood = None, None
    for stakeholder_id, values in final_emotions.items():
        readings = [v for v in values.values() if isinstance(v, (int, float))]
        if not readings:
            continue
        mood = sum(readings) / len(readings)
        if coldest_mood is None or mood < coldest_mood:
            coldest_id, coldest_mood = stakeholder_id, mood

    broken = [s for s in graph_view.get("stages", []) if s.get("status") == "broken"]

    return {
        "relations": by_id["stakeholder_relations"].score if "stakeholder_relations" in by_id else None,
        "intel_accuracy": by_id["intel_accuracy"].score if "intel_accuracy" in by_id else None,
        "pipeline_health": by_id["pipeline_health"].score if "pipeline_health" in by_id else None,
        "stakeholder_mood": coldest_mood,
        "fired_grudges": fired_grudges,
        "veto_count": outcomes.count("VETO"),
        "broken_stage": bool(broken),
        # Not conditions, just names for the templates below.
        "_stakeholder_id": coldest_id,
        "_stage_name": broken[0].get("name") if broken else None,
    }


def _personalize_epilogue(epilogue: dict[str, Any], facts: dict[str, Any]) -> dict[str, Any]:
    """Fills `{st}` and `{stage}` in the beats, then runs the whole thing through the persona
    resolver so `#marker#` names match the cast this player was dealt."""
    stakeholder_id = facts.get("_stakeholder_id")
    name = stakeholder_id or "someone in the room"
    if stakeholder_id:
        stakeholder = StakeholderFactory.get_stakeholder(stakeholder_id)
        if stakeholder is not None:
            name = stakeholder.name

    def render(text: str) -> str:
        filled = text.replace("{st}", name).replace("{stage}", facts.get("_stage_name") or "one stage")
        return personalize(filled, resolve_markers=True)

    return {
        "closing": render(epilogue["closing"]),
        "scoreboard": {k: render(v) for k, v in epilogue["scoreboard"].items()},
        "beats": [{"id": b["id"], "text": render(b["text"])} for b in epilogue["beats"]],
    }


def _stakeholder_names(ids: set[str]) -> dict[str, str]:
    """Display names for every stakeholder the screen mentions, so the UI never has to guess.

    The environment is not a person, so it gets a label rather than a lookup.
    """
    names: dict[str, str] = {}
    for stakeholder_id in ids:
        if stakeholder_id == compute.ENVIRONMENT:
            names[stakeholder_id] = "The environment"
            continue
        stakeholder = StakeholderFactory.get_stakeholder(stakeholder_id)
        names[stakeholder_id] = stakeholder.name if stakeholder else stakeholder_id
    return names
