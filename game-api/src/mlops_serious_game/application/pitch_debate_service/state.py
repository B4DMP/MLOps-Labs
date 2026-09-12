from typing import Any, Optional
from pydantic import BaseModel, Field, create_model
from langgraph.graph import MessagesState

from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.requirement import StakeholderIntelItem


class DialogueOption(BaseModel):
    """Represents a selectable player dialogue option in the Pitch Debate."""

    id: str = ""
    type: str = "corporate_noise"  # "intel" or "corporate_noise"
    text: Optional[str] = None
    intel_item_id: Optional[str] = None
    intel_description: Optional[str] = None
    intel_stakeholder_id: Optional[str] = None
    intel_stakeholder_name: Optional[str] = None
    intel_type: Optional[str] = None
    archetype: Optional[ConvincerArchetype] = None

    def is_correct(self, discovered_intel_items: Optional[list[StakeholderIntelItem]] = None) -> bool:
        """Derives whether this dialogue option is based on a correctly classified intel item."""
        if not self.intel_item_id or not discovered_intel_items:
            return True
        for item in discovered_intel_items:
            if item.id == self.intel_item_id:
                return item.is_correct_intel()
        return True


def _build_dynamic_emotion_models():
    """Dynamically builds EmotionValues and EmotionDelta Pydantic models from EmotionValueConfig."""
    dimensions = EmotionFactory.get_emotion_values()

    val_fields: dict[str, Any] = {}
    delta_fields: dict[str, Any] = {}

    for dim in dimensions:
        val_fields[dim.id] = (
            float,
            Field(
                default=0.5,
                ge=dim.ge,
                le=dim.le,
                description=dim.description,
            ),
        )
        delta_fields[f"{dim.id}_delta"] = (
            float,
            Field(
                default=0.0,
                ge=-0.5,
                le=0.5,
                description=f"Change in {dim.id} (-0.5 to +0.5)",
            ),
        )

    EmotionValuesModel = create_model("EmotionValues", **val_fields)
    EmotionDeltaModel = create_model("EmotionDelta", **delta_fields)
    return EmotionValuesModel, EmotionDeltaModel


EmotionValues, EmotionDelta = _build_dynamic_emotion_models()


class PitchDebateState(MessagesState):
    """State class for the LangGraph CME workflow. It keeps track of the information necessary to maintain a coherent
    conversation between the Stakeholders and the user based on selected dialogue options.
    """

    challenge: str
    summary: str
    stakeholder_ids: list[str]
    phase_id: int
    challenge_id: int
    username: str
    cheating_detected: bool
    emotion_values: dict[str, EmotionValues]
    emotion_deltas: dict[str, EmotionDelta]
    intel_items: list[StakeholderIntelItem]
    dialogue_options: list[DialogueOption]
    stakeholder_convincer_profile: dict[str, list[StakeholderIntelItem]]
    last_selected_intel: Optional[StakeholderIntelItem]
    last_selected_option: Optional[DialogueOption]
    addressed_stakeholder_id: Optional[str]
    action_card: Optional[dict[str, Any]]