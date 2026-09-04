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


from mlops_serious_game.domain.requirement import StakeholderIntelItem


class PitchDebateState(MessagesState):
    """State class for the LangGraph CME workflow. It keeps track of the information necessary to maintain a coherent
    conversation between the Stakeholders and the user based on selected dialogue options.
    """

    challenge: str
    summary: str
    stakeholder_ids: list[str]
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