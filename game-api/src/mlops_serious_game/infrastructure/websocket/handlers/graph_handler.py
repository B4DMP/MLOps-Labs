"""Handles graph:state_request — pushes the graph view to the client."""

from typing import Optional
from fastapi import WebSocket

from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.application.graph_service.graph_state_view import build_graph_state
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.pattern import PatternFactory

from ..manager import manager


async def push_graph_state(websocket: WebSocket, username: str, phase_id: Optional[int] = None) -> None:
    """Loads ground truth, evaluates, and pushes graph:state to the client."""
    graph = GraphFactory.get_graph()
    replay = graph_store.load_state(username)
    evaluation = evaluate_graph(graph, replay.state, PatternFactory.patterns, PatternFactory.order)

    view = build_graph_state(
        graph=graph,
        state=replay.state,
        effective=evaluation.effective,
        stage_view=evaluation.stage_graph,
        patterns=PatternFactory.patterns,
        active_patterns=evaluation.active_patterns,
        current_phase_id=phase_id,
    )

    await manager.send_event(websocket, "graph:state", view)


async def handle_graph_state(websocket: WebSocket, username: str, payload: dict) -> None:
    """Loads ground truth, evaluates, and pushes graph:state to the requesting client."""
    phase_id: Optional[int] = payload.get("phase_id")
    await push_graph_state(websocket, username, phase_id)
