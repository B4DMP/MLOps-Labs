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

    def evaluate(self, ev: Any) -> bool:
        """Evaluates condition against emotion values object or dictionary."""
        val = getattr(ev, self.metric, ev.get(self.metric, 0.5) if isinstance(ev, dict) else 0.5)

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

    def calculate(self, ev: Any) -> float:
        """Calculates formula score given emotion values object or dictionary."""
        if self.type == "constant":
            return self.value if self.value is not None else 0.5

        score = 0.0
        for w in self.weights:
            val = getattr(ev, w.metric, ev.get(w.metric, 0.5) if isinstance(ev, dict) else 0.5)
            term = (1.0 - val) if w.invert else val
            score += term * w.weight

        return round(max(0.0, min(1.0, score)), 2)


class EmotionalStateRule(BaseModel):
    """Rule defining condition and formula for an emotional state."""

    facial_expression: str = Field(default="smile", description="Associated character avatar facial expression")
    color: Optional[str] = Field(default=None, description="Hex color code associated with the emotional state")
    conditions: list[TriggerCondition] = Field(default_factory=list, description="List of trigger conditions (AND conjunction)")
    formula: IntensityFormula = Field(description="Intensity calculation formula")


class IntelEmotionRules(BaseModel):
    """Delta configurations for player intel options."""

    misattributed_intel: dict[str, float] = Field(default_factory=dict, description="Penalties applied on incorrect intel")
    correct_intel: dict[str, float] = Field(default_factory=dict, description="Rewards applied on correct intel")


class AlignmentCondition(BaseModel):
    """Condition for archetype alignment rules."""

    type: Literal["option_min", "diff_bonus", "diff_penalty"] = Field(description="Condition rule type")
    min_value: Optional[int] = Field(default=None, description="Minimum option value for option_min")
    target_min_value: Optional[int] = Field(default=None, description="Minimum stakeholder target value for diff_penalty")
    min_diff: Optional[int] = Field(default=None, description="Minimum difference threshold")
    max_diff: Optional[int] = Field(default=None, description="Maximum difference threshold")
    deltas: dict[str, float] = Field(default_factory=dict, description="Emotional deltas to apply")


class DimensionAlignmentRule(BaseModel):
    """Alignment rule for a specific archetype dimension."""

    dimension: str = Field(description="Archetype dimension name")
    conditions: list[AlignmentCondition] = Field(default_factory=list, description="Alignment conditions")


class CorporateNoiseEmotionRules(BaseModel):
    """Delta configurations for corporate noise and archetype alignment."""

    distance_threshold: float = Field(default=3.5, description="Euclidean distance threshold for trust bonus/penalty")
    distance_slope: float = Field(default=0.04, description="Slope per distance unit")
    base_trust_bonus: float = Field(default=0.10, description="Base trust bonus for close distance")
    base_trust_penalty: float = Field(default=-0.10, description="Base trust penalty for far distance")
    dimension_alignments: list[DimensionAlignmentRule] = Field(default_factory=list, description="Dimension specific alignment rules")


class EmotionDeltaRules(BaseModel):
    """Rules for algorithmic emotion delta calculations."""

    intel_rules: IntelEmotionRules = Field(default_factory=IntelEmotionRules, description="Intel delta rules")
    corporate_noise_rules: CorporateNoiseEmotionRules = Field(default_factory=CorporateNoiseEmotionRules, description="Corporate noise delta rules")


