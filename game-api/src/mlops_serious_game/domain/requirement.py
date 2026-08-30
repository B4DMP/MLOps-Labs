from enum import Enum
from pydantic import BaseModel, Field

class RequirementType(str, Enum):
    HARD_CONSTRAINT = "hard_constraint"
    REQUIREMENT = "requirement"
    NEGOTIABLE_PREFERENCE = "negotiable_preference"
    PERSONAL_FRICTION = "personal_friction"

class ConfidenceType(str, Enum):
    UNCONFIRMED = "unconfirmed"
    VERIFIED = "verified"
    INFERRED = "inferred"

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

class StakeholderIntelItem(BaseModel):
    """A class representing a categorized stakeholder requirement"""
    id: str = Field(description="Unique identifier of the intel item")
    requirement_id: str= Field(description="id of the associated requirement item")
    intel_type: ConfidenceType = Field(default=ConfidenceType.UNCONFIRMED, description="The type of the intel")
    categorized_type: RequirementType = Field(default=RequirementType.REQUIREMENT, description="The categorized requirement type")
    description: str = Field(default="", description="Description of the categorized requirement")

    @property
    def stakeholder_id(self) -> str:
        from mlops_serious_game.domain.requirement_factory import RequirementFactory
        req = RequirementFactory.get_requirement(self.requirement_id)
        return req.stakeholder_id if req else ""

    @property
    def categorized_description(self) -> str:
        return self.description

    @property
    def correct_description(self) -> str:
        from mlops_serious_game.domain.requirement_factory import RequirementFactory
        req = RequirementFactory.get_requirement(self.requirement_id)
        return req.description if req else self.description

    @property
    def correct_intent(self) -> RequirementType:
        from mlops_serious_game.domain.requirement_factory import RequirementFactory
        req = RequirementFactory.get_requirement(self.requirement_id)
        return req.type if req else self.categorized_type

    def is_correct(self) -> bool:
        from mlops_serious_game.domain.requirement_factory import RequirementFactory
        req = RequirementFactory.get_requirement(self.requirement_id)
        if req:
            return self.categorized_type == req.type
        return True

    def is_correct_intel(self) -> bool:
        return self.is_correct()
    
class StakeholderIntelItemArtifact(BaseModel):
    """A class representing a MLOps artifact associated with a stakeholder intel_item"""
    id: str = Field(description="Unique identifier of the artifact")
    intel_item_id: str = Field(description="id of the associated intel_item")
    type: ArtifactType = Field(description="Type of the artifact")
    content: str = Field(description="Content of the artifact")
    
    