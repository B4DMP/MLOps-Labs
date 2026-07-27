from langgraph.graph import MessagesState

class ChallengeState(MessagesState):
    """State class for the LangGraph workflow. It keeps track of the information necessary to maintain a coherent
    conversation between the Stakeholder and the user.

    Attributes:
        challenge (str): The current MLOps challenge.
        summary (str): A summary of the conversation. This is used to reduce the token usage of the model.
        stakeholder_ids (list(str)): The ids of the stakeholders that are adressed.
        generate_card: bool: result of action_card_gen_checker
        action_cards: list of generated action cards
    """

    challenge: str
    summary: str
    stakeholder_ids: list[str]
    generate_card: bool
    action_cards: list
    phase_id: int
    cheating_detected: bool

def state_to_str(state: ChallengeState) -> str:
    if "summary" in state and bool(state["summary"]):
        conversation = state["summary"]
    elif "messages" in state and bool(state["messages"]):
        conversation = state["messages"]
    else:
        conversation = ""

    return f"""
ChallengeState(
    challenge={state["challenge"]}, 
    conversation={conversation}
)
    """