from fastapi import WebSocket
from ..manager import manager


async def handle_ping(
    websocket: WebSocket,
    user_id: int,
    payload: dict
) -> None:
    await manager.send_event(
        websocket=websocket,
        event="system:pong",
        payload={"timestamp": payload.get("timestamp")}
    )
