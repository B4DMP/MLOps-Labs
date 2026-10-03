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
    TriggerCondition,
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
    def _derive_winning_rule(cls, ev: EmotionValues) -> tuple[str, Optional[EmotionalStateRule]]:
        """Shared by derive_emotional_state and derive_gating_dimensions: the highest scoring
        state among triggered conditions, together with the rule that won (None for 'neutral',
        since neutral has no conditions to point back to).
        """
        cls.ensure_loaded()
        if not cls.config or not cls.config.emotional_states:
            return "neutral", None

        triggered: dict[str, tuple[float, EmotionalStateRule]] = {}

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
                triggered[state_name] = (rule.formula.calculate(ev), rule)

        if not triggered:
            return "neutral", None

        winning_state = max(triggered, key=lambda name: triggered[name][0])
        return winning_state, triggered[winning_state][1]

    @classmethod
    def derive_emotional_state(cls, ev: EmotionValues) -> str:
        """Computes resulting emotion intensity scores and returns the highest scoring emotion
        among triggered conditions, falling back to 'neutral'.
        """
        state_name, _ = cls._derive_winning_rule(ev)
        return state_name

    @staticmethod
    def _bucket_dimension_value(value: float) -> str:
        if value <= 0.34:
            return "low"
        if value >= 0.66:
            return "high"
        return "medium"

    @staticmethod
    def _condition_gap(cond: TriggerCondition, val: float) -> float:
        """How far a value sits from satisfying one condition - 0 once it's met, otherwise the
        distance still to close. Used only to rank states by how close they are to firing."""
        if cond.op in ("<=", "<"):
            return max(0.0, val - cond.value)
        if cond.op in (">=", ">"):
            return max(0.0, cond.value - val)
        return abs(val - cond.value)

    @classmethod
    def _nearest_rule(cls, ev: EmotionValues) -> tuple[Optional[str], Optional[EmotionalStateRule]]:
        """When nothing is triggered, the non-neutral state whose conditions sit closest to firing -
        the edge a neutral stakeholder is nearest to tipping over. Ties keep dict order (config order).
        """
        cls.ensure_loaded()
        if not cls.config or not cls.config.emotional_states:
            return None, None

        best_state: Optional[str] = None
        best_rule: Optional[EmotionalStateRule] = None
        best_gap: Optional[float] = None

        for state_name, rule in cls.config.emotional_states.items():
            if state_name == "neutral" or not rule.conditions:
                continue
            gap = 0.0
            for cond in rule.conditions:
                val = ev.get(cond.metric, 0.5) if isinstance(ev, dict) else getattr(ev, cond.metric, 0.5)
                gap += cls._condition_gap(cond, val)
            if best_gap is None or gap < best_gap:
                best_gap, best_state, best_rule = gap, state_name, rule

        return best_state, best_rule

    @classmethod
    def derive_gating_dimensions(cls, ev: EmotionValues) -> dict[str, Any]:
        """Which emotion dimensions are gating the stakeholder's current state, bucketed
        Low/Medium/High rather than exposing the raw score - for the dossier's emotion reveal.
        Neutral has no conditions of its own, so a neutral stakeholder still gets a reading: the
        dimensions belonging to whichever state sits closest to tipping them over, flagged
        `is_current: False` so the UI can read it as "leaning toward" rather than "currently".
        """
        state_name, rule = cls._derive_winning_rule(ev)
        is_current = rule is not None
        if not is_current:
            state_name, rule = cls._nearest_rule(ev)
        if not rule:
            return {"state": None, "is_current": False, "dimensions": []}

        dims: list[dict[str, str]] = []
        seen: set[str] = set()
        for cond in rule.conditions:
            if cond.metric in seen:
                continue
            seen.add(cond.metric)
            val = ev.get(cond.metric, 0.5) if isinstance(ev, dict) else getattr(ev, cond.metric, 0.5)
            dims.append({"metric": cond.metric, "bucket": cls._bucket_dimension_value(val)})
        return {"state": state_name, "is_current": is_current, "dimensions": dims}

    @classmethod
    def get_emotion_dimensions_dict(cls, emotion_values_dict: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Returns a mapping of stakeholder_id -> gating info, mirroring get_emotion_states_dict."""
        ret = {}
        for key, ev in (emotion_values_dict or {}).items():
            if isinstance(ev, dict):
                ret[key] = cls.derive_gating_dimensions(ev)
            elif hasattr(ev, "model_dump"):
                ret[key] = cls.derive_gating_dimensions(ev.model_dump())
            elif hasattr(ev, "dict"):
                ret[key] = cls.derive_gating_dimensions(ev.dict())
            else:
                ret[key] = {"state": None, "is_current": False, "dimensions": []}
        return ret

    @classmethod
    def derive_all_dimensions(cls, ev: EmotionValues) -> list[dict[str, str]]:
        """All configured emotion dimensions, bucketed Low/Medium/High - unlike
        derive_gating_dimensions, not limited to the dimensions gating the current state.
        For the dossier's full emotion reveal.
        """
        dims: list[dict[str, str]] = []
        for dim in cls.get_emotion_values():
            val = ev.get(dim.id, 0.5) if isinstance(ev, dict) else getattr(ev, dim.id, 0.5)
            dims.append({"metric": dim.id, "bucket": cls._bucket_dimension_value(val)})
        return dims

    @classmethod
    def get_all_dimensions_dict(cls, emotion_values_dict: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
        """Returns a mapping of stakeholder_id -> all 7 bucketed dimensions, mirroring
        get_emotion_dimensions_dict."""
        ret = {}
        for key, ev in (emotion_values_dict or {}).items():
            if isinstance(ev, dict):
                ret[key] = cls.derive_all_dimensions(ev)
            elif hasattr(ev, "model_dump"):
                ret[key] = cls.derive_all_dimensions(ev.model_dump())
            elif hasattr(ev, "dict"):
                ret[key] = cls.derive_all_dimensions(ev.dict())
            else:
                ret[key] = []
        return ret

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


