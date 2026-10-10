"""Websocket surface for the case board (docs/plans/case-board.md).

`board:get` is a read and is allowed for an impersonating admin. `board:connect` spends attempts
and writes, so it is not in READ_ONLY_EVENTS.
"""

from fastapi import WebSocket

from mlops_serious_game.application.case_board_service.context import BoardContext, board_context
from mlops_serious_game.application.case_board_service.service import (
    connect,
    get_board,
    reveal_hint,
    sync_on_record,
    toggle_pencil,
)
from mlops_serious_game.application.case_board_service.store import DbBoardStore
from mlops_serious_game.application import debug_flags
from mlops_serious_game.domain.relations import eligible
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.infrastructure.websocket.manager import manager

_store = DbBoardStore()
KINDS = ("ally", "rift", "chain", "step")


def _context(user_id: int, payload: dict):
    return board_context(user_id, payload.get("challenge_id"), payload.get("phase_id"))


def _penciled(ctx: BoardContext) -> list[str]:
    state = _store.load(ctx.key)
    return list(state.penciled) if state else []


def board_state_payload(ctx: BoardContext) -> dict:
    """What the client may know: found threads in full, hinted pairs, guesses
    left. Never a thread that has not been found."""
    if not ctx.visible:
        return {"visible": False, "people": ctx.people, "found": [], "hints": [], "attempts_left": 0}
    board = get_board(_store, ctx.key, ctx.relations, ctx.attempts)
    found = [r.model_dump() for r in board.found]
    payload = {
        "visible": True, "people": ctx.people, "found": found, "hints": board.hints,
        "attempts_left": board.attempts_left, "attempts_total": ctx.attempts,
        "penciled": [i for i in _penciled(ctx) if i in ctx.held_ids],
    }
    if debug_flags.is_enabled("dossier", ctx.key.user_id):
        payload["debug"] = _answer_key(ctx, {r.id for r in board.found})
    return payload


def _answer_key(ctx: BoardContext, found_ids: set[str]) -> list[dict]:
    """Every thread the room has, found or not, and what the player still lacks to find it."""
    key = []
    for rel in ctx.relations:
        lacking = [
            ctx.names.get(person, person)
            for person, ids in ((rel.a, rel.a_item_ids), (rel.b, rel.b_item_ids))
            if not set(ids) & ctx.held_ids
        ]
        key.append({
            **rel.model_dump(),
            "found": rel.id in found_ids,
            "eligible": eligible(rel, ctx.held_ids),
            "lacking": lacking,
        })
    return key


async def push_board_state(websocket: WebSocket, ctx: BoardContext) -> None:
    await manager.send_event(websocket, "board:state", board_state_payload(ctx))


async def _pin_on_record(websocket: WebSocket, user_id: int, ctx: BoardContext) -> None:
    """The challenge's own rift needs no guessing: pin it and log it once."""
    if not ctx.visible:
        return
    _, events = sync_on_record(_store, ctx.key, ctx.relations, ctx.held_ids, ctx.attempts, ctx.names)
    if events:
        await send_events(websocket, user_id, [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in events])


async def handle_board_get(websocket: WebSocket, user_id: int, payload: dict) -> None:
    ctx = _context(user_id, payload)
    if ctx is not None:
        await _pin_on_record(websocket, user_id, ctx)
        await push_board_state(websocket, ctx)


async def handle_board_connect(websocket: WebSocket, user_id: int, payload: dict) -> None:
    ctx = _context(user_id, payload)
    if ctx is None or not ctx.visible:
        return
    await _pin_on_record(websocket, user_id, ctx)
    a, b, kind = payload.get("a"), payload.get("b"), payload.get("kind")
    if a not in ctx.people or b not in ctx.people or kind not in KINDS:
        await manager.send_error(websocket, "That is not a thread you can connect.")
        return

    result = connect(_store, ctx.key, ctx.relations, ctx.held_ids, ctx.holder_of, a, b, kind, ctx.attempts, ctx.names)
    await manager.send_event(websocket, "board:result", {
        "code": result.code,
        "relation": result.relation.model_dump() if result.relation else None,
        "attempts_left": result.attempts_left,
    })
    if result.events:
        stamped = [e.stamped(phase_id=ctx.phase_id, challenge_id=ctx.challenge_id) for e in result.events]
        await send_events(websocket, user_id, stamped)


async def handle_board_pencil(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Ticks or clears a note on the player's own pencil list. A personal marker: it changes nothing in the game."""
    ctx = _context(user_id, payload)
    if ctx is None or not ctx.visible:
        return
    item_id = payload.get("item_id")
    if not isinstance(item_id, str):
        await manager.send_error(websocket, "That is not a note you can pencil in.")
        return
    toggle_pencil(_store, ctx.key, item_id, bool(payload.get("on")), ctx.held_ids, ctx.attempts)
    await push_board_state(websocket, ctx)


async def push_team_sync_hint(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Team Sync-Up (D8): marks one pair that has a thread to find, then refreshes the board."""
    ctx = _context(user_id, payload)
    if ctx is None or not ctx.visible:
        return
    reveal_hint(_store, ctx.key, ctx.relations, ctx.held_ids, ctx.attempts)
    await push_board_state(websocket, ctx)
