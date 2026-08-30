import pytest
from mlops_serious_game.domain.emotion import EmotionConfig, EmotionalStateRule
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.application.dialogue_options_service.state import DialogueOption
from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype


def test_emotion_config_facial_expressions():
    EmotionFactory.ensure_loaded()
    config = EmotionFactory.get_config()
    assert config is not None
    assert len(config.emotional_states) > 0

    # Ensure all configured states have facial_expression assigned
    for state_name, rule in config.emotional_states.items():
        assert hasattr(rule, "facial_expression")
        assert isinstance(rule.facial_expression, str)
        assert len(rule.facial_expression) > 0

    # Test specific known emotional states
    assert config.emotional_states["angry"].facial_expression == "veryAngry"
    assert config.emotional_states["anxious"].facial_expression == "concernedFear"
    assert config.emotional_states["frustrated"].facial_expression == "concerned"
    assert config.emotional_states["enthusiastic"].facial_expression == "smileBig"
    assert config.emotional_states["skeptical"].facial_expression == "suspicious"
    assert config.emotional_states["apathetic"].facial_expression == "tired"
    assert config.emotional_states["relieved"].facial_expression == "smile"
    assert config.emotional_states["overwhelmed"].facial_expression == "hectic"
    assert config.emotional_states["neutral"].facial_expression == "serious"


def test_derive_facial_expression():
    EmotionFactory.ensure_loaded()

    # Neutral values -> neutral state -> serious expression
    neutral_ev = EmotionFactory.create_default_emotion_values(0.5)
    expr = EmotionFactory.derive_facial_expression(neutral_ev)
    assert expr == "serious"

    # High fairness and trust, very high stress, low trust -> angry -> veryAngry expression
    angry_ev = {
        "fairness": 0.2,
        "trust": 0.2,
        "stress": 0.8,
        "interest": 0.5,
        "confidence": 0.5,
        "perceived_risk": 0.5,
        "sense_of_control": 0.5,
    }
    expr_angry = EmotionFactory.derive_facial_expression(angry_ev)
    assert expr_angry == "veryAngry"


def test_get_facial_expressions_dict():
    EmotionFactory.ensure_loaded()
    emotion_values_map = {
        "st_1": EmotionFactory.create_default_emotion_values(0.5),
        "st_2": {
            "fairness": 0.2,
            "trust": 0.2,
            "stress": 0.8,
            "interest": 0.5,
            "confidence": 0.5,
            "perceived_risk": 0.5,
            "sense_of_control": 0.5,
        },
    }

    result = EmotionFactory.get_facial_expressions_dict(emotion_values_map)
    assert result["st_1"] == "serious"
    assert result["st_2"] == "veryAngry"


def test_dialogue_option_serialization():
    # Intel-based option
    intel_opt = DialogueOption(
        text="Alice, we should consider real-time inference latency.",
        intel_item_id="req_101",
    )
    d_intel = intel_opt.model_dump()
    assert d_intel["text"] == "Alice, we should consider real-time inference latency."
    assert d_intel["intel_item_id"] == "req_101"
    assert d_intel["archetype"] is None

    # Corporate noise option
    arch = ConvincerArchetype(name="Technical Excellence", strategy="Focus on data and technical details.")
    noise_opt = DialogueOption(
        text="We will ensure technical rigor and strict evaluation benchmarks.",
        intel_item_id=None,
        archetype=arch,
    )
    d_noise = noise_opt.model_dump()
    assert d_noise["intel_item_id"] is None
    assert d_noise["archetype"]["name"] == "Technical Excellence"


@pytest.mark.anyio
async def test_unverified_intel_item_dialogue_option_generation():
    from mlops_serious_game.domain.requirement import StakeholderIntelItem, ConfidenceType, RequirementType
    from mlops_serious_game.application.dialogue_options_service.nodes import dialogue_option_node
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    from pathlib import Path

    RequirementFactory.load_requirements(Path("../gameConfig/RequirementObjects.json"))

    # Unverified / unconfirmed intel item
    unverified_item = StakeholderIntelItem(
        id="test_unverified_1",
        requirement_id="req_0_model_monica_hard_constraint_0",
        intel_type=ConfidenceType.UNCONFIRMED,
        categorized_type=RequirementType.REQUIREMENT,
        description="Model Monica mandates that the model must achieve at least 95% accuracy.",
    )

    assert unverified_item.stakeholder_id == "model_monica"
    assert unverified_item.categorized_description == "Model Monica mandates that the model must achieve at least 95% accuracy."

    state = {
        "messages": [],
        "challenge": "Model Monica proposes a complex ML model. Efficiency Emilia argues for simpler model.",
        "discovered_intel_items": [unverified_item],
    }

    result = await dialogue_option_node(state)
    options = result["dialogue_options"]
    assert len(options) == 4

    # Verify at least one dialogue option is intel-based
    intel_options = [opt for opt in options if opt.intel_item_id]
    assert len(intel_options) >= 1
    assert intel_options[0].intel_item_id is not None


@pytest.mark.anyio
async def test_misclassified_intel_item_dialogue_option_generation():
    from mlops_serious_game.domain.requirement import StakeholderIntelItem, ConfidenceType, RequirementType
    from mlops_serious_game.application.dialogue_options_service.nodes import dialogue_option_node
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    from pathlib import Path

    RequirementFactory.load_requirements(Path("../gameConfig/RequirementObjects.json"))

    # Misclassified intel item (categorized as PERSONAL_FRICTION instead of HARD_CONSTRAINT)
    misclassified_item = StakeholderIntelItem(
        id="test_wrong_1",
        requirement_id="req_0_model_monica_hard_constraint_0",
        intel_type=ConfidenceType.UNCONFIRMED,
        categorized_type=RequirementType.PERSONAL_FRICTION,
        description="Model Monica expresses strong personal frustration about accuracy standards.",
    )

    assert misclassified_item.stakeholder_id == "model_monica"
    assert misclassified_item.is_correct_intel() is False
    assert misclassified_item.correct_description != ""
    assert misclassified_item.correct_intent == RequirementType.HARD_CONSTRAINT

    state = {
        "messages": [],
        "challenge": "Model Monica proposes a complex ML model. Efficiency Emilia argues for simpler model.",
        "discovered_intel_items": [misclassified_item],
    }

    result = await dialogue_option_node(state)
    options = result["dialogue_options"]
    assert len(options) == 4

    # Verify wrongly classified intel still generates an intel-based dialogue option
    intel_options = [opt for opt in options if opt.intel_item_id]
    assert len(intel_options) >= 1
    assert intel_options[0].intel_item_id is not None
    assert intel_options[0].is_correct([misclassified_item]) is False

