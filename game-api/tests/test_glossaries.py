"""The two glossaries: the MLOps practice, and the vocabulary of the world the game is set in.

The client does the matching, so what is worth testing here is what the client cannot fix: that
both files load, that they are handed over in the order the matching rules depend on, and that
they do not quietly fight each other over a spelling.
"""

import json

import pytest

from mlops_serious_game.domain.glossary_factory import DOMAIN, MLOPS, GlossaryFactory


@pytest.fixture
def loaded(config_dir):
    """Both real glossaries, loaded the way the config loader loads them."""
    GlossaryFactory.clear()
    GlossaryFactory.load_glossary(config_dir / "MLOpsGlossary.json", MLOPS)
    GlossaryFactory.load_glossary(config_dir / "DomainGlossary.json", DOMAIN)
    yield GlossaryFactory
    GlossaryFactory.clear()


def forms_of(config) -> set[str]:
    return set(GlossaryFactory.surface_forms(config))


def test_both_glossaries_load_with_their_own_categories_and_terms(loaded):
    mlops = loaded.get_config(MLOPS)
    domain = loaded.get_config(DOMAIN)

    assert mlops.terms and domain.terms
    assert mlops.kind == MLOPS and domain.kind == DOMAIN
    for config in (mlops, domain):
        assert config.categories, f"{config.kind} glossary has no categories"
        known = {c.id for c in config.categories}
        unknown = sorted({t.category for t in config.terms} - known)
        assert not unknown, f"{config.kind} terms use undefined categories: {unknown}"
        assert all(t.definition for t in config.terms), f"a {config.kind} term has no definition"


def test_the_two_are_underlined_differently(loaded):
    """The underline is the only thing that tells a player which vocabulary a word belongs to."""
    assert loaded.get_config(MLOPS).settings.underline_style == "dotted"
    assert loaded.get_config(DOMAIN).settings.underline_style == "wavy"


def test_mlops_is_served_first(loaded):
    """Order is not cosmetic: it is the tie-breaker for a spelling both files claim."""
    assert [c["kind"] for c in loaded.get_configs_dict()] == [MLOPS, DOMAIN]


def test_no_spelling_is_claimed_by_both_glossaries(loaded):
    """The real content, checked against the rule the client cannot express.

    A longer phrase containing a shorter one is fine and is how "distribution centre" beats the
    MLOps "distribution": the client prefers the longest form at a position. An *identical*
    spelling has no tie-breaker, so one of the two entries would silently never appear.
    """
    assert loaded.collisions() == []


def test_a_shared_spelling_is_reported(config_dir, capsys):
    GlossaryFactory.clear()
    GlossaryFactory.load_glossary(config_dir / "MLOpsGlossary.json", MLOPS)
    GlossaryFactory.configs[DOMAIN] = type(GlossaryFactory.get_config(MLOPS))(
        kind=DOMAIN,
        terms=[{"id": "shelf_label", "term": "label", "definition": "the paper price tag on a shelf"}],
    )

    collisions = GlossaryFactory.collisions()
    assert any("'label'" in c for c in collisions)
    assert any(MLOPS in c and DOMAIN in c for c in collisions)
    GlossaryFactory.clear()


def test_the_domain_glossary_covers_the_setting(config_dir, loaded):
    """The domain vocabulary exists to explain the world in Setting.json, so the words that world
    is built out of should be in it."""
    setting_path = config_dir / "Setting.json"
    if not setting_path.exists():
        pytest.skip("no Setting.json to check against")

    setting = json.loads(setting_path.read_text(encoding="utf-8"))["setting"]
    forms = forms_of(loaded.get_config(DOMAIN))
    vocabulary = " ".join(setting.get("vocabulary", {}).get("use", [])).lower()

    missing = [word for word in ("middle aisle", "buyer", "store manager", "waste", "availability")
               if word not in forms]
    assert not missing, f"the setting's own words are not in the domain glossary: {missing}"
    assert vocabulary, "the setting lists no vocabulary to check against"


def test_terms_are_long_enough_to_be_matched(loaded):
    """A form shorter than the glossary's minimum is dead weight: it is never compiled in."""
    for config in loaded.get_configs():
        minimum = config.settings.min_term_length
        for term in config.terms:
            forms = [f for f in [term.term, *term.aliases] if len(f.strip()) >= minimum]
            assert forms, f"{config.kind} term '{term.id}' has no form of at least {minimum} characters"
