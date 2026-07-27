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
    """

    id: str = Field(description="Unique identifier for the stakeholder")
    stakeholder_index: str = Field(default="", description="Unique string index for the stakeholder")
    name: str = Field(description="Name of the stakeholder")
    division: str = Field(description="Organizational division the stakeholder represents")
    responsibilities: List[str] = Field(description="Core responsibilities of the stakeholder")
    priorities: List[str] = Field(description="Primary goals and priorities guiding decisions")
    requirements: List[str] = Field(description="Requirements on the development environment")
    division_description: List[str]=Field(description="Description of the Stakeholder division")
    metric_id: int= Field(description="associated metric")
    stakeholder_color:str =Field(description="RGB color of the stakeholder")
    metric_expertise_values: list[int]= Field(description="expertise value for each metric")
    active: list[bool]= Field(description="active status for each game phase")

    def get_profile_string(self)-> str:
        description_str = " ".join(self.division_description)
        responsibilities_str = " ".join(self.responsibilities)
        priorities_str = " ".join(self.priorities)
        requirements_str = " ".join(self.requirements)
        return f"""
            Stakeheholder in a MLOps project environment.
            Name: {self.name}
            Representative of {self.division} ({description_str})
            Responsibilities: {responsibilities_str}
            Priorities: {priorities_str}
            Requirements: {requirements_str}
        """

    def __str__(self) -> str:
        return (
            f"Stakeholder(id={self.id}, name={self.name}, "
            f"division={self.division})"
        )