class PitchTuning(BaseModel):
    """Tuning numbers for the merged pitch phase (D38): dialogue-option emotion effects, veto/objection
    thresholds, and grudge lifetime. Defaults match the pre-D38 hardcoded values, so omitting
    `pitch_tuning` from EmotionValueConfig.json changes nothing - authors override only what they tune.
    """

    emotion_stonewall: float = Field(default=-0.10, description="Stonewall: emotion hit to the objecting stakeholder")
    emotion_stonewall_ally: float = Field(default=0.05, description="Stonewall: emotion gain to the opposing side")
    emotion_reframe: float = Field(default=0.02, description="Reframe: small emotion gain to the objecting stakeholder")
    emotion_addendum: float = Field(default=-0.15, description="Emergency Addendum: emotion hit to the objecting stakeholder")
    emotion_concede: float = Field(default=-0.05, description="Concede Correction: small emotion hit to the objecting stakeholder")
    emotion_veto_breaker: float = Field(default=-0.40, description="Veto Breaker: emotion hit to the overridden stakeholder")
    emotion_concede_win: float = Field(default=0.30, description="Let Them Have It (D41): emotion gain to the side that gets its way")
    emotion_concede_lose: float = Field(default=-0.20, description="Let Them Have It (D41): emotion hit to the side whose card was dropped")
    secondary_malus: float = Field(default=0.15, description="Fit penalty when scoring against a stakeholder's secondary archetype")
    veto_threshold: float = Field(default=0.4, description="Buy-in floor below which a high-power stakeholder vetoes")
    objection_threshold: float = Field(default=0.3, description="Buy-in floor below which a low-power stakeholder objects")
    loss_w: float = Field(default=0.3, description="Weight of accumulated loss in the buy-in formula")
    grudge_lifetime: int = Field(default=2, description="How many simulations a grudge keeps firing before it is spent")

    # D48/D50 (plan 11): Reframe picks an archetype per objection; fit against the stakeholder's
    # true archetype buckets into Direct Hit / Partial / Miss. No secondary for a single answer.
    reframe_hit: float = Field(default=0.7, description="Fit at or above this is a Direct Hit on Reframe")
    reframe_partial: float = Field(default=0.4, description="Fit at or above this (below Hit) is a Partial on Reframe")
    room_listen: float = Field(default=0.35, description="Fit below which another high-power stakeholder in the room turns colder on a Reframe (the room is listening)")
    emotion_reframe_miss: float = Field(default=-0.08, description="Reframe Miss: emotion hit to the objecting stakeholder, now hardened so only Amend clears it")
    emotion_room_listening: float = Field(default=-0.03, description="Reframe: slight emotion hit to other high-power stakeholders with a poor fit to the chosen archetype")
    default_patience: int = Field(default=3, description="Patience per stakeholder per challenge (D50, was 2)")
    sound_out_patience_cost: int = Field(default=1, description="Patience spent when sounding a stakeholder out in Build your case (D50)")

    # Gather (D49, plan 11): Test a hypothesis and Trial Balloon are small trust moves, not the
    # room deciding anything - kept an order of magnitude gentler than the OBJECT-round numbers.
    emotion_refuted: float = Field(default=-0.05, description="Test a hypothesis: trust hit when the player's tag was wrong (Refuted)")
    emotion_trial_balloon_match: float = Field(default=0.05, description="Trial Balloon: gain when the guessed archetype matches")
    emotion_trial_balloon_miss: float = Field(default=-0.03, description="Trial Balloon: small hit when the guessed archetype is ruled out")
    emotion_one_on_one_miss: float = Field(default=-0.05, description="1-on-1 template: trust hit when the guessed pair is wrong")


from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype


class EmotionConfig(BaseModel):
    """Complete Emotion & CME Configuration object matching EmotionValueConfig.json."""

    emotion_values: list[EmotionDimension] = Field(default_factory=list, description="Configured emotion dimensions")
    emotion_prompts: dict[str, str] = Field(default_factory=dict, description="Prompts per emotional state")
    emotional_states: dict[str, EmotionalStateRule] = Field(default_factory=dict, description="State transition rules")
    emotion_colors: dict[str, str] = Field(default_factory=dict, description="Hex color codes for emotional states")
    convincer_archetypes: dict[str, ConvincerArchetype] = Field(default_factory=dict, description="Configured convincer archetypes")
    emotion_delta_rules: Optional[EmotionDeltaRules] = Field(default=None, description="Algorithmic emotion delta rules")
    pitch_tuning: PitchTuning = Field(default_factory=PitchTuning, description="Pitch phase tuning numbers (D38)")

