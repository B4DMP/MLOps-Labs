import asyncio
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect
from .schemas import WSResponse


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.user_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, username: str | None = None) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        if username:
            self.user_connections[username] = websocket
        print(f"[WS] Client connected: username='{username}' (Total: {len(self.active_connections)})")

    def disconnect(self, websocket: WebSocket, username: str | None = None) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if username and username in self.user_connections:
            del self.user_connections[username]
        print(f"[WS] Client disconnected: username='{username}' (Total: {len(self.active_connections)})")

    async def send_event(
        self,
        websocket: WebSocket,
        event: str,
        payload: dict
    ) -> bool:
        response = WSResponse(event=event, payload=payload)
        try:
            await websocket.send_json(response.model_dump())
            return True
        except (WebSocketDisconnect, RuntimeError):
            return False

    async def send_error(
        self,
        websocket: WebSocket,
        message: str,
        code: str = "ERROR"
    ) -> bool:
        return await self.send_event(
            websocket=websocket,
            event="system:error",
            payload={"code": code, "message": message}
        )


manager = ConnectionManager()
