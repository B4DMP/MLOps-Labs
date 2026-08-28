import json
from pathlib import Path
from typing import Optional

from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype
from mlops_serious_game.domain.emotion import (
    EmotionConfig,
    EmotionDelta,
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
        cls.ensure_loaded()
        archetypes = cls.get_convincer_archetypes()
        if name in archetypes:
            return archetypes[name]
        target = name.strip().lower()
        for key, arch in archetypes.items():
            if key.strip().lower() == target or (arch.name and arch.name.strip().lower() == target):
                return arch
        return None
