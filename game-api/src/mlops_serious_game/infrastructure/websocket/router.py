
import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from mlops_serious_game.application.persona_service import personas_or_default
from mlops_serious_game.domain.persona_resolver import bind_personas, personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory

from .handlers.chat_handler import handle_chat_message
from .handlers.game_handler import (
    handle_game_init,
    handle_progress_update,
    handle_state_update_request,
    reset_thread,
)
from .handlers.intel_handler import (
    handle_get_offline_artifacts,
    handle_tag_item,
    handle_tag_convincer_event,
    handle_get_dossier,
    handle_verify_item,
    handle_play_engagement_card,
    handle_generate_action_card,
)
from .handlers.graph_handler import handle_graph_state
from .handlers.system_handler import handle_ping
from .manager import manager

router = APIRouter()

HandlerFunc = Callable[[WebSocket, str, dict], Awaitable[None]]

# Event Registry mapping unified event names to handler functions
EVENT_REGISTRY: dict[str, HandlerFunc] = {
    "game:init": handle_game_init,
    "game:progress_update": handle_progress_update,
    "game:state_update_request": handle_state_update_request,
    "chat:send_message": handle_chat_message,
    "system:ping": handle_ping,
    "intel:get_offline_artifacts": handle_get_offline_artifacts,
    "intel:tag_item": handle_tag_item,
    "intel:tag_convincer": handle_tag_convincer_event,
    "intel:get_dossier": handle_get_dossier,
    "intel:verify_item": handle_verify_item,
    "intel:play_engagement_card": handle_play_engagement_card,
    "intel:generate_action_card": handle_generate_action_card,
    "graph:state_request": handle_graph_state,
}


@router.websocket("/ws")
async def unified_websocket_endpoint(
    websocket: WebSocket,
    username: str = Query("guest")
):
    await manager.connect(websocket, username)
    session_id = f"MLOps_Convo_{username}"
    last_gamestate_id = (0,0,0)
    emotion_values_dict={}

    # Bind this player's persona draw for the life of the connection. Every
    # handler, and every task they spawn, inherits it, so config prose and
    # avatars come out personalized without threading the player around.
    bind_personas(personas_or_default(username))

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
                        last_gamestate_id, emotion_values_dict = await handle_game_init(websocket, username, payload)
                    elif event_name == "game:state_update_request":
                        await reset_thread(session_id)
                        last_gamestate_id = list(await handle_state_update_request(websocket, username, payload))
                    elif event_name == "chat:send_message":
                        curr_challenge = PhaseFactory.translate_challenge_index(
                            phase_index=last_gamestate_id[0],
                            challenge_index=last_gamestate_id[1],
                        ) or PhaseFactory.get_challenge_by_id(last_gamestate_id[1])
                        if curr_challenge:
                            payload["challenge"] = payload.get(
                                "challenge",
                                curr_challenge.name
                                + ": "
                                + curr_challenge.roundIntroduction
                                + personalize(curr_challenge.description, resolve_markers=True),
                            )
                            if "phase_id" not in payload:
                                payload["phase_id"] = curr_challenge.phase_id
                            if "challenge_id" not in payload:
                                payload["challenge_id"] = curr_challenge.id
                        payload["session_id"] = session_id
                        asyncio.create_task(handle_chat_message(websocket, username, payload))
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
                    await manager.send_error(websocket, f"Internal server error: {e!s}")
                except:
                    pass
    finally:
        manager.disconnect(websocket, username)
