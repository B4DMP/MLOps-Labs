from typing import Any, Optional, TypedDict
from pydantic import BaseModel, Field


class ActionCard(BaseModel):
    """Refactored Action Card model."""
    id: str = Field(description="Unique identifier for the action card")
    title: str = Field(description="Concise, strategic title for the proposed action proposal")
    description: str = Field(description="Clear, synthesized description of the action proposal addressing the merged intel items")
    intel_ids: list[str] = Field(default_factory=list, description="List of intel item IDs merged to generate this action card")
    addendum_intel_item_ids: list[str] = Field(default_factory=list, description="List of addendum intel item IDs")


class ActionCardGenerationOutput(BaseModel):
    """Structured output for LLM generation of the Action Card title and description."""
    title: str = Field(
        description="A concise, professional, and punchy strategic proposal title (3-7 words) synthesizing the actions needed to address the given intel items."
    )
    description: str = Field(
        description="A coherent, synthesized strategic proposal description (2-3 sentences) detailing the concrete MLOps actions and mitigation measures addressing the merged intel requirements and stakeholder stances."
    )


class ActionCardState(TypedDict):
    """State for the Action Card generation workflow."""
    phase_id: int
    challenge_id: int
    challenge_context: str
    intel_items: list[dict[str, Any]]
    intel_ids: list[str]
    action_card: Optional[dict[str, Any]]
