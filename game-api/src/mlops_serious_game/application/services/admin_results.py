"""The admin Results page's data (docs/plans/results-screen.md, section 5).

Campaign aggregates over finished runs, plus a per-player, per-run drill-down. Kept apart from
`admin_service`, which is already very large; it reuses that module's `get_valid_players_set`, the
one chokepoint every admin aggregate goes through, so the playtest exclusion (D10) applies here
exactly as it does everywhere else.

By default only each player's **first** run counts toward the aggregates. That is the only run
taken under the study's conditions: a second run has been told the answers by the first. Passing
`runs="all"` includes replays, which is what lets a replay-enabled campaign look at a learning
curve. Individual runs of any player remain readable in the drill-down either way.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Literal

from sqlalchemy import select

from mlops_serious_game.application.results_service import aggregate, service
from mlops_serious_game.application.services.admin_service import get_valid_players_set
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.persona_resolver import PersonaMap, personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import (
    Campaign,
    GameProgression,
    IntelItem,
    User,
)
from mlops_serious_game.infrastructure.database.run_scope import FIRST_RUN

FINISHED_INDEX = 4
RunsMode = Literal["first", "all"]

# How many items the most and least gathered lists show.
INTEL_ITEM_TOP = 5


def _campaign_key(campaign: str | None) -> str | None:
    """Accepts a key or a display name, like the main dashboard does; None or "all" means every
    campaign."""
    if not campaign or campaign == "all":
        return None
    with get_session() as session:
        found = session.scalar(
            select(Campaign).where(
                (Campaign.campaign_key == campaign) | (Campaign.campaign_name == campaign)
            )
        )
        return found.campaign_key if found else campaign


def finished_runs(emails: set[str]) -> dict[str, list[int]]:
    """Which runs each player has finished, in order.

    A run is finished when it reached the last progression index, whether that came from the outro
    questionnaire or straight from the last challenge on a campaign that skips it.
    """
    if not emails:
        return {}
    with get_session() as session:
        rows = session.execute(
            select(User.email, GameProgression.run_index)
            .join(GameProgression, GameProgression.user_id == User.id)
            .where(
                GameProgression.game_progress_index == FINISHED_INDEX,
                User.email.in_(emails),
            )
            .distinct()
        ).all()
    runs: dict[str, list[int]] = {}
    for name, run in rows:
        runs.setdefault(name, []).append(int(run or FIRST_RUN))
    return {name: sorted(values) for name, values in runs.items()}


def _tainted_accounts(campaign_key: str | None) -> set[str]:
    with get_session() as session:
        stmt = select(User.email).where(User.playtest_tainted.is_(True))
        if campaign_key:
            stmt = stmt.where(User.campaign_key == campaign_key)
        return set(session.scalars(stmt).all())


def _canonical_personas() -> PersonaMap:
    """The first persona of every stakeholder, standing in for the per-player draw.

    Admin aggregates span every player, each of whom may have been dealt a different persona
    for the same stakeholder, so there is no single "current player" name to render `{token}`s
    with. `Stakeholder.with_persona` falls back to this same first-persona-in-config identity
    when no persona is bound, which is why it reads as the canonical name elsewhere on this page.
    """
    return {st.id: st.personas[0] for st in StakeholderFactory.stakeholders if st.personas}


def _intel_item_rates(pairs: set[tuple[str, int]], dealt: Counter) -> dict[str, list[dict[str, Any]]]:
    """Which individual intel items players tend to find, and which they walk past.

    The denominator is the runs in which the item's challenge was actually dealt, not every run:
    an item in a challenge a player never saw was never theirs to miss.
    """
    if not pairs:
        return {"most_gathered": [], "least_gathered": []}

    canonical_personas = _canonical_personas()

    with get_session() as session:
        users = {name for name, _ in pairs}
        rows = session.execute(
            select(User.email, IntelItem.run_index, IntelItem.intel_item_data)
            .join(IntelItem, IntelItem.user_id == User.id)
            .where(User.email.in_(users))
        ).all()

    gathered: Counter = Counter()
    for name, run, data in rows:
        if (name, int(run or FIRST_RUN)) in pairs and isinstance(data, dict) and data.get("id"):
            gathered[data["id"]] += 1

    items: list[dict[str, Any]] = []
    for requirement in RequirementFactory.requirements:
        seen_in = dealt.get(requirement.challenge_id, 0)
        if not seen_in:
            continue
        owner = StakeholderFactory.get_stakeholder(requirement.stakeholder_id) if requirement.stakeholder_id else None
        try:
            challenge_name = PhaseFactory.get_challenge_by_id(requirement.challenge_id).name
        except ValueError:
            challenge_name = f"Challenge {requirement.challenge_id}"
        found = gathered.get(requirement.id, 0)
        items.append({
            "id": requirement.id,
            "stakeholder": owner.name if owner else "The environment",
            "challenge": challenge_name,
            "text": personalize(requirement.fact or requirement.description, canonical_personas, resolve_markers=True),
            "gathered": found,
            "dealt": seen_in,
            "rate": round(found / seen_in, 4),
        })

    items.sort(key=lambda item: (-item["rate"], item["id"]))
    return {
        "most_gathered": items[:INTEL_ITEM_TOP],
        "least_gathered": sorted(items, key=lambda item: (item["rate"], item["id"]))[:INTEL_ITEM_TOP],
    }


def _metric_info() -> dict[str, dict[str, str]]:
    """Names, colours and icons for every configured gauge, the same source the player's own HUD
    (and its charts) are coloured from - the admin charts have no per-player session to read this
    off, so it comes straight from the campaign config instead."""
    return {
        metric.id: {"name": metric.name, "metric_color": metric.metric_color, "metric_icon": metric.metric_icon}
        for metric in MetricFactory.metrics
    }


def get_results_dashboard(
    campaign: str | None = None,
    *,
    include_playtest: bool = False,
    runs: RunsMode = "first",
) -> dict[str, Any]:
    """Aggregates over finished runs, plus the player list the drill-down starts from."""
    key = _campaign_key(campaign)
    with get_session() as session:
        valid = get_valid_players_set(session, campaign_key=key, include_playtest=include_playtest)
        campaigns = dict(session.execute(select(User.email, User.campaign_key)).all())

    tainted = _tainted_accounts(key)
    finished = finished_runs(valid)
    with get_session() as session:
        user_ids = dict(session.execute(select(User.email, User.id)).all())

    payloads: dict[tuple[str, int], dict[str, Any]] = {}
    unreadable = 0
    for player, player_runs in finished.items():
        for run in player_runs:
            try:
                payloads[(player, run)] = service.results_for(user_ids[player], run)
            except Exception as e:  # one bad run must not take the whole page down
                print(f"[admin results] could not build {player} run {run}: {e}")
                unreadable += 1

    selected = {pair: p for pair, p in payloads.items() if runs == "all" or pair[1] == FIRST_RUN}

    dealt: Counter = Counter()
    for payload in selected.values():
        for decision in payload.get("decisions", []):
            dealt[decision["challenge_index"]] += 1

    players = []
    for player in sorted(finished):
        entries = []
        for run in finished[player]:
            payload = payloads.get((player, run))
            if payload is None:
                continue
            entries.append({
                "run_index": run,
                "grade": payload["grade"]["grade"],
                "overall": payload["grade"]["overall"],
                "is_spiral": payload["is_spiral"],
            })
        if not entries:
            # Nothing readable to drill into; the run is already counted under `unreadable_runs`.
            continue
        players.append({
            "name": player,
            "campaign_key": campaigns.get(player, ""),
            "playtest_tainted": player in tainted,
            "runs": entries,
        })

    return {
        "options": {"include_playtest": include_playtest, "runs": runs, "campaign": key},
        "aggregates": aggregate.aggregate_results(list(selected.values())),
        "intel_items": _intel_item_rates(set(selected), dealt),
        "metric_info": _metric_info(),
        # Every configured stakeholder in config order plus their display names, so a chart spanning
        # the whole campaign can bind a colour to the entity itself the same way a single run's does.
        "stakeholder_order": list(StakeholderFactory.get_available_stakeholders()),
        "stakeholders": service._stakeholder_names(set(StakeholderFactory.get_available_stakeholders())),
        "players": players,
        # Shown so a researcher can see that accounts were left out, and how many, rather than
        # having a smaller n with no explanation.
        "excluded_playtest_accounts": 0 if include_playtest else len(tainted),
        "unreadable_runs": unreadable,
    }


def get_player_results(player: str, run_index: int | None = None, *, refresh: bool = False) -> dict[str, Any]:
    """One player's results for one run, plus which runs they have finished.

    Defaults to their first finished run. Raises `ValueError` for an unknown player or a run they
    have not finished: the drill-down is for finished games, and a half-played run has no verdict.
    """
    with get_session() as session:
        user = session.scalar(select(User).where(User.email == player))
        if user is None:
            raise ValueError(f"unknown player '{player}'")
        tainted = bool(user.playtest_tainted)
        user_id = user.id

    runs = finished_runs({player}).get(player, [])
    if not runs:
        raise ValueError(f"'{player}' has not finished a game")
    chosen = run_index if run_index is not None else runs[0]
    if chosen not in runs:
        raise ValueError(f"'{player}' has not finished run {chosen}")

    return {
        "player": player,
        "playtest_tainted": tainted,
        "runs": runs,
        "run_index": chosen,
        "results": service.results_for(user_id, chosen, refresh=refresh),
    }
