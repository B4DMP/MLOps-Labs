"""Websocket surface for the event log (plan 11, D51).

`log:history` answers a fresh screen with everything logged so far. `send_events` is the one
call other handlers (pitch, offline gathering, simulation, gate) use to persist a batch of
`GameEvent`s a pure function just returned and push it as `log:events` - so every step logs the
same way, through the same store.
"""

from fastapi import WebSocket

from mlops_serious_game.application.event_log_service.store import append_events, load_events
from mlops_serious_game.application.event_log_service.serialize import serialize_event
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.infrastructure.websocket.manager import manager


def _serialize(event: GameEvent) -> dict:
    """Kept as a thin alias: the rendering lives in `event_log_service.serialize`, shared with the
    results screen so the two never render an event differently."""
    return serialize_event(event)


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
