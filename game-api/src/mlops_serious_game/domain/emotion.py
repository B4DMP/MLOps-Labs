from pathlib import Path
from typing import Any, Literal, Optional
import json
from pydantic import BaseModel, Field


class EmotionDimension(BaseModel):
    """Configuration for a single cognitive-emotional dimension."""

    id: str = Field(description="Unique dimension identifier, e.g. trust, stress")
    description: str = Field(default="", description="Description of what the dimension measures")
    ge: float = Field(default=0.0, description="Minimum possible value")
    le: float = Field(default=1.0, description="Maximum possible value")


# Dictionary mapping dimension ID -> current float value (0.0 to 1.0)
EmotionValues = dict[str, float]

# Dictionary mapping dimension ID -> delta float value (-0.5 to +0.5)
EmotionDelta = dict[str, float]


def apply_emotion_delta(
    values: EmotionValues,
    deltas: EmotionDelta,
    min_val: float = 0.0,
    max_val: float = 1.0,
) -> EmotionValues:
    """Applies delta values to current emotion values, clamping each dimension between min_val and max_val."""
    updated: EmotionValues = dict(values)
    for metric, delta in deltas.items():
        current = updated.get(metric, 0.5)
        updated[metric] = round(max(min_val, min(max_val, current + delta)), 4)
    return updated


class TriggerCondition(BaseModel):
    """Condition for triggering an emotional state."""

    metric: str = Field(description="Emotion dimension ID to compare")
    op: Literal["<=", ">=", "<", ">", "=="] = Field(description="Comparison operator")
    value: float = Field(description="Threshold value to compare against")

    def evaluate(self, ev: EmotionValues) -> bool:
        """Evaluates condition against emotion values dictionary."""
        val = ev.get(self.metric, 0.5)

        if self.op == "<=":
            return val <= self.value
        elif self.op == ">=":
            return val >= self.value
        elif self.op == "<":
            return val < self.value
        elif self.op == ">":
            return val > self.value
        elif self.op == "==":
            return abs(val - self.value) < 1e-6
        return False


class FormulaWeight(BaseModel):
    """Weighted term in an intensity formula."""

    metric: str = Field(description="Emotion dimension ID")
    weight: float = Field(description="Relative weight coefficient")
    invert: bool = Field(default=False, description="Whether to invert the metric value: (1.0 - val)")


class IntensityFormula(BaseModel):
    """Intensity formula specification."""

    type: Literal["weighted_sum", "constant"] = Field(description="Formula type")
    value: Optional[float] = Field(default=None, description="Constant intensity value")
    weights: list[FormulaWeight] = Field(default_factory=list, description="Weighted formula terms")

    def calculate(self, ev: EmotionValues) -> float:
        """Calculates formula score given emotion values dictionary."""
        if self.type == "constant":
            return self.value if self.value is not None else 0.5

        score = 0.0
        for w in self.weights:
            val = ev.get(w.metric, 0.5)
            term = (1.0 - val) if w.invert else val
            score += term * w.weight

        return round(max(0.0, min(1.0, score)), 2)


class EmotionalStateRule(BaseModel):
    """Rule defining condition and formula for an emotional state."""

    conditions: list[TriggerCondition] = Field(default_factory=list, description="List of trigger conditions (AND conjunction)")
    formula: IntensityFormula = Field(description="Intensity calculation formula")


from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype


class EmotionConfig(BaseModel):
    """Complete Emotion & CME Configuration object matching EmotionValueConfig.json."""

    emotion_values: list[EmotionDimension] = Field(default_factory=list, description="Configured emotion dimensions")
    emotion_prompts: dict[str, str] = Field(default_factory=dict, description="Prompts per emotional state")
    emotional_states: dict[str, EmotionalStateRule] = Field(default_factory=dict, description="State transition rules")
    convincer_archetypes: dict[str, ConvincerArchetype] = Field(default_factory=dict, description="Configured convincer archetypes")
