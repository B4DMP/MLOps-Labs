"""Pure scoring for the end-of-game results screen (docs/plans/results-screen.md, D2).

Every function here takes explicit data and returns plain values: no factory calls, no database,
no clock. Callers in `service.py` load a run's rows once and hand them over, which is what makes
the grade testable on hand-built inputs rather than a played game.

Four pillars, each normalised to `0..1`, blended by configurable weights into an `overall` that a
configurable band table turns into a grade. The curve is deliberately generous: a player gets one
challenge per phase and cannot realistically max the graph, so "did well" has to mean well short
of perfect.

The `GameMetrics` gauges are deliberately **not** a fifth pillar. Every metric carries
`component_weights` and moves with the graph rather than with any judgement of the proposal (see
`domain/metric.py`), so a metric is a differently-weighted read of the same components
`pipeline_health` already scores. Grading both would count that work twice. They are reported in
their own right by `metric_summary` instead.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from pydantic import BaseModel, Field

# ── Tunables ─────────────────────────────────────────────────────────────────
# Defaults only. `service.py` overrides them from config so a grade can be retuned after a
# playtest without a deploy.

DEFAULT_PILLAR_WEIGHTS: dict[str, float] = {
    "pipeline_health": 0.3,
    "stakeholder_relations": 0.3,
    "intel_accuracy": 0.2,
    "decision_quality": 0.2,
}

# (minimum overall, grade, label). Ordered best first; the first band the score clears wins.
DEFAULT_GRADE_BANDS: tuple[tuple[float, str, str], ...] = (
    (0.85, "S", "Exemplary"),
    (0.72, "A", "Strong"),
    (0.58, "B", "Solid"),
    (0.44, "C", "Mixed"),
    (0.30, "D", "Struggling"),
    (0.00, "E", "Overwhelmed"),
)

# What one fired grudge costs the relations pillar, and the floor that penalty can drive it to.
GRUDGE_PENALTY = 0.08
GRUDGE_PENALTY_FLOOR = 0.0

# What one spent escalation point costs decision quality. Escalation is a legitimate tool, not a
# failure, so this is a nudge rather than a punishment.
ESCALATION_PENALTY = 0.05

OUTCOME_SCORES: dict[str, float] = {"PASS": 1.0, "SOFT_PASS": 0.5, "VETO": 0.0}

# `cause` strings the commit step writes for each outcome (pitch_debate_service/session.py).
OUTCOME_CAUSES: dict[str, str] = {
    "outcome.pass": "PASS",
    "outcome.soft_pass": "SOFT_PASS",
    "outcome.veto": "VETO",
}

# Power and interest are "high"/"low" strings on a phase's stakeholder list (domain/Phase.py).
_WEIGHT_OF: dict[str, float] = {"high": 1.0, "low": 0.5}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _mean(values: Iterable[float]) -> Optional[float]:
    items = [v for v in values if isinstance(v, (int, float))]
    return sum(items) / len(items) if items else None


class Pillar(BaseModel):
    """One scored dimension, with enough context for the screen to explain the number."""

    id: str
    score: float = Field(ge=0.0, le=1.0)
    # What the score was computed from, for the tab that shows its working.
    detail: dict[str, Any] = Field(default_factory=dict)
    # True when the run inherited a baseline (a spiral run), so the screen knows to present
    # movement rather than an absolute.
    relative: bool = False


# ── Pillar 1: pipeline health ────────────────────────────────────────────────


def pipeline_health(
    stages: list[dict],
    baseline_stages: Optional[list[dict]] = None,
) -> Pillar:
    """Mean health across the stages the player actually reached, normalised to `0..1`.

    Locked stages are excluded rather than counted as zero: a stage the game never opened is not
    something the player failed to maintain.

    On a spiral run `baseline_stages` is the state this run *inherited*, and the score becomes the
    improvement over it rather than the absolute. Without this an iteration grades itself on work
    the previous one did, and a long chain trends to full marks for doing nothing.
    """
    reached = [s for s in stages if not s.get("locked")]
    current = _mean(s.get("health", 0.0) for s in reached)
    if current is None:
        return Pillar(id="pipeline_health", score=0.0, detail={"reason": "no stage reached"})

    current_norm = _clamp(current / 100.0)
    if baseline_stages is None:
        return Pillar(
            id="pipeline_health",
            score=current_norm,
            detail={"system_health": round(current, 1), "stages_reached": len(reached)},
        )

    baseline_reached = [s for s in baseline_stages if not s.get("locked")]
    baseline = _mean(s.get("health", 0.0) for s in baseline_reached) or 0.0
    baseline_norm = _clamp(baseline / 100.0)

    # Headroom, not raw delta: improving 0.9 -> 0.95 is half of what was left to win, and should
    # not score the same as improving 0.1 -> 0.15, which is a twentieth of the gap.
    headroom = 1.0 - baseline_norm
    gained = current_norm - baseline_norm
    score = 1.0 if headroom <= 0 else _clamp(gained / headroom)
    return Pillar(
        id="pipeline_health",
        score=score,
        relative=True,
        detail={
            "system_health": round(current, 1),
            "inherited_health": round(baseline, 1),
            "stages_reached": len(reached),
        },
    )


# ── Pillar 2: stakeholder relations ──────────────────────────────────────────


def stakeholder_relations(
    emotion_values: dict[str, dict[str, float]],
    room: Iterable[tuple[str, str, str]],
    fired_grudges: int = 0,
) -> Pillar:
    """How the room feels at the end, weighted by who actually matters.

    `room` is `(stakeholder_id, power, interest)` as the phases config supplies it. Weighting by
    power x interest is the same reading the game uses everywhere else: leaving a high-power,
    high-interest stakeholder cold is worse than leaving a peripheral one cold.

    Grudges are subtracted rather than folded into the emotions they came from. A grudge that
    fired is friction the player actually shipped, and it should cost even if the stakeholder
    ended up warm again afterwards.
    """
    weights: dict[str, float] = {}
    for stakeholder_id, power, interest in room:
        weights[stakeholder_id] = _WEIGHT_OF.get(power, 0.5) * _WEIGHT_OF.get(interest, 0.5)

    weighted_sum = 0.0
    total_weight = 0.0
    per_stakeholder: dict[str, float] = {}
    for stakeholder_id, weight in weights.items():
        mood = _mean((emotion_values.get(stakeholder_id) or {}).values())
        if mood is None:
            # No reading at all means they were never in the room, not that they felt nothing.
            continue
        per_stakeholder[stakeholder_id] = round(mood, 3)
        weighted_sum += mood * weight
        total_weight += weight

    if total_weight == 0:
        return Pillar(id="stakeholder_relations", score=0.0, detail={"reason": "no room"})

    raw = weighted_sum / total_weight
    penalty = GRUDGE_PENALTY * max(0, fired_grudges)
    score = _clamp(raw - penalty, low=GRUDGE_PENALTY_FLOOR)
    return Pillar(
        id="stakeholder_relations",
        score=score,
        detail={
            "weighted_mood": round(raw, 3),
            "fired_grudges": fired_grudges,
            "per_stakeholder": per_stakeholder,
        },
    )


# ── Pillar 3: intel accuracy ─────────────────────────────────────────────────


def intel_accuracy(
    tagged_correct: int,
    tagged_total: int,
    gathered: int,
    available: int,
) -> Pillar:
    """Accuracy times coverage.

    Two numbers that have to be multiplied rather than averaged: tagging three notes perfectly out
    of thirty available is not an A. Equally, gathering everything and reading all of it wrong is
    not either, which averaging would forgive.
    """
    accuracy = (tagged_correct / tagged_total) if tagged_total else 0.0
    coverage = (gathered / available) if available else 0.0
    score = _clamp(accuracy * coverage)
    return Pillar(
        id="intel_accuracy",
        score=score,
        detail={
            "accuracy": round(accuracy, 3),
            "coverage": round(coverage, 3),
            "tagged_correct": tagged_correct,
            "tagged_total": tagged_total,
            "gathered": gathered,
            "available": available,
        },
    )


# ── Pillar 4: decision quality ───────────────────────────────────────────────


def decision_quality(outcomes: list[str], escalation_spent: int = 0) -> Pillar:
    """Mean outcome across the challenges that reached a commit, less what escalation cost.

    A challenge with no recorded outcome is skipped rather than scored zero: the player may simply
    not have got that far, and an unplayed challenge is not a veto.
    """
    scored = [OUTCOME_SCORES[o] for o in outcomes if o in OUTCOME_SCORES]
    if not scored:
        return Pillar(id="decision_quality", score=0.0, detail={"reason": "no outcome recorded"})

    raw = sum(scored) / len(scored)
    score = _clamp(raw - ESCALATION_PENALTY * max(0, escalation_spent))
    counts = {name: outcomes.count(name) for name in OUTCOME_SCORES}
    return Pillar(
        id="decision_quality",
        score=score,
        detail={"raw": round(raw, 3), "escalation_spent": escalation_spent, "counts": counts},
    )


def outcomes_from_events(events: Iterable[Any]) -> list[str]:
    """Reads the committed outcome of each challenge off the event log, in order.

    One outcome per challenge: a challenge can be pitched more than once, and only the commit that
    ended it counts. Later events for the same challenge overwrite earlier ones.
    """
    by_challenge = outcomes_by_challenge(events)
    return [by_challenge[key] for key in sorted(by_challenge)]


# ── Gate 7 (CAPTURE EVOLVE, GDD.txt sec "CAPTURE Gate 7") ────────────────────
#
# Four readings, each normalised to 0..1, map to one of five outcome paths (7a-7e). The GDD
# describes the paths qualitatively but gives no numbers, so the thresholds below are explicit,
# tunable defaults - the same posture as DEFAULT_GRADE_BANDS above - to retune after a playtest,
# not a claim of a single correct cut.
#
# A target still counts as "planned" rather than "realized" while its automation sits at absent
# or below (00-plan.md's AutomationState: broken=0, absent=1) - nothing has actually been built
# yet, whether or not it was ever attempted.

GATE7_PLANNED_MAX_AUTOMATION = 1  # AutomationState.ABSENT

# A row tied to a Soft Failure or an overridden Veto (it carries debt) counts double toward
# "change scope": an unrealized target nobody ever contested is a smaller signal than one that was
# fought over and still didn't land.
GATE7_DEBT_WEIGHT = 2.0

# Below this on stakeholder satisfaction OR metric compliance, the system is not viable to build
# further on regardless of how little of it is unrealized (7e).
GATE7_VIABILITY_THRESHOLD = 0.35

# Above this proportion of the (weighted) graph still unrealized, the run misjudged something
# fundamental rather than merely leaving loose ends (7a).
GATE7_MAJOR_CHANGE_SCOPE = 0.6

# At or below both of these, the run is clean enough to call it a flawless close (7d).
GATE7_LOW_DRIFT = 0.15
GATE7_LOW_GAP = 0.25

# Above this on drift (accumulated technical debt), the win still needs a technical rework framing
# rather than a light next-iteration framing (7c vs 7b).
GATE7_HIGH_DRIFT = 0.45

# code -> (name, result, allowed `mode`s for game_handler.handle_new_run)
GATE7_PATHS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "7d": ("Continuous Monitoring", "win", ("fresh", "spiral")),
    "7b": ("Minor Iteration", "win_with_debt", ("fresh", "spiral")),
    "7c": ("Model Update", "win_with_debt", ("fresh", "spiral")),
    "7a": ("Major Iteration", "loss", ("fresh",)),
    "7e": ("Retirement", "loss", ("fresh",)),
}


def metric_compliance(metrics: list[dict[str, Any]], ratio_threshold: float = 0.5) -> Pillar:
    """`r_KPI`: the proportion of the headline project metrics that ended at or above
    `ratio_threshold` of their max - the closest proxy available to "within target range" without
    an authored band per metric."""
    if not metrics:
        return Pillar(id="metric_compliance", score=0.0, detail={"reason": "no metrics"})
    compliant = [m["id"] for m in metrics if m.get("ratio", 0.0) >= ratio_threshold]
    score = len(compliant) / len(metrics)
    return Pillar(
        id="metric_compliance",
        score=score,
        detail={"compliant": compliant, "total": len(metrics), "threshold": ratio_threshold},
    )


def _weighted_gate7_ratio(target_rows: list[dict[str, Any]], predicate) -> float:
    weights = [GATE7_DEBT_WEIGHT if row.get("has_debt") else 1.0 for row in target_rows]
    total = sum(weights)
    if not total:
        return 0.0
    hit = sum(w for row, w in zip(target_rows, weights) if predicate(row))
    return hit / total


def change_scope(target_rows: list[dict[str, Any]]) -> Pillar:
    """`Δr`: the (debt-weighted) proportion of known components/edges still `planned` rather than
    `realized`. `target_rows` is `[{"nominal_automation": int, "has_debt": bool}, ...]` for every
    component/edge."""
    if not target_rows:
        return Pillar(id="change_scope", score=0.0, detail={"reason": "no targets observed"})
    score = _weighted_gate7_ratio(
        target_rows, lambda row: row.get("nominal_automation", 0) <= GATE7_PLANNED_MAX_AUTOMATION
    )
    return Pillar(id="change_scope", score=score, detail={"targets": len(target_rows)})


def drift_magnitude(target_rows: list[dict[str, Any]]) -> Pillar:
    """`d_drift`: the (debt-weighted) proportion of known targets carrying Delayed Technical Debt -
    a realized target built on a compromised proposal, not one that simply never got built."""
    if not target_rows:
        return Pillar(id="drift_magnitude", score=0.0, detail={"reason": "no targets observed"})
    score = _weighted_gate7_ratio(target_rows, lambda row: bool(row.get("has_debt")))
    with_debt = sum(1 for row in target_rows if row.get("has_debt"))
    return Pillar(id="drift_magnitude", score=score, detail={"targets_with_debt": with_debt, "targets": len(target_rows)})


class Gate7Result(BaseModel):
    code: str
    name: str
    result: str  # "win", "win_with_debt", "loss"
    allowed_modes: list[str]
    readings: dict[str, float] = Field(default_factory=dict)


def gate7_outcome(
    stakeholder_satisfaction: float,
    metric_compliance_score: float,
    change_scope_score: float,
    drift_magnitude_score: float,
) -> Gate7Result:
    """Maps the four Gate 7 readings to one of 7a-7e, most severe check first: a run cannot buy its
    way out of being unviable (7e) by having little unrealized scope, and cannot buy its way out of
    misjudged scope (7a) by having satisfied stakeholders on what it did build."""
    readings = {
        "stakeholder_satisfaction": round(stakeholder_satisfaction, 3),
        "metric_compliance": round(metric_compliance_score, 3),
        "change_scope": round(change_scope_score, 3),
        "drift_magnitude": round(drift_magnitude_score, 3),
    }

    if stakeholder_satisfaction < GATE7_VIABILITY_THRESHOLD or metric_compliance_score < GATE7_VIABILITY_THRESHOLD:
        code = "7e"
    elif change_scope_score > GATE7_MAJOR_CHANGE_SCOPE:
        code = "7a"
    elif drift_magnitude_score <= GATE7_LOW_DRIFT and change_scope_score <= GATE7_LOW_GAP:
        code = "7d"
    elif drift_magnitude_score > GATE7_HIGH_DRIFT:
        code = "7c"
    else:
        code = "7b"

    name, result, allowed_modes = GATE7_PATHS[code]
    return Gate7Result(code=code, name=name, result=result, allowed_modes=list(allowed_modes), readings=readings)


# ── Grade ────────────────────────────────────────────────────────────────────


class Grade(BaseModel):
    overall: float = Field(ge=0.0, le=1.0)
    grade: str
    label: str


def overall_score(pillars: Iterable[Pillar], weights: Optional[dict[str, float]] = None) -> float:
    """Weighted blend of the pillars, renormalised over whichever ones were supplied.

    Renormalising matters: if a pillar is missing (no outcome recorded yet, say), the rest should
    still add up to a whole grade rather than silently capping the player at 0.8.
    """
    weights = weights or DEFAULT_PILLAR_WEIGHTS
    total_weight = 0.0
    weighted = 0.0
    for pillar in pillars:
        weight = weights.get(pillar.id, 0.0)
        weighted += pillar.score * weight
        total_weight += weight
    return _clamp(weighted / total_weight) if total_weight else 0.0


def grade_for(
    overall: float,
    bands: Optional[tuple[tuple[float, str, str], ...]] = None,
) -> Grade:
    """The first band the score clears, best first. The lowest band's threshold must be 0.0, so
    there is always an answer."""
    for minimum, grade, label in bands or DEFAULT_GRADE_BANDS:
        if overall >= minimum:
            return Grade(overall=round(overall, 4), grade=grade, label=label)
    # Only reachable if a caller supplies bands that do not reach zero.
    return Grade(overall=round(overall, 4), grade="E", label="Overwhelmed")


# ── Metrics (reported, not graded) ───────────────────────────────────────────


def metric_summary(
    metric_ids: list[str],
    trajectory: list[list[float]],
    max_values: dict[str, int],
    excluded: Iterable[str] = (),
    own_from: int = 0,
) -> dict[str, Any]:
    """The `MetricTab` gauges at rest, plus how they got there.

    `trajectory` is one `GameChallenge.metric_values` list per challenge, in play order, each
    aligned with `metric_ids`. Tutorial-phase metrics are excluded from the headline: they belong
    to the introduction, and carrying them would dilute the read of the real run.

    `own_from` is the index of the first challenge this run played itself. On a next iteration the
    trajectory starts with the challenges it inherited, and `gained` is measured from where the
    run *began*, not from the start of the chain: otherwise iteration three would take credit for
    what iterations one and two built, the same trap `pipeline_health` guards against.
    """
    excluded_set = set(excluded)
    final = trajectory[-1] if trajectory else []
    own_from = max(0, min(own_from, max(len(trajectory) - 1, 0)))
    # What the run started from: the last inherited reading on a spiral run, else its first own one.
    opening = trajectory[own_from - 1] if own_from > 0 else (trajectory[0] if trajectory else [])

    metrics = []
    for index, metric_id in enumerate(metric_ids):
        if metric_id in excluded_set:
            continue
        value = final[index] if index < len(final) else 0
        start = opening[index] if index < len(opening) else 0
        maximum = max_values.get(metric_id, 0)
        metrics.append({
            "id": metric_id,
            "value": value,
            "max": maximum,
            "gained": value - start,
            "ratio": round(_clamp(value / maximum), 3) if maximum else 0.0,
            "series": [row[index] if index < len(row) else 0 for row in trajectory],
        })
    return {"metrics": metrics, "challenges": len(trajectory), "own_from": own_from}


# ── Knowledge delta (D3: numbers only, never answers) ────────────────────────


def knowledge_delta(
    intro_correct: Optional[int],
    outro_correct_per_run: list[Optional[int]],
    total_questions: int,
) -> dict[str, Any]:
    """The before/after read, as counts and percentages only.

    Never returns which questions were answered how. The player sees that they moved; handing back
    an answer key would spoil a second run and contaminate the instrument for everyone after them.
    """
    def pct(correct: Optional[int]) -> Optional[float]:
        if correct is None or not total_questions:
            return None
        return round(100.0 * correct / total_questions, 1)

    series = [{"run": i + 1, "correct": c, "percent": pct(c)} for i, c in enumerate(outro_correct_per_run)]
    latest = next((entry for entry in reversed(series) if entry["correct"] is not None), None)
    delta = None
    if intro_correct is not None and latest is not None:
        delta = latest["correct"] - intro_correct

    return {
        "total_questions": total_questions,
        "intro": {"correct": intro_correct, "percent": pct(intro_correct)},
        "outro_per_run": series,
        "delta": delta,
        "delta_percent": round(100.0 * delta / total_questions, 1) if delta is not None and total_questions else None,
    }


# ── Detail sections: intel, decisions, mood (counts only, D7) ────────────────

# Facts belong to the environment rather than a person; they group under this id.
ENVIRONMENT = "environment"


def intel_breakdown(
    items: list[dict[str, Any]],
    available_by_stakeholder: dict[str, int],
) -> dict[str, Any]:
    """What the player found and how they read it, as counts.

    Each item is `{stakeholder_id, true_tag, tagged_tag, confidence}`. Only counts leave this
    function, never an item's wording or its true tag on its own: the screen tells a player *that*
    they read boundaries as drivers, not *which* note it was, so a second run is still worth
    playing (D7).

    `confusion[true][tagged]` is the useful one for teaching. A row that is all on the diagonal is
    a player who reads the room; mass off it says which distinction they keep missing.
    """
    per_stakeholder: dict[str, dict[str, int]] = {}
    confusion: dict[str, dict[str, int]] = {}
    confidence = {"verified": 0, "unconfirmed": 0}

    for item in items:
        owner = item.get("stakeholder_id") or ENVIRONMENT
        row = per_stakeholder.setdefault(owner, {"gathered": 0, "correct": 0, "wrong": 0})
        row["gathered"] += 1

        true_tag, tagged = item.get("true_tag"), item.get("tagged_tag")
        if true_tag and tagged:
            if true_tag == tagged:
                row["correct"] += 1
            else:
                row["wrong"] += 1
            confusion.setdefault(true_tag, {}).setdefault(tagged, 0)
            confusion[true_tag][tagged] += 1

        state = str(item.get("confidence") or "unconfirmed").lower()
        confidence[state if state in confidence else "unconfirmed"] += 1

    # A stakeholder the player never found anything on still belongs in the table: a row of
    # zeros against a non-zero `available` is exactly the coverage gap worth showing.
    for owner, available in available_by_stakeholder.items():
        per_stakeholder.setdefault(owner, {"gathered": 0, "correct": 0, "wrong": 0})

    rows = [
        {"id": owner, **counts, "available": max(available_by_stakeholder.get(owner, 0), counts["gathered"])}
        for owner, counts in per_stakeholder.items()
    ]
    rows.sort(key=lambda r: (r["id"] == ENVIRONMENT, r["id"]))
    return {"per_stakeholder": rows, "confusion": confusion, "confidence": confidence}


def outcomes_by_challenge(events: Iterable[Any]) -> dict[tuple[int, int], str]:
    """The committed outcome of each challenge, keyed `(phase_id, challenge_id)`.

    Same reading as `outcomes_from_events`, which is now just this in play order.
    """
    by_challenge: dict[tuple[int, int], str] = {}
    for event in events:
        cause = getattr(event, "cause", None)
        if cause in OUTCOME_CAUSES:
            by_challenge[(getattr(event, "phase_id", 0), getattr(event, "challenge_id", 0))] = OUTCOME_CAUSES[cause]
    return by_challenge


def decision_rows(
    challenges: list[dict[str, Any]],
    outcomes: dict[tuple[int, int], str],
    challenge_names: dict[int, str],
) -> list[dict[str, Any]]:
    """One row per challenge in play order: what it was, what was played, how it ended.

    `outcome` is None for a challenge that never reached a commit, which the screen renders as
    "not finished" rather than as a veto.
    """
    rows = []
    for position, challenge in enumerate(challenges, start=1):
        phase, cid = challenge["phase_index"], challenge["challenge_index"]
        card = challenge.get("action_card") or {}
        rows.append({
            "position": position,
            "phase_index": phase,
            "challenge_index": cid,
            "name": challenge_names.get(cid, f"Challenge {cid}"),
            "card_title": card.get("title") or None,
            "outcome": outcomes.get((phase, cid)),
            "attention_tokens": challenge.get("attention_tokens"),
        })
    return rows


def mood_trajectory(challenges: list[dict[str, Any]]) -> dict[str, Any]:
    """Each stakeholder's mean mood after every challenge, for the trajectory chart.

    A stakeholder with no reading at a given point gets None, not zero: they were not in the room,
    and a line that dives to zero would say they turned hostile.
    """
    steps = [c.get("emotion_values") or {} for c in challenges]
    ids = sorted({sid for step in steps for sid in step})
    series: dict[str, list[Optional[float]]] = {}
    for sid in ids:
        points: list[Optional[float]] = []
        for step in steps:
            mood = _mean((step.get(sid) or {}).values())
            points.append(round(mood, 3) if mood is not None else None)
        series[sid] = points
    return {"steps": len(steps), "series": series}
