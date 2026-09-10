import pytest

from mlops_serious_game.domain.persona import Persona
from mlops_serious_game.domain.persona_resolver import personalize, use_personas
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


def _stakeholder() -> Stakeholder:
    return Stakeholder(
        id="data_dave",
        name="Data Dave",
        responsibilities="You work with {model_monica} on data quality.",
        priorities="Pipelines",
        requirements="Storage",
        role_description="Data Engineer",
        introduction="Hi, I'm {data_dave}. Call me {data_dave.first}.",
        metric_id="data",
        avatar={"clothingColor": "0d6efd", "backgroundColor": "d1d4f9", "head": "short1"},
        personas=[
            Persona(key="dave", name="Data Dave", avatar={"head": "short1", "skinColor": "ffdbb4"}),
            Persona(key="dominic", name="Data Dominic", avatar={"head": "shaved2", "skinColor": "d08b5b"}),
        ],
    )


@pytest.fixture
def registered_cast():
    dave = _stakeholder()
    monica = Stakeholder(
        id="model_monica",
        name="Model Monica",
        responsibilities="Models",
        priorities="Accuracy",
        requirements="GPUs",
        role_description="ML Engineer",
        metric_id="model",
        personas=[
            Persona(key="monica", name="Model Monica"),
            Persona(key="maya", name="Model Maya"),
        ],
    )
    # The factory holds one shared cast; swap in a known one for these tests.
    original = list(StakeholderFactory.stakeholders)
    StakeholderFactory.stakeholders = [dave, monica]
    yield dave, monica
    StakeholderFactory.stakeholders = original


def test_tokens_stay_canonical_without_a_persona_map(registered_cast):
    """Anything running outside a player session sees the config as written."""
    assert personalize("{model_monica} said no") == "{model_monica} said no"
    assert StakeholderFactory.get_stakeholder("data_dave").name == "Data Dave"


def test_tokens_render_full_and_first_names(registered_cast):
    personas = StakeholderFactory.resolve_personas({"data_dave": "dominic", "model_monica": "maya"})
    with use_personas(personas):
        assert personalize("{data_dave} and {data_dave.first}") == "Data Dominic and Dominic"
        assert personalize("{model_monica} said no") == "Model Maya said no"


def test_markers_are_left_for_the_ui_and_resolved_for_prompts(registered_cast):
    personas = StakeholderFactory.resolve_personas({"model_monica": "maya"})
    with use_personas(personas):
        assert personalize("#model_monica# proposes") == "#model_monica# proposes"
        assert (
            personalize("#model_monica# proposes", resolve_markers=True)
            == "Model Maya proposes"
        )


def test_persona_swaps_the_look_but_not_the_identity_colors(registered_cast):
    personas = StakeholderFactory.resolve_personas({"data_dave": "dominic"})
    with use_personas(personas):
        avatar = StakeholderFactory.get_stakeholder("data_dave").avatar
    assert avatar["head"] == "shaved2"
    assert avatar["skinColor"] == "d08b5b"
    assert avatar["clothingColor"] == "0d6efd"
    assert avatar["backgroundColor"] == "d1d4f9"


def test_prose_referring_to_another_stakeholder_follows_that_persona(registered_cast):
    personas = StakeholderFactory.resolve_personas({"data_dave": "dave", "model_monica": "maya"})
    with use_personas(personas):
        dave = StakeholderFactory.get_stakeholder("data_dave")
    assert dave.responsibilities == "You work with Model Maya on data quality."
    assert dave.introduction == "Hi, I'm Data Dave. Call me Dave."


def test_a_persona_name_resolves_back_to_its_stakeholder(registered_cast):
    """A language model only ever hears the persona name and hands it back."""
    personas = StakeholderFactory.resolve_personas({"data_dave": "dominic"})
    with use_personas(personas):
        assert StakeholderFactory.get_stakeholder("Data Dominic").id == "data_dave"
        assert StakeholderFactory.get_stakeholder("Data Dave").id == "data_dave"


def test_the_draw_is_stable_for_a_player(registered_cast):
    first = StakeholderFactory.choose_personas("michal")
    assert first == StakeholderFactory.choose_personas("michal")
    assert set(first) == {"data_dave", "model_monica"}


def test_the_draw_backfills_without_recasting(registered_cast):
    existing = {"data_dave": "dominic"}
    filled = StakeholderFactory.choose_personas("michal", existing)
    assert filled["data_dave"] == "dominic"
    assert filled["model_monica"] in {"monica", "maya"}


def test_a_persona_key_that_left_the_config_is_redrawn(registered_cast):
    filled = StakeholderFactory.choose_personas("michal", {"data_dave": "retired"})
    assert filled["data_dave"] in {"dave", "dominic"}
