from pathlib import Path
from typing import List, Dict

from pydantic import BaseModel, Field

class ChallengeStakeholder(BaseModel):
    """A stakeholder included in a specific challenge, with associated power and interest levels"""
    stakeholder_id: str = Field(description="The ID of the stakeholder")
    power: str = Field(description="Power level: 'high' or 'low'")
    interest: str = Field(description="Interest level: 'high' or 'low'")


class Challenge(BaseModel):
    """A class representing a game Challenge"""

    id: int = Field(description="order of the challenge in the corresponding phase")
    phase_id: int = Field(description="index of the phase, that the challenge belongs to")
    name: str = Field(description="Title of the challenge")
    description: str = Field(description="Description of the challenge")
    roundIntroduction: str = Field(description="introduction text of the challenge")
    metric_changes: dict[str, int] = Field(description="changes in game metrics when the challenge is started")
    stakeholders: List[ChallengeStakeholder] = Field(default_factory=list, description="stakeholders included in the challenge")

    def __str__(self) -> str:
        return self.name
