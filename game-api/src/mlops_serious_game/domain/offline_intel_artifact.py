from typing import Dict, Optional
from pydantic import BaseModel, Field
from mlops_serious_game.domain.requirement import ArtifactType


class OfflineIntelArtifact(BaseModel):
    """Domain model representing a pre-generated offline intel artifact with all properties and miscategorization descriptions."""
    id: str = Field(description="Unique identifier of the artifact")
    requirement_id: str = Field(description="Associated requirement ID")
    challenge_id: int = Field(description="Challenge ID this artifact belongs to")
    stakeholder_id: Optional[str] = Field(default=None, description="Stakeholder whose stance it carries, None for a Fact")
    narrator_id: Optional[str] = Field(
        default=None,
        description="Stakeholder who voices a Fact. The Fact stays about the system; the voice is there so "
        "telling it apart from a stance takes a careful read",
    )
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
    humor_archetype: Optional[str] = Field(
        default=None,
        description="Which comedic device content_gen's humor stage rewrote this artifact with, if any - "
        "debug-only, never shown to players",
    )
    humor_verdict: Optional[str] = Field(
        default=None, description="The humor stage's own adversarial reviewer's verdict: strong/weak/reject. Debug-only."
    )
    humor_review_reason: Optional[str] = Field(
        default=None, description="The adversarial reviewer's reasoning for that verdict. Debug-only."
    )

    @property
    def speaker_id(self) -> Optional[str]:
        """Whose name is on the artifact: the stance holder, or the narrator of a Fact."""
        return self.stakeholder_id or self.narrator_id
