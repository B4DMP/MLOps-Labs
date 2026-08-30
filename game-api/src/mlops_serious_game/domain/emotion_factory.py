import json
import math
from pathlib import Path
from typing import Any, Optional

from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype
from mlops_serious_game.domain.emotion import (
    EmotionConfig,
    EmotionDelta,
    EmotionDeltaRules,
    EmotionDimension,
    EmotionValues,
    EmotionalStateRule,
    apply_emotion_delta,
)


class EmotionFactory:
    config: Optional[EmotionConfig] = None

    @classmethod
    def load_config(cls, config_path: Path) -> EmotionConfig:
        """Deserializes EmotionValueConfig.json into domain EmotionConfig."""
        with config_path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.config = EmotionConfig(**data)
        if cls.config and cls.config.convincer_archetypes:
            for arch_name, arch in cls.config.convincer_archetypes.items():
                if not arch.name:
                    arch.name = arch_name
        return cls.config

    @classmethod
    def ensure_loaded(cls) -> None:
        """Ensures configuration is loaded from default path if not already loaded."""
        if cls.config is None:
            base_dir = Path(__file__).parent
            default_path = (base_dir / "../../../../gameConfig/EmotionValueConfig.json").resolve()
            if default_path.exists():
                cls.load_config(default_path)

    @classmethod
    def get_config(cls) -> Optional[EmotionConfig]:
        """Returns the loaded EmotionConfig."""
        cls.ensure_loaded()
        return cls.config

    @classmethod
    def get_emotion_values(cls) -> list[EmotionDimension]:
        """Returns list of configured emotion dimensions."""
        cls.ensure_loaded()
        return cls.config.emotion_values if cls.config else []

    @classmethod
    def get_available_dimensions(cls) -> list[str]:
        """Returns list of dimension IDs."""
        return [dim.id for dim in cls.get_emotion_values()]

    @classmethod
    def create_default_emotion_values(cls, initial_value: float = 0.5) -> EmotionValues:
        """Returns a dict mapping all configured dimension IDs -> initial_value (e.g. 0.5)."""
        return {dim.id: initial_value for dim in cls.get_emotion_values()}

    @classmethod
    def create_emotion_values(cls, values: Optional[dict[str, float]] = None, **kwargs) -> EmotionValues:
        """Returns a dict with all configured defaults overridden by provided values/kwargs."""
        state = cls.create_default_emotion_values()
        if values:
            state.update(values)
        state.update(kwargs)
        return state

    @classmethod
    def apply_delta(
        cls,
        current_values: EmotionValues,
        deltas: EmotionDelta,
    ) -> EmotionValues:
        """Applies deltas to current emotion values dictionary."""
        return apply_emotion_delta(current_values, deltas)

    @classmethod
    def get_emotion_colors(cls) -> dict[str, str]:
        """Returns dictionary of emotion / emotional state colors."""
        cls.ensure_loaded()
        if not cls.config:
            return {}

        colors = dict(cls.config.emotion_colors)
        for state_name, rule in cls.config.emotional_states.items():
            if rule.color:
                colors[state_name] = rule.color
                if rule.facial_expression:
                    colors[rule.facial_expression] = rule.color
        return colors

    @classmethod
    def get_available_states(cls) -> list[str]:
        """Returns list of emotional state keys."""
        cls.ensure_loaded()
        if not cls.config:
            return []
        return list(cls.config.emotional_states.keys())

    @classmethod
    def get_emotion_prompts(cls) -> dict[str, str]:
        """Returns dictionary of state -> character tone prompt."""
        cls.ensure_loaded()
        return cls.config.emotion_prompts if cls.config else {}

    @classmethod
    def derive_emotional_state(cls, ev: EmotionValues) -> str:
        """Computes resulting emotion intensity scores and returns the highest scoring emotion
        among triggered conditions, falling back to 'neutral'.
        """
        cls.ensure_loaded()
        if not cls.config or not cls.config.emotional_states:
            return "neutral"

        triggered_scores: dict[str, float] = {}

        for state_name, rule in cls.config.emotional_states.items():
            if state_name == "neutral":
                continue

            # Check if all conditions evaluate to True (AND conjunction)
            all_met = True
            for cond in rule.conditions:
                if not cond.evaluate(ev):
                    all_met = False
                    break

            if all_met:
                score = rule.formula.calculate(ev)
                triggered_scores[state_name] = score

        if not triggered_scores:
            return "neutral"

        return max(triggered_scores, key=triggered_scores.get)

    @classmethod
    def derive_facial_expression_for_state(cls, state_name: str) -> str:
        """Retrieves the character avatar facial expression corresponding to the given emotion state."""
        cls.ensure_loaded()
        if cls.config and state_name in cls.config.emotional_states:
            rule = cls.config.emotional_states[state_name]
            if hasattr(rule, "facial_expression") and rule.facial_expression:
                return rule.facial_expression
        return "smile"

    @classmethod
    def derive_facial_expression(cls, ev: EmotionValues) -> str:
        """Computes the emotional state from emotion values and returns the corresponding avatar facial expression."""
        state_name = cls.derive_emotional_state(ev)
        return cls.derive_facial_expression_for_state(state_name)

    @classmethod
    def get_facial_expressions_dict(cls, emotion_values_dict: dict[str, Any]) -> dict[str, str]:
        """Returns a mapping of stakeholder_id -> avatar facial expression."""
        ret = {}
        for key, ev in (emotion_values_dict or {}).items():
            if isinstance(ev, dict):
                ret[key] = cls.derive_facial_expression(ev)
            elif hasattr(ev, "model_dump"):
                ret[key] = cls.derive_facial_expression(ev.model_dump())
            elif hasattr(ev, "dict"):
                ret[key] = cls.derive_facial_expression(ev.dict())
            else:
                ret[key] = "smile"
        return ret

    @classmethod
    def derive_emotion_prompt(cls, emotion_state: str) -> str:
        """Retrieves the character card tone prompt corresponding to the given emotion state."""
        cls.ensure_loaded()
        if not cls.config:
            return ""
        return cls.config.emotion_prompts.get(
            emotion_state,
            cls.config.emotion_prompts.get("neutral", ""),
        )

    @classmethod
    def get_convincer_archetypes(cls) -> dict[str, ConvincerArchetype]:
        """Returns dict of configured convincer archetypes (name -> archetype)."""
        cls.ensure_loaded()
        return cls.config.convincer_archetypes if cls.config else {}

    @classmethod
    def get_available_archetype_names(cls) -> list[str]:
        """Returns list of names/keys of all configured convincer archetypes."""
        return list(cls.get_convincer_archetypes().keys())

    @classmethod
    def get_archetype_by_name(cls, name: str) -> Optional[ConvincerArchetype]:
        """Finds a convincer archetype by case-insensitive name or key."""
        if not name:
            return None
        cls.ensure_loaded()
        archetypes = cls.get_convincer_archetypes()
        if name in archetypes:
            arch = archetypes[name]
            if not arch.name:
                arch.name = name
            return arch
        target = name.strip().lower()
        for key, arch in archetypes.items():
            if key.strip().lower() == target or (arch.name and arch.name.strip().lower() == target):
                if not arch.name:
                    arch.name = arch.name or key
                return arch
        return None

    @classmethod
    def calculate_emotion_deltas(
        cls,
        st_id: str,
        last_intel: Optional[Any],
        selected_option: Optional[Any],
    ) -> dict[str, float]:
        """Calculates algorithmic emotion deltas based on configuration in EmotionValueConfig.json."""
        cls.ensure_loaded()
        rules = cls.config.emotion_delta_rules
        dimensions = cls.get_available_dimensions()
        deltas: dict[str, float] = {f"{dim}_delta": 0.0 for dim in dimensions}

        st_archetype = cls.get_archetype_by_name(st_id)
        if not st_archetype:
            all_archs = cls.get_convincer_archetypes()
            st_archetype = all_archs.get(st_id)

        # 1. If an Intel Option was used
        if last_intel and rules and rules.intel_rules:
            if st_id == getattr(last_intel, "stakeholder_id", None):
                is_correct = last_intel.is_correct_intel() if hasattr(last_intel, "is_correct_intel") else True
                rule_deltas = rules.intel_rules.correct_intel if is_correct else rules.intel_rules.misattributed_intel
                for metric, val in rule_deltas.items():
                    key = f"{metric}_delta"
                    deltas[key] = round(deltas.get(key, 0.0) + val, 2)

        # 2. If a Corporate Noise option with an Archetype was used
        elif selected_option and getattr(selected_option, "archetype", None) and st_archetype and rules and rules.corporate_noise_rules:
            opt_arch = selected_option.archetype
            c_rules = rules.corporate_noise_rules

            diff_evidence = abs(opt_arch.evidence_basis - st_archetype.evidence_basis)
            diff_risk = abs(opt_arch.risk_and_control - st_archetype.risk_and_control)
            diff_horizon = abs(opt_arch.value_horizon - st_archetype.value_horizon)

            total_distance = math.sqrt(diff_evidence**2 + diff_risk**2 + diff_horizon**2)

            # Trust delta based on total distance
            threshold = c_rules.distance_threshold
            slope = c_rules.distance_slope
            if total_distance < threshold:
                trust_val = c_rules.base_trust_bonus + (threshold - total_distance) * slope
            else:
                trust_val = c_rules.base_trust_penalty - (total_distance - threshold) * slope
            deltas["trust_delta"] = round(deltas.get("trust_delta", 0.0) + trust_val, 2)

            # Dimension alignments
            dim_diffs = {
                "risk_and_control": (diff_risk, opt_arch.risk_and_control, st_archetype.risk_and_control),
                "value_horizon": (diff_horizon, opt_arch.value_horizon, st_archetype.value_horizon),
                "evidence_basis": (diff_evidence, opt_arch.evidence_basis, st_archetype.evidence_basis),
            }

            for dim_rule in c_rules.dimension_alignments:
                if dim_rule.dimension not in dim_diffs:
                    continue
                diff_val, opt_val, st_val = dim_diffs[dim_rule.dimension]

                for cond in dim_rule.conditions:
                    matched = False
                    if cond.type == "option_min" and cond.min_value is not None:
                        if opt_val >= cond.min_value:
                            matched = True
                    elif cond.type == "diff_bonus" and cond.max_diff is not None:
                        if diff_val <= cond.max_diff:
                            matched = True
                    elif cond.type == "diff_penalty":
                        if cond.target_min_value is not None and cond.min_diff is not None:
                            if st_val >= cond.target_min_value and diff_val >= cond.min_diff:
                                matched = True
                        elif cond.min_diff is not None:
                            if diff_val >= cond.min_diff:
                                matched = True

                    if matched:
                        for metric, val in cond.deltas.items():
                            key = f"{metric}_delta"
                            deltas[key] = round(deltas.get(key, 0.0) + val, 2)

        return deltas

