"""The simulation phase over websocket (plan 07 steps 7 and 9).

One event: `simulation:run` takes the card the player committed in the pitch phase, runs the
deterministic pipeline, and sends back `graph:delta_report`. The pipeline is idempotent per
challenge, so asking twice does not apply the card twice.
"""

from typing import Any, Optional

from fastapi import WebSocket

from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.pipeline import (
    PASS,
    SOFT_PASS,
    STALEMATE,
    VETO_BROKEN,
    run_simulation,
)
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.domain.emotion import SIMULATION_OUTCOMES
from mlops_serious_game.domain.grudge import Grudge
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import item_target_and_level
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.infrastructure.websocket.handlers.pitch_handler import PitchContext

from ..manager import manager

# What the pitch outcome means to the pipeline. A veto that was never broken never gets here.
OUTCOME_MAP = {
    "PASS": PASS,
    "SOFT_PASS": SOFT_PASS,
    "STALEMATE": STALEMATE,
}


def _outcome_for(state: "pitch.PitchState") -> str:
    patience = getattr(state, "patience", None)
    if state.outcome == "PASS" and patience and any(p <= 0 for p in patience.values()):
        # Patience at zero with the card through means it was pushed through (D7).
        return VETO_BROKEN
    return OUTCOME_MAP.get(state.outcome or "PASS", PASS)


def _overridden(state: "pitch.PitchState") -> Optional[str]:
    spent = [st_id for st_id, left in (getattr(state, "patience", None) or {}).items() if left <= 0]
    return spent[0] if spent else None


def _story(report: Any, sim_deltas: Optional[dict] = None) -> dict[str, Any]:
    """The report as the screen reads it, with persona names rendered."""
    data = report.model_dump(mode="json")
    for target in data.get("targets", []):
        target["story"] = personalize(target.get("story") or "")
        if target.get("name"):
            target["name"] = personalize(target["name"])
        if target.get("owner_name"):
            target["owner_name"] = personalize(target["owner_name"])
    for event in data.get("world_events", []):
        event["reason"] = personalize(event.get("reason") or "")
    for st in data.get("stakeholders", []):
        st["story"] = personalize(st.get("story") or "")
        st["name"] = personalize(st.get("name") or "")
        st_id = st.get("stakeholder_id")
        if sim_deltas and st_id in sim_deltas:
            st["emotion_deltas"] = sim_deltas[st_id]
    return data


def _calculate_simulation_emotion_deltas(
    report: Any,
    card_items: list,
    room_st_ids: list[str],
    all_intel: Optional[list] = None,
) -> dict[str, dict[str, float]]:
    deltas: dict[str, dict[str, float]] = {}
    capped_targets = {
        getattr(t, "id", None)
        for t in getattr(report, "targets", [])
        if getattr(t, "capped_by", None)
    }
    has_debt = bool(getattr(report, "debt_created", []))

    card_targets = set()
    for item in card_items:
        if isinstance(item, pitch.AtomicChange) or hasattr(item, "target"):
            t = getattr(item, "target", None)
            if t:
                card_targets.add(t)
        suggested = getattr(item, "suggested", None)
        if suggested and getattr(suggested, "target", None):
            card_targets.add(suggested.target)
        for raw_op in getattr(item, "ops", None) or []:
            if isinstance(raw_op, dict) and "target" in raw_op:
                card_targets.add(raw_op["target"])

    for st_id in room_st_ids:
        st_items = [i for i in card_items if getattr(i, "stakeholder_id", None) == st_id]
        st_targets = set()
        for item in st_items:
            suggested = getattr(item, "suggested", None)
            if suggested and getattr(suggested, "target", None):
                st_targets.add(suggested.target)
            for raw_op in getattr(item, "ops", None) or []:
                if isinstance(raw_op, dict) and "target" in raw_op:
                    st_targets.add(raw_op["target"])

        if not st_targets and all_intel:
            for item in all_intel:
                if getattr(item, "stakeholder_id", None) == st_id:
                    t, _ = item_target_and_level(item)
                    if t and t in card_targets:
                        st_targets.add(t)

        if not st_targets:
            if has_debt:
                deltas[st_id] = dict(SIMULATION_OUTCOMES["technical_debt"])
            continue

        if st_targets and any(t in capped_targets for t in st_targets):
            deltas[st_id] = dict(SIMULATION_OUTCOMES["capped_delivery"])
        elif has_debt:
            deltas[st_id] = dict(SIMULATION_OUTCOMES["technical_debt"])
        else:
            deltas[st_id] = dict(SIMULATION_OUTCOMES["clean_delivery"])

    return deltas


