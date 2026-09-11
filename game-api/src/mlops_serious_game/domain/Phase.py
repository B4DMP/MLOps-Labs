from typing import List, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.domain.Challenge import Challenge


class PhaseStakeholder(BaseModel):
    """A stakeholder associated with a phase, with its power and interest levels"""
    stakeholder_id: str = Field(description="The ID of the stakeholder")
    power: str = Field(description="Power level: 'high' or 'low'")
    interest: str = Field(description="Interest level: 'high' or 'low'")


class Phase(BaseModel):
    """A class representing a game Phase
    """

    id: int = Field(description="order of the phase")
    name: str = Field(description="Name of the phase")
    description: str = Field(description="factual description of the phase")
    phase_introduction: str = Field(description="introduction text when phase is started")
    challenges: list[Challenge] = Field(description="challenges that are contained in the phase")
    stakeholders: list[PhaseStakeholder] = Field(default_factory=list, description="stakeholder power/interest map for this phase")
    challenges_per_phase: Optional[int] = Field(
        default=None, description="How many challenges a player plays in this phase; defaults to all of them"
    )

    @property
    def challenge_quota(self) -> int:
        return self.challenges_per_phase if self.challenges_per_phase is not None else len(self.challenges)

    def __str__(self) -> str:
        return self.name
