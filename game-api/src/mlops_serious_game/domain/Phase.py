from pathlib import Path
from typing import List

from pydantic import BaseModel, Field

from mlops_serious_game.domain.Challenge import Challenge

class Phase(BaseModel):
    """A class representing a game Phase
    """

    id: int = Field(description="order of the phase")
    name: str = Field(description="Name of the phase")
    description: str = Field(description="factual description of the phase")
    phase_introduction: str = Field(description="introduction text when phase is started")
    challenges: list[Challenge] = Field(description="challenges that are contained in the phase")

    def __str__(self) -> str:
        return (
            f"Stakeholder(id={self.id}, name={self.name}, "
            f"division={self.division})"
        )
