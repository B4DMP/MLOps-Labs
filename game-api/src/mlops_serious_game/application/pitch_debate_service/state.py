import enum
from typing import Any, Optional
from pydantic import BaseModel, Field, create_model
from langgraph.graph import MessagesState

from mlops_serious_game.application.dialogue_options_service import DialogueOption
from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype
from mlops_serious_game.domain.emotion_factory import EmotionFactory


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


class StakeholderIntelItemLayer(enum.Enum):
    TECHNICAL = "technical"
    BUSINESS = "business"
    POLITICAL = "political"


class StakeholderIntelItemIntent(enum.Enum):
    HARD_CONSTRAINT = "hard_constraint"
    PREFERENCE = "preference"
    PERSONAL_FRICTION = "personal_friction"


class StakeholderIntelItem(BaseModel):
    id: Optional[str] = None
    stakeholder_id: str
    categorized_layer: Optional[StakeholderIntelItemLayer] = None
    categorized_intent: Optional[StakeholderIntelItemIntent] = None
    correct_layer: Optional[StakeholderIntelItemLayer] = None
    correct_intent: Optional[StakeholderIntelItemIntent] = None
    correct_description: str = ""
    categorized_description: str = ""

    def is_correct_intel(self) -> bool:
        if self.categorized_layer is not None and self.correct_layer is not None:
            if self.categorized_intent is not None and self.correct_intent is not None:
                return (
                    self.categorized_layer == self.correct_layer
                    and self.categorized_intent == self.correct_intent
                )
        return True


class PitchDebateState(MessagesState):
    """State class for the LangGraph CME workflow. It keeps track of the information necessary to maintain a coherent
    conversation between the Stakeholders and the user based on selected dialogue options.
    """

    challenge: str
    summary: str
    stakeholder_ids: list[str]
    generate_card: bool
    action_cards: list
    phase_id: int
    challenge_id: int
    cheating_detected: bool
    emotion_values: dict[str, EmotionValues]
    emotion_deltas: dict[str, EmotionDelta]
    intel_items: list[StakeholderIntelItem]
    dialogue_options: list[DialogueOption]
    stakeholder_convincer_profile: dict[str, list[StakeholderIntelItem]]
    last_selected_intel: Optional[StakeholderIntelItem]
    last_selected_option: Optional[DialogueOption]