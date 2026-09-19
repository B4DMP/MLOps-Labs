from functools import lru_cache
from langgraph.graph import END, START, StateGraph

from mlops_serious_game.application.action_card_veto_service.nodes import generate_veto_message_node
from mlops_serious_game.application.action_card_veto_service.state import ActionCardVetoState


@lru_cache(maxsize=1)
def create_action_card_veto_graph() -> StateGraph:
    """Creates the dedicated LangGraph workflow graph for Action Card Veto generation."""
    graph_builder = StateGraph(ActionCardVetoState)

    graph_builder.add_node("generate_veto_message", generate_veto_message_node)

    graph_builder.add_edge(START, "generate_veto_message")
    graph_builder.add_edge("generate_veto_message", END)

    return graph_builder
