import asyncio
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect
from .schemas import WSResponse


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.user_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, user_id: int | None = None) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        if user_id:
            self.user_connections[user_id] = websocket
        print(f"[WS] Client connected: user_id='{user_id}' (Total: {len(self.active_connections)})")

    def disconnect(self, websocket: WebSocket, user_id: int | None = None) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if user_id and user_id in self.user_connections:
            del self.user_connections[user_id]
        print(f"[WS] Client disconnected: user_id='{user_id}' (Total: {len(self.active_connections)})")

    async def send_event(
        self,
        websocket: WebSocket,
        event: str,
        payload: dict
    ) -> bool:
        response = WSResponse(event=event, payload=payload)
        try:
            await websocket.send_json(response.model_dump(mode="json"))
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
