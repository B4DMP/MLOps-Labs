from typing import Any
from langgraph.graph import MessagesState


class OnlineIntelState(MessagesState):
    """State class for the Online Intel Gathering LangGraph workflow.
    Dedicated to engagement cards and isolated from Pitch Debate.

    Attributes:
        phase_id (int): Phase index.
        challenge_id (int): Challenge index or ID.
        challenge (str): Context description of current challenge.
        card_id (str): ID of the played engagement card (e.g. 'eng_1').
        stakeholder_ids (list[str]): List of targeted stakeholder IDs.
        player_message (str): LLM-generated player message that initiates the engagement.
        revealed_intel_by_stakeholder (dict[str, list[dict]]): Map of stakeholder_id to revealed intel item dicts.
        stakeholder_responses (list[dict]): List of generated stakeholder responses with metadata.
    """

    phase_id: int
    challenge_id: int
    challenge: str
    card_id: str
    stakeholder_ids: list[str]
    player_message: str
    revealed_intel_by_stakeholder: dict[str, list[dict[str, Any]]]
    stakeholder_responses: list[dict[str, Any]]
