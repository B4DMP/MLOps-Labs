import asyncio
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect
from .schemas import WSResponse


class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.user_connections: Dict[str, WebSocket] = {}
        # Sockets per player, so a reconnect overlapping the old socket's close doesn't read as offline.
        self._player_sockets: Dict[int, Set[WebSocket]] = {}

    async def connect(
        self, websocket: WebSocket, user_id: int | None = None, read_only: bool = False
    ) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        if user_id:
            self.user_connections[user_id] = websocket
            # An admin viewing as a player (read_only) is not that player being online.
            if not read_only:
                self._player_sockets.setdefault(user_id, set()).add(websocket)
        print(f"[WS] Client connected: user_id='{user_id}' (Total: {len(self.active_connections)})")

    def disconnect(self, websocket: WebSocket, user_id: int | None = None) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if user_id and user_id in self.user_connections:
            del self.user_connections[user_id]
        sockets = self._player_sockets.get(user_id) if user_id else None
        if sockets is not None:
            sockets.discard(websocket)
            if not sockets:
                del self._player_sockets[user_id]
        print(f"[WS] Client disconnected: user_id='{user_id}' (Total: {len(self.active_connections)})")

    def online_user_ids(self) -> set[int]:
        return set(self._player_sockets)

    async def send_to_player(self, user_id: int, event: str, payload: dict) -> int:
        """Pushes to every live socket of one player. Returns how many were reached."""
        sent = 0
        for websocket in list(self._player_sockets.get(user_id, ())):
            sent += await self.send_event(websocket, event, payload)
        return sent

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
