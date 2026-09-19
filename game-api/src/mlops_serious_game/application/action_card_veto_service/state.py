from typing import Any, Optional, TypedDict
from langchain_core.messages import BaseMessage


class ActionCardVetoState(TypedDict, total=False):
    phase_id: int
    challenge_id: int
    challenge_context: str
    action_card_summary: str
    action_card_commitments: list[str]
    stakeholder_id: str
    stakeholder_name: str
    stakeholder_role: str
    stakeholder_power: str
    stakeholder_responsibilities: str
    stakeholder_priorities: str
    stakeholder_constraints: str
    emotional_state: str
    buy_in: float
    boundary_violated: bool
    objection_kind: str
    objection_detail: str
    objection_target: Optional[str]
    pitch_chat_summary: Optional[str]
    veto_message: str
    messages: list[BaseMessage]
