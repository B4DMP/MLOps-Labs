"""Websocket surface for the per-player settings profile (docs/plans/player-settings-and-tts.md).

`settings:get` and `settings:update` both answer with the full `settings:data` payload, plus
`can_reset_account` read straight off `settings.ENABLE_RESET_USER` so the UI renders the reset
button off that one field. `settings:reset_account` is gated server-side: the flag is the only
thing standing between a crafted websocket frame and a wiped account.
"""

from fastapi import WebSocket

from mlops_serious_game.application.services import user_settings_service
from mlops_serious_game.application.services.admin_service import reset_player
from mlops_serious_game.config import settings

from ..manager import manager


async def _send_settings_data(websocket: WebSocket, data: dict) -> None:
    await manager.send_event(
        websocket=websocket,
        event="settings:data",
        payload={
            **data,
            "can_reset_account": settings.ENABLE_RESET_USER,
            "can_playtest": settings.ENABLE_PLAYTEST_TOOLS,
        },
    )


async def handle_settings_get(websocket: WebSocket, username: str, payload: dict) -> None:
    await _send_settings_data(websocket, user_settings_service.get_settings(username))


async def handle_settings_update(websocket: WebSocket, username: str, payload: dict) -> None:
    await _send_settings_data(websocket, user_settings_service.update_settings(username, payload))


async def handle_settings_reset_account(websocket: WebSocket, username: str, payload: dict) -> None:
    if not settings.ENABLE_RESET_USER:
        await manager.send_error(websocket, "Account reset is disabled.", code="RESET_DISABLED")
        return
    if payload.get("confirm") is not True:
        await manager.send_error(websocket, "Account reset requires confirmation.", code="RESET_NOT_CONFIRMED")
        return

    reset_player(username)
    await manager.send_event(websocket=websocket, event="settings:account_reset", payload={})
