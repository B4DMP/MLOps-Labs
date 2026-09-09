import json
from pathlib import Path
from typing import List

from pydantic import BaseModel, Field

class Stakeholder(BaseModel):
    """A class representing a stakeholder agent

    Args:
        id (str): Unique identifier for the stakeholder.
        name (str): Name of the stakeholder.
        division (str): Organizational division the stakeholder represents.
        responsibilities (str): Core responsibilities of the stakeholder.
        priorities (str): Primary goals and priorities guiding decisions.
        requirements (str): Requrements on the development environment introduced by the stakeholder.
        introduction (str): Short, friendly self-introduction spoken in the phase briefing.
    """

    id: str = Field(description="Unique identifier for the stakeholder")
    name: str = Field(description="Name of the stakeholder")
    responsibilities: str = Field(description="Core responsibilities of the stakeholder")
    priorities: str = Field(description="Primary goals and priorities guiding decisions")
    requirements: str = Field(description="Requirements on the development environment")
    role_description: str = Field(description="Description of the Stakeholder role")
    introduction: str = Field(
        default="", description="Short, friendly self-introduction spoken in the phase briefing"
    )
    metric_id: str = Field(description="associated metric")
    convincer_archetype: str = Field(default="", description="Name of the convincer archetype")
    avatar: dict = Field(default_factory=dict, description="Open Peeps avatar configuration")

    def get_profile_string(self)-> str:
        return f"""
            Stakeholder in a MLOps project environment.
            Name: {self.name}
            Description: {self.role_description}
            Responsibilities: {self.responsibilities}
            Priorities: {self.priorities}
            Requirements: {self.requirements}
        """

    def __str__(self) -> str:
        return (
            f"Stakeholder(id={self.id}, name={self.name})"
        )
