"""Playtest tools over websocket (docs/plans/results-screen.md, D9/D10).

Two events, both gated server-side by `ENABLE_PLAYTEST_TOOLS` in the mould of the account reset: the
flag is the only thing between a crafted websocket frame and a fabricated run, so it is checked
here and never trusted from the client.

- `playtest:auto_card` finds a card the room will not veto and puts it in the pitch builder, for the
  tester to look at and commit themselves. Never spends an Escalation Point on its own - that
  choice stays with whoever is testing.
- `playtest:skip_challenge` carries the current challenge to its end through the game's own
  handlers, then asks the client to reload into wherever that led. When no card exists that the
  room accepts (a structural veto), it uses the same Veto Breaker a stuck human player has rather
  than looping forever; only out of Escalation Points does it actually refuse.

Using either marks the account as a playtest account **before** doing anything, and permanently:
contamination does not stay inside the challenge that caused it, so nothing downstream of this is
research data. Every card goes through the normal `pitch:set_card` / `pitch:commit` path rather
than being written to the store, so every emotion delta, objection, event and graph op is produced
exactly as in a human play, which is what keeps the resulting statistics calculable.
"""

import asyncio
from typing import Optional

from fastapi import WebSocket
from sqlalchemy import select

from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.application.playtest_service import auto_card, service
from mlops_serious_game.config import settings
from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.graph import GraphOp
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import GameChallenge
from mlops_serious_game.infrastructure.database.run_scope import current_run_index
from mlops_serious_game.infrastructure.database.user_lookup import get_user_id

from ..manager import manager
from .game_handler import handle_state_update_request
from .pitch_handler import (
    PitchContext,
    get_allowed_targets,
    handle_pitch_commit,
    handle_pitch_set_card,
    handle_pitch_veto_breaker,
)
from .simulation_handler import handle_simulation_run

# Outcomes that let the challenge move on. A veto keeps the player in the pitch.
NON_VETO = ("PASS", "SOFT_PASS")


async def _allowed(websocket: WebSocket) -> bool:
    if settings.ENABLE_PLAYTEST_TOOLS:
        return True
    await manager.send_error(websocket, "Playtest tools are disabled.", code="PLAYTEST_DISABLED")
    return False


def _current(username: str) -> Optional[tuple[Challenge, GameChallenge]]:
    """The challenge the player is on now: the latest row of the current run, and its challenge."""
    with get_session() as session:
        user_id = get_user_id(session, username)
        row = session.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id, GameChallenge.run_index == current_run_index(session, user_id))
            .order_by(GameChallenge.id.desc())
        ).first()
        if row is None:
            return None
        challenge = PhaseFactory.translate_challenge_index(
            challenge_index=row.challenge_index, phase_index=row.phase_index
        )
        session.expunge(row)
        return (challenge, row) if challenge else None


def _observe_everything(username: str, challenge: Challenge, ctx: PitchContext) -> None:
    """Lifts the fog on every target the player may touch in this phase.

    The game does this for correctly tagged Facts. A playtest run has not tagged anything, and a
    card can only be built on targets the player has looked at, so it is done for all of them.
    Idempotent per challenge.
    """
    source_id = f"playtest:{challenge.template_id}"
    if graph_store.has_batch(username, source_id):
        return
    targets = get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel))
    if not targets:
        return
    graph_store.append_ops(
        username,
        [GraphOp(kind="observe", target=t, source_kind="intel", source_id=source_id) for t in targets],
        phase_index=challenge.phase_id,
        challenge_template=challenge.template_id,
        source_kind="intel",
        source_id=source_id,
    )


def _prepare(username: str, challenge: Challenge) -> PitchContext:
    """Fills the dossier and the fog, then builds the context the search reads."""
    service.auto_gather(username, challenge)
    _observe_everything(username, challenge, PitchContext(username, challenge.phase_id, challenge.id))
    # A fresh context: the search must see the knowledge that was just granted.
    return PitchContext(username, challenge.phase_id, challenge.id)


def _search(username: str, ctx: PitchContext) -> Optional[auto_card.CardSearchResult]:
    with get_session() as session:
        run = current_run_index(session, get_user_id(session, username))
    return auto_card.search_card(
        graph=ctx.graph,
        state=ctx.state,
        knowledge=ctx.knowledge,
        all_intel=list(ctx.all_intel),
        room=ctx.room,
        emotions=ctx.emotions,
        allowed=get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)),
        # Reproducible for a given player, run and challenge.
        seed=f"{username}:{run}:{ctx.challenge_id}",
    )


def _changes_payload(result: auto_card.CardSearchResult) -> list[dict]:
    return [c.model_dump() for c in result.changes]


