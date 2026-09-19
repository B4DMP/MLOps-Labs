import json
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.domain.persona import Persona
from mlops_serious_game.domain.persona_resolver import PersonaMap, personalize

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
    avatar: dict = Field(
        default_factory=dict,
        description="Open Peeps avatar configuration, role-level traits and identity colors",
    )
    personas: List[Persona] = Field(
        default_factory=list,
        description="Interchangeable names and looks, one of which each player is dealt",
    )
    emotion_sensitivities: dict[str, float] = Field(
        default_factory=dict,
        description="Dimensional sensitivity multipliers for pitch evaluation",
    )

    def with_persona(
        self, persona: Optional[Persona], personas: Optional[PersonaMap] = None
    ) -> "Stakeholder":
        """Returns a copy wearing `persona`, with all prose tokens rendered.

        `personas` is the full map, because this stakeholder's prose mentions
        other stakeholders too (Data Dave's responsibilities name Model Monica).

        With no persona given, the first one in the config stands in. It is the
        canonical identity, and without it the avatar would be missing every
        person-level trait.
        """
        persona = persona or (self.personas[0] if self.personas else None)
        rendered = {
            field: personalize(getattr(self, field), personas)
            for field in ("responsibilities", "priorities", "requirements", "role_description", "introduction")
        }
        if persona:
            rendered["name"] = persona.name
            rendered["avatar"] = {**self.avatar, **persona.avatar}
        else:
            rendered["name"] = personalize(self.name, personas)
        return self.model_copy(update=rendered)

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
