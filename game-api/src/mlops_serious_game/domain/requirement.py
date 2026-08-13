from enum import Enum
from pydantic import BaseModel, Field

class RequirementType(str, Enum):
    HARD_CONSTRAINT = "hard_constraint"
    REQUIREMENT = "requirement"
    NEGOTIABLE_PREFERENCE = "negotiable_preference"
    PERSONAL_FRICTION = "personal_friction"

class StakeholderRequirement(BaseModel):
    """A class representing a stakeholder's requirement/stance in a challenge"""
    id: str = Field(description="Unique identifier for the requirement")
    challenge_id: int = Field(description="The ID of the challenge this requirement belongs to")
    stakeholder_id: str = Field(description="The ID of the stakeholder this requirement belongs to")
    type: RequirementType = Field(description="Type of the requirement")
    description: str = Field(description="Description of the requirement stance")