async def handle_simulation_run(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = pitch_store.load_pitch(username, ctx.phase_id, ctx.challenge_id) or pitch.start_pitch(ctx.room_ids)
    view = ctx.view(state)
    grudges = [Grudge.model_validate(g) for g in pitch_store.load_grudges(username)]
    c_items = state.atomic_changes if getattr(state, "atomic_changes", None) else (
        pitch.card_items(list(ctx.all_intel), set(getattr(state, "card_item_ids", [])))
        if getattr(state, "card_item_ids", None)
        else []
    )

    result = run_simulation(
        username,
        challenge=ctx.challenge,
        outcome=_outcome_for(state),
        card_items=c_items,
        reads=view.reads,
        grudges=grudges,
        overridden_stakeholder_id=_overridden(state),
        upcoming_world_events=_upcoming_world_events(ctx),
        names=ctx.names,
    )

    pitch_store.replace_grudges(username, [g.model_dump(mode="json") for g in result.grudges])
    sim_deltas = _calculate_simulation_emotion_deltas(result.report, c_items, ctx.room_ids, list(ctx.all_intel))
    if sim_deltas:
        pitch_store.apply_emotion_deltas(username, sim_deltas, ctx.room_ids)

    next_challenge = _next_challenge_name(username, ctx)
    events = list(result.events) + [_gate_event(next_challenge)]
    await send_events(
        websocket, username, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events]
    )
    await manager.send_event(
        websocket=websocket,
        event="graph:delta_report",
        payload={
            "phase_id": ctx.phase_id,
            "challenge_id": ctx.challenge_id,
            "report": _story(result.report, sim_deltas),
            "pending_objections": [p.model_dump(mode="json") for p in result.pending_objections],
            "next_challenge": next_challenge,
        },
    )


def _gate_event(next_challenge: Optional[dict]):
    """Gate 7 (plan 11, D51): the path the phase/challenge scheduler picked, and a coarse reason.

    The scheduler (`graph_service.scheduler`) does not currently return *why* it favoured one
    template over another (priority vs. stable_rank vs. fallback) - only what it picked. Naming
    the destination is what step 10 asks for; a finer-grained "why this one, not that one" would
    need `select_in_phase` itself to explain its choice, which is a larger change left for later.
    """
    from mlops_serious_game.domain.event import GameEvent

    if next_challenge is None:
        return GameEvent(step="gate", kind="outcome", direction="none", cause="outcome.gate_end")
    return GameEvent(
        step="gate", kind="outcome", direction="none", cause="outcome.gate_next",
        params={"phase": next_challenge["phase_name"] or next_challenge["name"], "challenge": next_challenge["name"]},
        refs={"challenge_id": next_challenge["id"], "phase_id": next_challenge["phase_id"]},
    )


def _upcoming_world_events(ctx: PitchContext) -> list:
    """What a grudge can pull forward: the next challenge's own world events (plan 07, Q28)."""
    from mlops_serious_game.domain.graph import GraphOp

    nxt = _next_challenge(ctx.username, ctx)
    if nxt is None:
        return []
    return [
        GraphOp.model_validate({**raw, "source_kind": "world_event", "source_id": f"early:{nxt.template_id}"})
        for raw in (nxt.on_enter_ops or [])
    ]


def _next_challenge(username: str, ctx: PitchContext):
    """Step 9: the report ends by naming what comes next, picked from the settled graph."""
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import select_next_challenge

    try:
        return select_next_challenge(username, ctx.phase_id, ctx.challenge_id)
    except Exception as e:  # selection must never block the report
        print(f"[Simulation next challenge error] {e}")
        return None


def _next_challenge_name(username: str, ctx: PitchContext) -> Optional[dict]:
    nxt = _next_challenge(username, ctx)
    if nxt is None:
        return None
    phases = PhaseFactory.get_phases()
    return {
        "id": nxt.id,
        "phase_id": nxt.phase_id,
        "name": personalize(nxt.name),
        "phase_name": phases[nxt.phase_id].name if 0 <= nxt.phase_id < len(phases) else "",
    }


__all__ = ["handle_simulation_run"]
