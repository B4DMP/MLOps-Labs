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
from mlops_serious_game.domain.grudge import Grudge
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
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
    if state.outcome == "PASS" and state.patience and any(p <= 0 for p in state.patience.values()):
        # Patience at zero with the card through means it was pushed through (D7).
        return VETO_BROKEN
    return OUTCOME_MAP.get(state.outcome or "PASS", PASS)


def _overridden(state: "pitch.PitchState") -> Optional[str]:
    spent = [st_id for st_id, left in (state.patience or {}).items() if left <= 0]
    return spent[0] if spent else None


def _story(report: Any) -> dict[str, Any]:
    """The report as the screen reads it, with persona names rendered."""
    data = report.model_dump(mode="json")
    for target in data.get("targets", []):
        target["story"] = personalize(target.get("story") or "")
    for event in data.get("world_events", []):
        event["reason"] = personalize(event.get("reason") or "")
    return data


async def handle_simulation_run(websocket: WebSocket, username: str, payload: dict) -> None:
    ctx = PitchContext(username, payload.get("phase_id", 0), payload.get("challenge_id", 0))
    state = pitch_store.load_pitch(username, ctx.phase_id, ctx.challenge_id) or pitch.start_pitch(ctx.room_ids)
    view = ctx.view(state)
    grudges = [Grudge.model_validate(g) for g in pitch_store.load_grudges(username)]

    result = run_simulation(
        username,
        challenge=ctx.challenge,
        outcome=_outcome_for(state),
        card_items=pitch.card_items(list(ctx.all_intel), set(state.card_item_ids)),
        reads=view.reads,
        grudges=grudges,
        overridden_stakeholder_id=_overridden(state),
        upcoming_world_events=_upcoming_world_events(ctx),
        names=ctx.names,
    )

    pitch_store.replace_grudges(username, [g.model_dump(mode="json") for g in result.grudges])
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
            "report": _story(result.report),
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
