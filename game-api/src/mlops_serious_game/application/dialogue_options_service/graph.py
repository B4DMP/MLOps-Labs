from functools import lru_cache
from langgraph.graph import END, START, StateGraph

from mlops_serious_game.application.dialogue_options_service.nodes import (
    dialogue_option_node,
)
from mlops_serious_game.application.dialogue_options_service.state import (
    DialogueOptionsState,
)


@lru_cache(maxsize=1)
def create_dialogue_options_graph():
    """Creates the dedicated LangGraph workflow graph for Dialogue Options Generation."""
    graph_builder = StateGraph(DialogueOptionsState)

    graph_builder.add_node("dialogue_option_node", dialogue_option_node)

    graph_builder.add_edge(START, "dialogue_option_node")
    graph_builder.add_edge("dialogue_option_node", END)

    return graph_builder
