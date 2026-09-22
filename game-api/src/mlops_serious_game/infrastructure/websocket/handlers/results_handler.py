"""Websocket surface for the end-of-game results screen (docs/plans/results-screen.md).

`results:get` answers with the whole payload the screen renders: grade, the four pillars, the
metric gauges at rest, the end-state pipeline, the knowledge delta and the event timeline.

A player may only ever ask for their own results. `username` comes from the connection, never
from the payload, so a crafted frame cannot read another player's game.
"""

from fastapi import WebSocket

from mlops_serious_game.application.results_service import service as results_service

from ..manager import manager


async def handle_results_get(websocket: WebSocket, username: str, payload: dict) -> None:
    """Sends `results:data` for the player's current run, or a named earlier one.

    `refresh` recomputes rather than reading the cache, which is what a player who reopens the
    screen after playing further needs.
    """
    run_index = payload.get("run_index")
    try:
        run_index = int(run_index) if run_index is not None else None
    except (TypeError, ValueError):
        await manager.send_error(websocket, "run_index must be a number.", code="BAD_RUN_INDEX")
        return

    try:
        data = results_service.results_for(
            username, run_index, refresh=bool(payload.get("refresh"))
        )
    except ValueError as e:
        await manager.send_error(websocket, str(e), code="NO_SUCH_PLAYER")
        return

    await manager.send_event(websocket=websocket, event="results:data", payload=data)
