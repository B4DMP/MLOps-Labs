from functools import lru_cache
from langgraph.graph import END, START, StateGraph

from mlops_serious_game.application.action_card_pitch_service.nodes import (
    generate_player_pitch_node,
    generate_stakeholder_pitch_responses_node,
)
from mlops_serious_game.application.action_card_pitch_service.state import ActionCardPitchState


@lru_cache(maxsize=1)
def create_action_card_pitch_graph() -> StateGraph:
    """Creates the dedicated LangGraph workflow graph for Action Card Pitch Resolution."""
    graph_builder = StateGraph(ActionCardPitchState)

    graph_builder.add_node("generate_player_pitch", generate_player_pitch_node)
    graph_builder.add_node("generate_stakeholder_pitch_responses", generate_stakeholder_pitch_responses_node)

    graph_builder.add_edge(START, "generate_player_pitch")
    graph_builder.add_edge("generate_player_pitch", "generate_stakeholder_pitch_responses")
    graph_builder.add_edge("generate_stakeholder_pitch_responses", END)

    return graph_builder
