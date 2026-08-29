from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from mlops_serious_game.application.dialogue_options_service import dialogue_option_node
from .edges import has_more_stakeholders
from .nodes import (
    conversation_node,
    emotion_node,
    router_node,
)
from .state import PitchDebateState


@lru_cache(maxsize=1)
def create_pitch_debate_graph():
    graph_builder = StateGraph(PitchDebateState)

    # Add all nodes
    graph_builder.add_node("router", router_node)
    graph_builder.add_node("emotion_node", emotion_node)
    graph_builder.add_node("conversation_node", conversation_node)
    graph_builder.add_node("dialogue_option_node", dialogue_option_node)

    # Define the flow
    graph_builder.add_edge(START, "router")
    graph_builder.add_edge("router", "emotion_node")
    graph_builder.add_edge("emotion_node", "conversation_node")

    graph_builder.add_conditional_edges(
        "conversation_node",
        has_more_stakeholders,
        {
            "emotion_node": "emotion_node",
            "dialogue_option_node": "dialogue_option_node",
        },
    )
    graph_builder.add_edge("dialogue_option_node", END)

    return graph_builder


create_workflow_graph = create_pitch_debate_graph

# Compiled without a checkpointer. Used for LangGraph Studio
graph = create_pitch_debate_graph().compile()
