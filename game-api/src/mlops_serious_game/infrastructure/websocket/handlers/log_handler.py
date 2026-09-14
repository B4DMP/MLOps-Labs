"""Websocket surface for the event log (plan 11, D51).

`log:history` answers a fresh screen with everything logged so far. `send_events` is the one
call other handlers (pitch, offline gathering, simulation, gate) use to persist a batch of
`GameEvent`s a pure function just returned and push it as `log:events` - so every step logs the
same way, through the same store.
"""

from fastapi import WebSocket

from mlops_serious_game.application.event_log_service.store import append_events, load_events
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.event_causes import EventCauseFactory
from mlops_serious_game.infrastructure.websocket.manager import manager


def _serialize(event: GameEvent) -> dict:
    """The event plus its rendered cause text - causes are config templates, never LLM text
    (plan 11, D51), so the frontend never needs its own copy of `EventCauses.json` to show them."""
    params = dict(event.params or {})
    if event.cause == "outcome.veto" and not params.get("st"):
        params["st"] = "the room"
    try:
        text = EventCauseFactory.render(event.cause, params)
    except Exception:
        text = event.cause
    return {**event.model_dump(mode="json"), "text": text}


async def send_events(websocket: WebSocket, username: str, events: list[GameEvent]) -> list[GameEvent]:
    """Persists `events` (assigning them their real `seq`) and pushes them as `log:events`.
    A no-op, sending nothing, when there is nothing to log."""
    if not events:
        return []
    stamped = append_events(username, events)
    await manager.send_event(
        websocket=websocket, event="log:events", payload={"events": [_serialize(e) for e in stamped]}
    )
    return stamped


async def handle_log_history(websocket: WebSocket, username: str, payload: dict) -> None:
    since_seq = payload.get("since_seq", 0)
    events = load_events(username, since_seq=since_seq)
    await manager.send_event(
        websocket=websocket, event="log:history", payload={"events": [_serialize(e) for e in events]}
    )
