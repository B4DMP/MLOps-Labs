from typing import Any, Optional, TypedDict
from langchain_core.messages import BaseMessage


class StakeholderPitchContext(TypedDict, total=False):
    stakeholder_id: str
    stakeholder_name: str
    responsibilities: str
    priorities: str
    constraints: str
    power: str
    emotional_state: str
    emotion_values: dict[str, float]
    buy_in: float
    band: str
    boundary_violated: bool
    is_approval: bool
    objection_kind: str  # "misclassification", "boundary", "driver", "trade_off", "none"
    objection_detail: str
    objection_target: Optional[str]
    distance: float
    # None on a first pitch; else "unchanged", "answered" or "changed_unanswered" (vs. last pitch).
    repeat_context: Optional[str]


class ActionCardPitchState(TypedDict, total=False):
    phase_id: int
    challenge_id: int
    challenge_context: str
    pitch_attempt: int
    action_card_summary: str
    action_card_commitments: list[str]
    stakeholders: list[StakeholderPitchContext]
    addressed_stakeholders: str

    # Workflow outputs
    player_message: str
    stakeholder_responses: list[dict[str, Any]]
    messages: list[BaseMessage]
