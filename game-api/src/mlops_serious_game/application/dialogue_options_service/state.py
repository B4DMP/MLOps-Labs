from typing import Any, Optional
from pydantic import BaseModel, Field
from langgraph.graph import MessagesState

from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype


class IntelOptionSpec(BaseModel):
    text: str = Field(
        description=(
            "The intel dialogue option text in 1st person ('I', 'We') directly responding to the meeting context. "
            "MUST explicitly address the target stakeholder BY FIRST NAME and voice, state, or act upon the specific claim, constraint, "
            "or belief described in its corresponding assigned intel item in a clean, natural, and professional manner."
        )
    )


class CorporateNoiseSpec(BaseModel):
    text: str = Field(
        description=(
            "The corporate noise dialogue option text in 1st person ('I', 'We') directly addressing the stakeholder's concerns "
            "following the assigned archetype strategy. MUST stay high-level, vague, descriptive of current alignment, or reassuring "
            "WITHOUT proposing new concrete actions, pilots, technical solutions, or process implementations."
        )
    )
    archetype_name: str = Field(
        description="The exact name of the Convincer Archetype that this option was styled after."
    )


class GeneratedDialogueOptions(BaseModel):
    intel_option_specs: list[IntelOptionSpec] = Field(
        default_factory=list,
        description="A list of intel dialogue option specs, maintaining the exact same order as the assigned Intel Items.",
    )
    corporate_noise_specs: list[CorporateNoiseSpec] = Field(
        default_factory=list,
        description="A list of corporate noise dialogue options, each paired with its assigned archetype name.",
    )


class DialogueOption(BaseModel):
    """Represents a selectable player dialogue option in the Pitch Debate / CME meeting."""

    text: str = ""
    intel_item_id: Optional[str] = None
    archetype: Optional[ConvincerArchetype] = None

    def is_correct(self, discovered_intel_items: Optional[list[Any]] = None) -> bool:
        """Derives whether this dialogue option is based on a correctly classified intel item."""
        if not self.intel_item_id:
            return True
        if discovered_intel_items:
            for item in discovered_intel_items:
                item_id = getattr(item, "id", None) or (item.get("id") if isinstance(item, dict) else None)
                if item_id and str(item_id) == str(self.intel_item_id):
                    if hasattr(item, "is_correct_intel"):
                        return item.is_correct_intel()
                    if hasattr(item, "is_correct") and callable(item.is_correct):
                        return item.is_correct()
                    if hasattr(item, "requirement_id") and hasattr(item, "categorized_type"):
                        from mlops_serious_game.domain.requirement_factory import RequirementFactory
                        req = RequirementFactory.get_requirement(item.requirement_id)
                        if req:
                            return item.categorized_type == req.type
        return True


class DialogueOptionsState(MessagesState):
    """State class for the Dialogue Options generation LangGraph workflow.

    Attributes:
        challenge (str): The current MLOps challenge description / context.
        discovered_intel_items (list[Any]): Discovered stakeholder intel items.
        dialogue_options (list[DialogueOption]): The generated 4 dialogue options.
        active_speaker_id (Optional[str]): ID of the active stakeholder who spoke last.
        active_speaker_name (Optional[str]): Display name of the active stakeholder.
    """

    challenge: str
    discovered_intel_items: list[Any]
    dialogue_options: list[DialogueOption]
    active_speaker_id: Optional[str]
    active_speaker_name: Optional[str]