async def handle_playtest_auto_card(websocket: WebSocket, username: str, payload: dict) -> None:
    """Finds a random card the room will not veto and slots it into the pitch builder."""
    if not await _allowed(websocket):
        return
    service.taint_user(username)

    current = _current(username)
    if current is None:
        await manager.send_error(websocket, "There is no challenge in progress.", code="NO_CHALLENGE")
        return
    challenge, _row = current

    ctx = await asyncio.to_thread(_prepare, username, challenge)
    result = await asyncio.to_thread(_search, username, ctx)

    if result is None or not result.found_non_veto:
        # Said plainly instead of slotting a card that would be vetoed: there may simply be no
        # clean card in this room, and that is a fact about the room, not a failure of the tool.
        await manager.send_event(
            websocket=websocket,
            event="playtest:auto_card_result",
            payload={
                "ok": False,
                "outcome": result.outcome if result else None,
                "evaluated": result.evaluated if result else 0,
                "min_buy_in": result.min_buy_in if result else None,
                "reason": "nothing_to_slot" if result is None else "no_non_veto_card",
            },
        )
        return

    await handle_pitch_set_card(
        websocket,
        username,
        {"phase_id": challenge.phase_id, "challenge_id": challenge.id, "atomic_changes": _changes_payload(result)},
    )
    await manager.send_event(
        websocket=websocket,
        event="playtest:auto_card_result",
        payload={
            "ok": True,
            "outcome": result.outcome,
            "changes": _changes_payload(result),
            "evaluated": result.evaluated,
            "choices": result.pool,
            "min_buy_in": result.min_buy_in,
        },
    )


def _metric_values_for(row: GameChallenge) -> list:
    """The values the real client would send when the player proceeds: what is stored for the
    challenge, or the starting values if nothing is."""
    stored = list(row.metric_values) if isinstance(row.metric_values, list) else []
    if stored:
        return stored
    return [MetricFactory.get_metric(m).start_value for m in MetricFactory.get_available_metrics()]


async def _break_the_stood_veto(websocket: WebSocket, username: str, ids: dict) -> bool:
    """Spends a real Escalation Point (D15) to get past a structural veto - a challenge where the
    search proved no card the room accepts exists, not merely one it failed to find.

    This is the same tool a human player has in `VetoDialog`, called on the tester's behalf: the
    playtest tools exist to manufacture progress, and refusing to progress past a room that
    genuinely cannot be won by any card would defeat that, when the game already has a legitimate
    way through. Returns whether it actually broke the veto (false only when there are no
    Escalation Points left, at which point this really is the end of the road).
    """
    if pitch_store.escalation_points(username) <= 0:
        return False
    await handle_pitch_veto_breaker(websocket, username, ids)
    return True


async def handle_playtest_skip_challenge(websocket: WebSocket, username: str, payload: dict) -> None:
    """Carries the current challenge to its end through the game's own handlers.

    Gather, pitch, simulate, then the same state update the "Proceed" button sends. When no card
    the room accepts exists at all (a structural veto - see `auto_card`'s module docstring), this
    commits the closest the search found and pushes it through with an Escalation Point, the same
    tool a human stuck in the same room has (`pitch:veto_breaker`). Only refuses outright when
    there is nothing to build a card on, or no Escalation Points left to force one through.
    """
    if not await _allowed(websocket):
        return
    service.taint_user(username)

    current = _current(username)
    if current is None:
        await manager.send_error(websocket, "There is no challenge in progress.", code="NO_CHALLENGE")
        return
    challenge, row = current
    ids = {"phase_id": challenge.phase_id, "challenge_id": challenge.id}

    ctx = await asyncio.to_thread(_prepare, username, challenge)
    pitched = pitch_store.load_pitch(username, challenge.phase_id, challenge.id)
    already_through = bool(pitched and pitched.stage == "DONE" and pitched.outcome in NON_VETO)

    if not already_through:
        result = await asyncio.to_thread(_search, username, ctx)
        if result is None:
            await manager.send_event(
                websocket=websocket,
                event="playtest:skip_result",
                payload={"ok": False, "reason": "nothing_to_slot", "outcome": None, "evaluated": 0},
            )
            return

        await handle_pitch_commit(websocket, username, {**ids, "atomic_changes": _changes_payload(result)})

        if not result.found_non_veto:
            broke_it = await _break_the_stood_veto(websocket, username, ids)
            if not broke_it:
                await manager.send_event(
                    websocket=websocket,
                    event="playtest:skip_result",
                    payload={
                        "ok": False,
                        "reason": "no_non_veto_card_and_no_escalation_points",
                        "outcome": result.outcome,
                        "evaluated": result.evaluated,
                        "min_buy_in": result.min_buy_in,
                    },
                )
                return

    await handle_simulation_run(websocket, username, ids)
    service.mark_auto_played(username, challenge.phase_id, challenge.id)

    # The same request the "Proceed to next milestone" button sends.
    await handle_state_update_request(
        websocket,
        username,
        {
            **ids,
            "challenge_loop_index": 3,
            "metric_values": _metric_values_for(row),
            "action_card_id": None,
            "messages": [],
            "attention_tokens": row.attention_tokens,
        },
    )
    # The client's screens were left mid-challenge; reloading re-runs the normal game init and lands
    # it wherever that led, next challenge or end of game alike.
    await manager.send_event(websocket=websocket, event="playtest:skipped", payload={"ok": True, **ids})
