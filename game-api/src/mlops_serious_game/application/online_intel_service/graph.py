from functools import lru_cache
from langgraph.graph import END, START, StateGraph

from mlops_serious_game.application.online_intel_service.nodes import (
    determine_intel_items_node,
    generate_player_message_node,
    generate_stakeholder_responses_node,
)
from mlops_serious_game.application.online_intel_service.state import OnlineIntelState


@lru_cache(maxsize=1)
def create_online_intel_workflow_graph():
    """Creates the dedicated LangGraph workflow graph for Online Intel Gathering."""
    graph_builder = StateGraph(OnlineIntelState)

    graph_builder.add_node("generate_player_message", generate_player_message_node)
    graph_builder.add_node("determine_intel_items", determine_intel_items_node)
    graph_builder.add_node("generate_stakeholder_responses", generate_stakeholder_responses_node)

    graph_builder.add_edge(START, "generate_player_message")
    graph_builder.add_edge("generate_player_message", "determine_intel_items")
    graph_builder.add_edge("determine_intel_items", "generate_stakeholder_responses")
    graph_builder.add_edge("generate_stakeholder_responses", END)

    return graph_builder
