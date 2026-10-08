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


# Dimensions where lower is better. A calm, unthreatened stakeholder has these near 0.
NEGATIVE_DIMENSIONS = frozenset({"stress", "perceived_risk"})


def recover_toward_neutral(values: EmotionValues, share: float, neutral: float = 0.5) -> EmotionValues:
    """Moves every dimension `share` of the way back to `neutral`: time takes the edge off."""
    return {
        dim: round(v + (neutral - v) * share, 4) if isinstance(v, (int, float)) else v
        for dim, v in values.items()
    }


def valence_mean(values: EmotionValues) -> Optional[float]:
    """How good the mood is, in [0, 1]: the mean of the dimensions with stress and perceived risk
    flipped. A plain mean rewards a stressed, frightened stakeholder. None when there is nothing to read."""
    readings = [
        (1.0 - v) if dim in NEGATIVE_DIMENSIONS else v
        for dim, v in values.items()
        if isinstance(v, (int, float))
    ]
    return sum(readings) / len(readings) if readings else None


PITCH_SENSITIVITY_WEIGHTS = {
    "trust": 0.25,
    "fairness": 0.28,
    "sense_of_control": 0.25,
    "stress": -0.22,
    "perceived_risk": -0.20,
    "confidence": 0.18,
    "interest": 0.10,
}

BOUNDARY_BREACH_DELTA = {
    "perceived_risk": 0.25,
    "stress": 0.20,
    "trust": -0.20,
    "sense_of_control": -0.15,
}

MISCLASSIFICATION_MALUS = {
    "trade_off_as_driver": {
        "fairness": -0.15,
        "sense_of_control": -0.15,
        "stress": 0.10,
    },
    "driver_as_boundary": {
        "fairness": -0.20,
        "trust": -0.15,
        "stress": 0.15,
    },
    "boundary_as_driver": {
        "perceived_risk": 0.25,
        "stress": 0.20,
        "trust": -0.20,
        "fairness": -0.10,
        "sense_of_control": -0.15,
    },
    "fact_as_stance": {
        "confidence": -0.25,
        "trust": -0.15,
        "stress": 0.05,
    },
    "stance_as_fact": {
        "fairness": -0.15,
        "sense_of_control": -0.20,
    },
}

VETO_MALUS = {
    "boundary_veto": {
        "perceived_risk": 0.35,
        "stress": 0.30,
        "trust": -0.30,
        "sense_of_control": 0.05,
    },
    "low_buyin_stalemate": {
        "fairness": -0.15,
        "stress": 0.15,
        "confidence": -0.20,
        "trust": -0.10,
    },
}

PATIENCE_MALUS = {
    "trust": -0.05,
    "fairness": -0.05,
    "sense_of_control": -0.05,
    "confidence": -0.05,
    "interest": -0.05,
    "stress": 0.05,
    "perceived_risk": 0.05,
}


def get_patience_malus(magnitude: float = 0.05) -> dict[str, float]:
    """Generates dimensional emotion deltas representing loss of patience."""
    return {
        "trust": -round(magnitude, 4),
        "fairness": -round(magnitude, 4),
        "sense_of_control": -round(magnitude, 4),
        "confidence": -round(magnitude, 4),
        "interest": -round(magnitude, 4),
        "stress": round(magnitude, 4),
        "perceived_risk": round(magnitude, 4),
    }


SIMULATION_OUTCOMES = {
    "clean_delivery": {
        "trust": 0.25,
        "confidence": 0.20,
        "stress": -0.20,
        "fairness": 0.15,
        "perceived_risk": -0.15,
    },
    "capped_delivery": {
        "confidence": -0.25,
        "stress": 0.20,
        "trust": -0.15,
        "sense_of_control": -0.15,
    },
    "technical_debt": {
        "perceived_risk": 0.30,
        "stress": 0.25,
        "trust": -0.20,
    },
    "overridden": {
        "trust": -0.30,
        "stress": 0.25,
        "perceived_risk": 0.20,
        "sense_of_control": -0.25,
        "fairness": -0.15,
    },
}

ROLE_SENSITIVITIES = {
    "reliability_ruth": {"stress": 0.35, "perceived_risk": 0.30},
    "requirements_reuben": {"perceived_risk": 0.35, "fairness": 0.25},
    "model_monica": {"confidence": 0.35, "sense_of_control": 0.30},
    "data_dave": {"sense_of_control": 0.30, "stress": 0.20},
    "efficiency_emilia": {"fairness": 0.35, "trust": 0.25},
    "automation_alex": {"stress": -0.20, "sense_of_control": 0.25},
}

SUBSYSTEM_SENSITIVITIES = {
    "ops": {"stress": 0.30, "perceived_risk": 0.20},
    "deploy": {"stress": -0.20, "sense_of_control": 0.25},
    "model": {"confidence": 0.30, "interest": 0.15},
    "data": {"sense_of_control": 0.25, "stress": 0.15},
}


