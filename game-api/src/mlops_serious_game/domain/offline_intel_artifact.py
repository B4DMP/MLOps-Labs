from typing import Dict
from pydantic import BaseModel, Field
from mlops_serious_game.domain.requirement import ArtifactType


class OfflineIntelArtifact(BaseModel):
    """Domain model representing a pre-generated offline intel artifact with all properties and miscategorization descriptions."""
    id: str = Field(description="Unique identifier of the artifact")
    requirement_id: str = Field(description="Associated requirement ID")
    challenge_id: int = Field(description="Challenge ID this artifact belongs to")
    stakeholder_id: str = Field(description="Stakeholder ID associated with the artifact")
    stakeholder_name: str = Field(
        default="",
        description="Stakeholder name, filled in from the stakeholder config at read time",
    )
    stakeholder_role: str = Field(
        default="",
        description="Stakeholder role description, filled in from the stakeholder config at read time",
    )
    artifact_type: ArtifactType = Field(description="Type of the artifact (e.g. email, slack_message, meeting_notes, document)")
    content: str = Field(description="Content text of the intel artifact")
    wrong_descriptions: Dict[str, str] = Field(
        default_factory=dict,
        description="Map of wrong IntelTag values to the description a player with that read would see"
    )
    is_known: bool = Field(description="Describes if an intel item is known by the start of the round")
