from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from .edges import has_more_stakeholders
from .nodes import (
    conversation_node,
    emotion_node,
    player_prompt_node,
    router_node,
)
from .state import PitchDebateState


@lru_cache(maxsize=1)
def create_pitch_debate_graph():
    graph_builder = StateGraph(PitchDebateState)

    # Add all nodes
    graph_builder.add_node("player_prompt_node", player_prompt_node)
    graph_builder.add_node("router", router_node)
    graph_builder.add_node("emotion_node", emotion_node)
    graph_builder.add_node("conversation_node", conversation_node)

    # Define the flow: START -> player_prompt_node -> router -> emotion_node -> conversation_node
    graph_builder.add_edge(START, "player_prompt_node")
    graph_builder.add_edge("player_prompt_node", "router")
    graph_builder.add_edge("router", "emotion_node")
    graph_builder.add_edge("emotion_node", "conversation_node")

    graph_builder.add_conditional_edges(
        "conversation_node",
        has_more_stakeholders,
        {
            "emotion_node": "emotion_node",
            END: END,
        },
    )

    return graph_builder


create_workflow_graph = create_pitch_debate_graph

# Compiled without a checkpointer. Used for LangGraph Studio
graph = create_pitch_debate_graph().compile()
