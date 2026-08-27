from mlops_serious_game.domain.exceptions import RoutingStakeholderNotFound
from typing_extensions import Literal

from langgraph.graph import END

from mlops_serious_game.application.conversation_service.pitch_debat_service.state import PitchDebateState
from mlops_serious_game.config import settings
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

def should_summarize_conversation(
    state: PitchDebateState,
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
    state: PitchDebateState,
) -> Literal["card_generation_connector", "card_generator"]:
     if state.get("phase_id") is None:
        return "card_generation_connector"
     if state.get("generate_card", False):
        return "card_generator"
     return "card_generation_connector"

def passed_anticheat(state: PitchDebateState)->Literal["router", "__end__"]:
    if state.get("cheating_detected")==True:
        return END
    else:
        return "router"
