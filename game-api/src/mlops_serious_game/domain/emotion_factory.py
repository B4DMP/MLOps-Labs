import json
from pathlib import Path
from typing import Any, Optional

from mlops_serious_game.domain.emotion import (
    EmotionConfig,
    EmotionDelta,
    EmotionDeltaRules,
    EmotionDimension,
    EmotionValues,
    EmotionalStateRule,
    PitchTuning,
    apply_emotion_delta,
    get_patience_malus,
)


class EmotionFactory:
    config: Optional[EmotionConfig] = None

    @classmethod
    def load_config(cls, config_path: Path) -> EmotionConfig:
        """Deserializes EmotionValueConfig.json into domain EmotionConfig."""
        with config_path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.config = EmotionConfig(**data)
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
    def get_pitch_tuning(cls) -> PitchTuning:
        """Returns the pitch phase tuning numbers (D38), defaulting to the pre-D38 hardcoded values
        if EmotionValueConfig.json omits `pitch_tuning` or no config was ever loaded (e.g. a bare
        import with no gameConfig directory mounted)."""
        cls.ensure_loaded()
        return cls.config.pitch_tuning if cls.config else PitchTuning()

    @classmethod
    def get_patience_malus(cls) -> EmotionDelta:
        """Returns the configured dimensional patience malus vector."""
        tuning = cls.get_pitch_tuning()
        return get_patience_malus(tuning.patience_malus)


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
    def get_emotion_states_dict(cls, emotion_values_dict: dict[str, Any]) -> dict[str, str]:
        ret = {}
        for key, ev in (emotion_values_dict or {}).items():
            if isinstance(ev, dict):
                ret[key] = cls.derive_emotional_state(ev)
            elif hasattr(ev, "model_dump"):
                ret[key] = cls.derive_emotional_state(ev.model_dump())
            elif hasattr(ev, "dict"):
                ret[key] = cls.derive_emotional_state(ev.dict())
            else:
                ret[key] = "neutral"
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
    def calculate_emotion_deltas(
        cls,
        st_id: str,
        last_intel: Optional[Any],
        selected_option: Optional[Any],
    ) -> dict[str, float]:
        """Calculates algorithmic emotion deltas based on configuration in EmotionValueConfig.json."""
        cls.ensure_loaded()
        rules = cls.config.emotion_delta_rules if cls.config else None
        dimensions = cls.get_available_dimensions()
        deltas: dict[str, float] = {f"{dim}_delta": 0.0 for dim in dimensions}

        # If an Intel Option was used
        if last_intel and rules and rules.intel_rules:
            if st_id == getattr(last_intel, "stakeholder_id", None):
                is_correct = last_intel.is_correct_intel() if hasattr(last_intel, "is_correct_intel") else True
                rule_deltas = rules.intel_rules.correct_intel if is_correct else rules.intel_rules.misattributed_intel
                for metric, val in rule_deltas.items():
                    key = f"{metric}_delta"
                    deltas[key] = round(deltas.get(key, 0.0) + val, 2)

        return deltas