def get_misclassification_malus(true_type: str, categorized_type: str) -> dict[str, float]:
    """Returns the constant malus vector for misclassified intel items (02-stakeholder-emotion-changes.md Section 3)."""
    t_type = true_type.lower()
    c_type = categorized_type.lower()

    if t_type == c_type:
        return {}
    if t_type == "trade_off" and c_type == "driver":
        return MISCLASSIFICATION_MALUS["trade_off_as_driver"]
    if t_type == "driver" and c_type == "boundary":
        return MISCLASSIFICATION_MALUS["driver_as_boundary"]
    if t_type == "boundary" and c_type == "driver":
        return MISCLASSIFICATION_MALUS["boundary_as_driver"]
    if t_type == "fact" and c_type in ("driver", "boundary", "trade_off"):
        return MISCLASSIFICATION_MALUS["fact_as_stance"]
    if t_type in ("driver", "boundary", "trade_off") and c_type == "fact":
        return MISCLASSIFICATION_MALUS["stance_as_fact"]
    if t_type == "boundary" and c_type == "trade_off":
        return MISCLASSIFICATION_MALUS["boundary_as_driver"]
    if t_type == "trade_off" and c_type == "boundary":
        return MISCLASSIFICATION_MALUS["driver_as_boundary"]
    if t_type == "driver" and c_type == "trade_off":
        return MISCLASSIFICATION_MALUS["trade_off_as_driver"]
    return MISCLASSIFICATION_MALUS.get(f"{t_type}_as_{c_type}", {})


def calculate_demand_alignment(
    stakeholder_reqs: list[dict | Any],
    card_slotted_req_ids: set[str],
    trade_off_fulfilled_branches: dict[str, bool] | None = None,
    card_atoms: set[str] | None = None,
) -> float:
    """Calculates continuous stakeholder positive demand alignment ratio in [-1.0, 1.0] across Drivers and Trade-offs."""
    trade_off_fulfilled_branches = trade_off_fulfilled_branches or {}
    card_atoms = card_atoms or set()

    stance_reqs = []
    for r in stakeholder_reqs:
        r_type = getattr(r, "type", None) or (r.get("type") if isinstance(r, dict) else None)
        if hasattr(r_type, "value"):
            r_type = r_type.value
        if r_type in ("driver", "trade_off"):
            stance_reqs.append(r)

    if not stance_reqs:
        return 0.0

    score = 0.0
    for req in stance_reqs:
        r_type = getattr(req, "type", None) or (req.get("type") if isinstance(req, dict) else None)
        if hasattr(r_type, "value"):
            r_type = r_type.value
        r_id = getattr(req, "id", None) or (req.get("id") if isinstance(req, dict) else "")
        atoms = set(getattr(req, "atoms", None) or (req.get("atoms", []) if isinstance(req, dict) else []))

        if r_type == "driver":
            if atoms:
                f = len(atoms & card_atoms) / len(atoms)
            elif r_id in card_slotted_req_ids:
                f = 1.0
            else:
                f = 0.0
            score += (2.0 * f - 1.0)

        elif r_type == "trade_off":
            branch_x_atoms = set(getattr(req, "branch_x_atoms", None) or (req.get("branch_x_atoms", []) if isinstance(req, dict) else []))
            branch_y_atoms = set(getattr(req, "branch_y_atoms", None) or (req.get("branch_y_atoms", []) if isinstance(req, dict) else []))

            if branch_x_atoms or branch_y_atoms:
                fx = (len(branch_x_atoms & card_atoms) / len(branch_x_atoms)) if branch_x_atoms else 0.0
                fy = (len(branch_y_atoms & card_atoms) / len(branch_y_atoms)) if branch_y_atoms else 0.0
                f = max(fx, fy)
            elif r_id in card_slotted_req_ids or trade_off_fulfilled_branches.get(r_id, False):
                f = 1.0
            else:
                f = 0.0
            score += (2.0 * f - 1.0)

    return max(-1.0, min(1.0, round(score / len(stance_reqs), 3)))


