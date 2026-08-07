from philoagents.domain.exceptions import RoutingStakeholderNotFound
from typing_extensions import Literal

from langgraph.graph import END

from philoagents.application.conversation_service.workflow.state import ChallengeState
from philoagents.config import settings
from philoagents.domain.stakeholder_factory import StakeholderFactory

def should_summarize_conversation(
    state: ChallengeState,
) -> Literal["summarize_conversation_node", "__end__"]:
    messages = state["messages"]

    if len(messages) > settings.TOTAL_MESSAGES_SUMMARY_TRIGGER:
        return "summarize_conversation_node"

    return END

def has_more_stakeholders(state):
    # Assumes state["remaining_stakeholders"] is a list
    remaining = state.get("stakeholder_ids", [])
    if len(remaining) != 0:
        return "conversation_node"
    else:
        return "summary_conversation_connector"
        
def should_generate_action_card(
    state: ChallengeState,
) -> Literal["card_generation_connector", "card_generator"]:
     if state.get("phase_id") is None:
        return "card_generation_connector"
     if state.get("generate_card", False):
        return "card_generator"
     return "card_generation_connector"

def passed_anticheat(state: ChallengeState)->Literal["router", "__end__"]:
    if state.get("cheating_detected")==True:
        return END
    else:
        return "router"
