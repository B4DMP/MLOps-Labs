from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

class RequirementType(str, Enum):
    REQUIREMENT = "requirement"
    NEGOTIABLE_PREFERENCE = "negotiable_preference"
    PERSONAL_FRICTION = "personal_friction"

class ConfidenceType(str, Enum):
    UNCONFIRMED = "unconfirmed"
    VERIFIED = "verified"

class ArtifactType(str, Enum):
    EMAIL = "email"
    SLACK_MESSAGE="slack_message"
    MEETING_NOTES = "meeting_notes"
    DOCUMENT="document"

class StakeholderRequirement(BaseModel):
    """A class representing a stakeholder's requirement/stance in a challenge"""
    id: str = Field(description="Unique identifier for the requirement")
    challenge_id: int = Field(description="The ID of the challenge this requirement belongs to")
    stakeholder_id: str = Field(description="The ID of the stakeholder this requirement belongs to")
    type: RequirementType = Field(description="Type of the requirement")
    description: str = Field(description="Description of the requirement stance")

class StakeholderIntelItem(StakeholderRequirement):
    """A class representing a categorized stakeholder requirement (player's dossier intel item)"""
    intel_type: ConfidenceType = Field(default=ConfidenceType.UNCONFIRMED, description="The type of the intel")
    categorized_type: RequirementType = Field(default=RequirementType.REQUIREMENT, description="The categorized requirement type")
    categorized_description: str = Field(default="", description="Description of the categorized requirement")

    @classmethod
    def from_requirement(
        cls,
        req: StakeholderRequirement,
        intel_type: ConfidenceType = ConfidenceType.UNCONFIRMED,
        categorized_type: Optional[RequirementType] = None,
        categorized_description: str = "",
        description: Optional[str] = None,
    ) -> "StakeholderIntelItem":
        return cls(
            id=req.id,
            challenge_id=req.challenge_id,
            stakeholder_id=req.stakeholder_id,
            type=req.type,
            description=description if description is not None else req.description,
            intel_type=intel_type,
            categorized_type=categorized_type or req.type,
            categorized_description=categorized_description,
        )

    @property
    def correct_description(self) -> str:
        return self.description

    @property
    def correct_intent(self) -> RequirementType:
        return self.type

    def is_correct(self) -> bool:
        return self.categorized_type == self.type

    def is_correct_intel(self) -> bool:
        return self.is_correct()
    
class StakeholderIntelItemArtifact(BaseModel):
    """A class representing a MLOps artifact associated with a stakeholder intel_item"""
    id: str = Field(description="Unique identifier of the artifact")
    intel_item_id: str = Field(description="id of the associated intel_item")
    type: ArtifactType = Field(description="Type of the artifact")
    content: str = Field(description="Content of the artifact")
    
    