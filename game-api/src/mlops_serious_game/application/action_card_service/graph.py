from langgraph.graph import END, START, StateGraph

from mlops_serious_game.application.action_card_service.nodes import (
    generate_action_card_node,
)
from mlops_serious_game.application.action_card_service.state import ActionCardState


def create_action_card_graph() -> StateGraph:
    """Builds the Action Card synthesis workflow StateGraph."""
    graph_builder = StateGraph(ActionCardState)

    graph_builder.add_node("generate_action_card", generate_action_card_node)
    graph_builder.add_edge(START, "generate_action_card")
    graph_builder.add_edge("generate_action_card", END)

    return graph_builder
