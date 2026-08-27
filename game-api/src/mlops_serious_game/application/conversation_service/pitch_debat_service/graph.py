from functools import lru_cache

from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import tools_condition

from mlops_serious_game.application.conversation_service.pitch_debat_service.edges import (
    should_summarize_conversation,
    has_more_stakeholders,
    should_generate_action_card,
    passed_anticheat
)
from mlops_serious_game.application.conversation_service.pitch_debat_service.nodes import (
    conversation_node,
    summarize_conversation_node,
    retriever_node,
    summarize_context_node,
    connector_node,
    router_node,
    card_check_node,
    card_gen_node,
    send_message_connector_node,
    anticheat_node
)
from mlops_serious_game.application.conversation_service.pitch_debat_service.state import PitchDebateState


@lru_cache(maxsize=1)
def create_workflow_graph():
    graph_builder = StateGraph(PitchDebateState)

    # Add all nodes
    graph_builder.add_node("conversation_node", conversation_node)
    graph_builder.add_node("retrieve_stakeholder_context", retriever_node)
    graph_builder.add_node("summarize_conversation_node", summarize_conversation_node)
    graph_builder.add_node("summarize_context_node", summarize_context_node)
    graph_builder.add_node("router",router_node)
    graph_builder.add_node("summary_conversation_connector", connector_node)
    graph_builder.add_node("card_generation_connector", send_message_connector_node)
    graph_builder.add_node("card_gen_checker",card_check_node)
    graph_builder.add_node("card_generator",card_gen_node)
    graph_builder.add_node("anticheat_node",anticheat_node)
    # Define the flow
    graph_builder.add_edge(START, "anticheat_node")
    
    # After router, go to conversation_node
    graph_builder.add_edge("router", "conversation_node")
    graph_builder.add_edge("card_generator", "card_generation_connector")
    # If there are more stakeholders to process, go back to conversation_node; else, go to summary_conversation_connector
    graph_builder.add_conditional_edges(
        "anticheat_node",
        passed_anticheat,
        {
            "router": "router",
            END: END
        }
    )
    
    graph_builder.add_conditional_edges(
        "card_generation_connector",
        has_more_stakeholders,
        {
            "conversation_node": "conversation_node",
            "summary_conversation_connector": "summary_conversation_connector"
        }
    )

    graph_builder.add_conditional_edges(
        "card_gen_checker",
        should_generate_action_card,
        {
            "card_generation_connector": "card_generation_connector",
            "card_generator": "card_generator"
        }
    )
    #RAG retrieval
    graph_builder.add_conditional_edges(
        "conversation_node",
        tools_condition,
        {
            "tools": "retrieve_stakeholder_context",
            END: "card_gen_checker"
        }
    )
    graph_builder.add_edge("retrieve_stakeholder_context", "summarize_context_node")
    graph_builder.add_edge("summarize_context_node", "conversation_node")
    
    graph_builder.add_conditional_edges("summary_conversation_connector", should_summarize_conversation)
    graph_builder.add_edge("summarize_conversation_node", END)
    
    return graph_builder

# Compiled without a checkpointer. Used for LangGraph Studio
graph = create_workflow_graph().compile()
