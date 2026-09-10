from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, model_validator

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
    is_public_record: bool = Field(
        default=False,
        description=(
            "True when the item was already on the public record at the start of the challenge "
            "(said in a channel everyone reads) rather than confirmed by the player through "
            "stakeholder interaction. Both are verified; this separates how they got there."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _upgrade_legacy_payload(cls, data):
        """Backfills fields for intel items persisted before the requirement/intel unification.

        Legacy payloads look like {id, requirement_id, intel_type, categorized_type, description}
        where `description` held the *categorized* description and the true requirement data was
        only reachable through `requirement_id`. They live on in the IntelItem table and in
        LangGraph checkpoints, so resolve them against the requirement config on read.
        """
        if not isinstance(data, dict):
            return data
        if "requirement_id" not in data and all(k in data for k in ("challenge_id", "stakeholder_id", "type")):
            return data

        from mlops_serious_game.domain.requirement_factory import RequirementFactory

        upgraded = dict(data)
        req_id = upgraded.pop("requirement_id", None) or upgraded.get("id")
        req = RequirementFactory.get_requirement(req_id) if req_id else None

        upgraded["id"] = req_id
        # Legacy `description` was the categorized description; keep it unless already migrated.
        categorized_description = upgraded.get("categorized_description") or upgraded.get("description") or ""
        upgraded["categorized_description"] = categorized_description

        if req:
            upgraded.setdefault("challenge_id", req.challenge_id)
            upgraded.setdefault("stakeholder_id", req.stakeholder_id)
            upgraded.setdefault("type", req.type)
            upgraded["description"] = req.description
        else:
            # Requirement no longer in the config: keep the item loadable but inert. The -1
            # challenge id keeps it out of every per-challenge dossier view.
            upgraded.setdefault("challenge_id", -1)
            upgraded.setdefault("stakeholder_id", "")
            upgraded.setdefault("type", upgraded.get("categorized_type") or RequirementType.REQUIREMENT)
            upgraded["description"] = categorized_description

        return upgraded

    @classmethod
    def from_requirement(
        cls,
        req: StakeholderRequirement,
        intel_type: ConfidenceType = ConfidenceType.UNCONFIRMED,
        categorized_type: Optional[RequirementType] = None,
        categorized_description: str = "",
        description: Optional[str] = None,
        is_public_record: bool = False,
    ) -> "StakeholderIntelItem":
        resolved_desc = description if description is not None else req.description
        resolved_cat_desc = categorized_description
        if not resolved_cat_desc and (intel_type == ConfidenceType.VERIFIED or str(intel_type).lower() == "verified"):
            resolved_cat_desc = resolved_desc
        return cls(
            id=req.id,
            challenge_id=req.challenge_id,
            stakeholder_id=req.stakeholder_id,
            type=req.type,
            description=resolved_desc,
            intel_type=intel_type,
            categorized_type=categorized_type or req.type,
            categorized_description=resolved_cat_desc,
            is_public_record=is_public_record,
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
    
    