from fastapi import WebSocket
from ..manager import manager


async def handle_ping(
    websocket: WebSocket,
    username: str,
    payload: dict
) -> None:
    await manager.send_event(
        websocket=websocket,
        event="system:pong",
        payload={"timestamp": payload.get("timestamp")}
    )
