import json
from typing import Callable, Awaitable, Dict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from .manager import manager
from .schemas import WSEvent
from .handlers.chat_handler import handle_chat_message
from .handlers.game_handler import (
    handle_game_init,
    handle_progress_update,
    handle_state_request,
    reset_thread
)
from .handlers.system_handler import handle_ping
from mlops_serious_game.domain.phase_factory import PhaseFactory

router = APIRouter()

HandlerFunc = Callable[[WebSocket, str, dict], Awaitable[None]]

# Event Registry mapping unified event names to handler functions
EVENT_REGISTRY: Dict[str, HandlerFunc] = {
    "game:init": handle_game_init,
    "game:progress_update": handle_progress_update,
    "game:state_request": handle_state_request,
    "chat:send_message": handle_chat_message,
    "system:ping": handle_ping,
}


@router.websocket("/ws")
async def unified_websocket_endpoint(
    websocket: WebSocket,
    username: str = Query("guest")
):
    await manager.connect(websocket, username)
    session_id = f"MLOps_Convo_{username}"
    last_gamestate_id = [0, 0]

    try:
        while True:
            try:
                raw_message = await websocket.receive_text()
                data = json.loads(raw_message)

                event_name = data.get("event")
                payload = data.get("payload", data)

                if not event_name:
                    await manager.send_error(websocket, "Missing required field: 'event'")
                    continue

                if event_name in EVENT_REGISTRY:
                    handler = EVENT_REGISTRY[event_name]
                    if event_name == "game:init":
                        last_gamestate_id = list(await handle_game_init(websocket, username, payload))
                    elif event_name == "game:state_request":
                        last_gamestate_id = list(await handle_state_request(websocket, username, payload))
                        await reset_thread(session_id)
                    elif event_name == "chat:send_message":
                        curr_challenge = PhaseFactory.get_challenge_by_index(last_gamestate_id[0], last_gamestate_id[1])
                        if curr_challenge:
                            payload["challenge"] = payload.get(
                                "challenge",
                                curr_challenge.name + ": " + curr_challenge.roundIntroduction + curr_challenge.description
                            )
                            if "phase_id" not in payload:
                                payload["phase_id"] = curr_challenge.phase_id
                        payload["session_id"] = session_id
                        await handle_chat_message(websocket, username, payload)
                    else:
                        await handler(websocket, username, payload)
                else:
                    await manager.send_error(websocket, f"Unknown event name: '{event_name}'")

            except (WebSocketDisconnect, RuntimeError):
                break
            except Exception as e:
                print(f"[WS Router Exception] {e}")
                import traceback
                traceback.print_exc()
                try:
                    await manager.send_error(websocket, f"Internal server error: {str(e)}")
                except:
                    pass
    finally:
        manager.disconnect(websocket, username)