def calculate_dynamic_weights(
    st_id: str,
    stakeholder_reqs: list[dict | Any],
    room_demands: dict[str, int] | None = None,
    card_slotted_counts: dict[str, int] | None = None,
    role_sensitivities: dict[str, float] | None = None,
) -> dict[str, float]:
    """Computes bounded dimensional sensitivity weights w_k(st, C) clamped in [0.75, 1.50]."""
    role_mods = {}
    if role_sensitivities:
        for dim, val in role_sensitivities.items():
            role_mods[dim] = val - 1.0 if val >= 1.0 else val
    else:
        role_mods = ROLE_SENSITIVITIES.get(st_id, {})

    subsystem_mods = {}
    for req in stakeholder_reqs:
        desc = (getattr(req, "description", None) or (req.get("description", "") if isinstance(req, dict) else "")).lower()
        for sub, boosts in SUBSYSTEM_SENSITIVITIES.items():
            if sub in desc:
                for dim, val in boosts.items():
                    subsystem_mods[dim] = max(subsystem_mods.get(dim, 0.0), val)

    equity_mods = {}
    if room_demands and card_slotted_counts:
        total_demands = sum(room_demands.values())
        total_slots = sum(card_slotted_counts.values())
        if total_demands > 0 and total_slots > 0:
            dem_share = room_demands.get(st_id, 0) / total_demands
            slot_share = card_slotted_counts.get(st_id, 0) / total_slots
            if dem_share > slot_share:
                deficit = dem_share - slot_share
                equity_mods["fairness"] = min(0.35, round(deficit * 1.2, 3))
                equity_mods["trust"] = min(0.25, round(deficit * 0.8, 3))

    dynamic_weights = {}
    for dim, base_w in PITCH_SENSITIVITY_WEIGHTS.items():
        delta_role = role_mods.get(dim, 0.0)
        delta_sub = subsystem_mods.get(dim, 0.0)
        delta_eq = equity_mods.get(dim, 0.0)

        total_mod = 1.0 + delta_role + delta_sub + delta_eq
        clamped_mod = max(0.75, min(1.50, total_mod))
        dynamic_weights[dim] = round(base_w * clamped_mod, 4)

    return dynamic_weights


def calculate_reactivity(power: str | float, interest: str | float) -> float:
    """Computes reactivity multiplier mu in [0.0, 1.0] from power and interest."""
    p_val = 0.8 if power == "high" else (0.3 if power == "low" else float(power))
    i_val = 0.8 if interest == "high" else (0.3 if interest == "low" else float(interest))
    return round(0.5 * p_val + 0.5 * i_val, 3)


def calculate_pitch_deltas(
    alignment: float,
    reactivity: float,
    violated_boundary_count: int = 0,
    weights: dict[str, float] | None = None,
) -> dict[str, float]:
    """Calculates non-uniform dimensional deltas for the 7 emotion dimensions."""
    deltas = {}
    w_vec = weights or PITCH_SENSITIVITY_WEIGHTS
    for dim, weight in w_vec.items():
        deltas[dim] = round(reactivity * alignment * weight, 4)

    if violated_boundary_count > 0:
        for dim, b_val in BOUNDARY_BREACH_DELTA.items():
            deltas[dim] = round(deltas.get(dim, 0.0) + (b_val * violated_boundary_count * reactivity), 4)

    return deltas


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


class EmotionDeltaRules(BaseModel):
    """Rules for algorithmic emotion delta calculations."""

    intel_rules: IntelEmotionRules = Field(default_factory=IntelEmotionRules, description="Intel delta rules")


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
    challenge_recovery: float = Field(default=0.25, description="Share of the distance back to neutral (0.5) every emotion recovers when the next challenge begins")

    # D48/D50 (plan 11): Reframe picks an archetype per objection; fit against the stakeholder's
    # true archetype buckets into Direct Hit / Partial / Miss. No secondary for a single answer.
    reframe_hit: float = Field(default=0.7, description="Fit at or above this is a Direct Hit on Reframe")
    reframe_partial: float = Field(default=0.4, description="Fit at or above this (below Hit) is a Partial on Reframe")
    room_listen: float = Field(default=0.35, description="Fit below which another high-power stakeholder in the room turns colder on a Reframe (the room is listening)")
    emotion_reframe_miss: float = Field(default=-0.08, description="Reframe Miss: emotion hit to the objecting stakeholder, now hardened so only Amend clears it")
    emotion_room_listening: float = Field(default=-0.03, description="Reframe: slight emotion hit to other high-power stakeholders with a poor fit to the chosen archetype")
    default_patience: int = Field(default=3, description="Patience per stakeholder per challenge (D50, was 2)")
    sound_out_patience_cost: int = Field(default=1, description="Patience spent when sounding a stakeholder out in Build your case (D50)")

    impatience_step: float = Field(default=0.15, description="Emotion offset (per dimension) of the first impatience step, before the stakeholder's stress / sense-of-control scaling")
    impatience_cap: int = Field(default=3, description="Most impatience steps a stakeholder can carry within one challenge")
    impatience_decay: float = Field(default=0.6, description="Each further impatience step adds this fraction of the previous step's growth (diminishing)")
    impatience_relief: float = Field(default=0.08, description="Trust and fairness gain when a stakeholder's standing objection is finally answered")


class EmotionConfig(BaseModel):
    """Complete Emotion & CME Configuration object matching EmotionValueConfig.json."""

    emotion_values: list[EmotionDimension] = Field(default_factory=list, description="Configured emotion dimensions")
    emotion_prompts: dict[str, str] = Field(default_factory=dict, description="Prompts per emotional state")
    emotional_states: dict[str, EmotionalStateRule] = Field(default_factory=dict, description="State transition rules")
    emotion_colors: dict[str, str] = Field(default_factory=dict, description="Hex color codes for emotional states")
    emotion_delta_rules: Optional[EmotionDeltaRules] = Field(default=None, description="Algorithmic emotion delta rules")
    pitch_tuning: PitchTuning = Field(default_factory=PitchTuning, description="Pitch phase tuning numbers (D38)")

