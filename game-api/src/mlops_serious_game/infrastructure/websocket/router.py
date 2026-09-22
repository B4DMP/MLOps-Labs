
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
    handle_new_run,
    handle_progress_update,
    handle_state_update_request,
    reset_thread,
)
from .handlers.intel_handler import (
    handle_get_offline_artifacts,
    handle_tag_item,
    handle_get_dossier,
    handle_verify_item,
    handle_play_engagement_card,
    handle_generate_action_card,
)
from .handlers.gather_handler import handle_gather_ask, handle_gather_close, handle_gather_open
from .handlers.graph_handler import handle_graph_state
from .handlers.log_handler import handle_log_history
from .handlers.pitch_handler import (
    handle_pitch_commit,
    handle_pitch_evaluate,
    handle_pitch_set_card,
    handle_pitch_state,
    handle_pitch_veto_breaker,
)
from .handlers.playtest_handler import handle_playtest_auto_card, handle_playtest_skip_challenge
from .handlers.results_handler import handle_results_get
from .handlers.settings_handler import (
    handle_settings_get,
    handle_settings_reset_account,
    handle_settings_update,
)
from .handlers.simulation_handler import handle_simulation_run
from .handlers.system_handler import handle_ping
from .manager import manager

router = APIRouter()

HandlerFunc = Callable[[WebSocket, str, dict], Awaitable[None]]

# Event Registry mapping unified event names to handler functions
EVENT_REGISTRY: dict[str, HandlerFunc] = {
    "game:init": handle_game_init,
    "game:new_run": handle_new_run,
    "game:progress_update": handle_progress_update,
    "game:state_update_request": handle_state_update_request,
    "chat:send_message": handle_chat_message,
    "system:ping": handle_ping,
    "intel:get_offline_artifacts": handle_get_offline_artifacts,
    "intel:tag_item": handle_tag_item,
    "intel:get_dossier": handle_get_dossier,
    "intel:verify_item": handle_verify_item,
    "intel:play_engagement_card": handle_play_engagement_card,
    "intel:generate_action_card": handle_generate_action_card,
    "graph:state_request": handle_graph_state,
    "pitch:state": handle_pitch_state,
    "pitch:set_card": handle_pitch_set_card,
    "pitch:evaluate": handle_pitch_evaluate,
    "pitch:object": handle_pitch_evaluate,  # Alias for backward compatibility
    "pitch:commit": handle_pitch_commit,
    "pitch:veto_breaker": handle_pitch_veto_breaker,
    "simulation:run": handle_simulation_run,
    "log:history": handle_log_history,
    "gather:open": handle_gather_open,
    "gather:ask": handle_gather_ask,
    "gather:close": handle_gather_close,
    "playtest:auto_card": handle_playtest_auto_card,
    "playtest:skip_challenge": handle_playtest_skip_challenge,
    "results:get": handle_results_get,
    "settings:get": handle_settings_get,
    "settings:update": handle_settings_update,
    "settings:reset_account": handle_settings_reset_account,
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
