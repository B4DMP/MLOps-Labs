import json
from pathlib import Path

from mlops_serious_game.domain.glossary import GlossaryConfig, GlossaryTerm

MLOPS = "mlops"
DOMAIN = "domain"
# The order the client compiles them in, which is what settles a form both glossaries claim.
KIND_ORDER = (MLOPS, DOMAIN)


class GlossaryFactory:
    """Holds the glossaries that drive in-game term highlighting.

    There are two: the MLOps practice a player is meant to learn, and the vocabulary of the world
    the game is set in. They are separate files with separate categories and their own underline
    style, but they are handed to the client together, because the client matches them in one pass
    so that no word is ever highlighted twice.

    The client does the actual matching, so this side only has to load, validate and hand out the
    configuration. Loading is tolerant on purpose: a broken or missing glossary must never stop a
    game from starting, it just means nothing gets highlighted.
    """

    configs: dict[str, GlossaryConfig] = {}

    # Settings that describe how one pass over the text behaves rather than what one glossary
    # contains. The client compiles every glossary into a single regular expression, so these
    # cannot differ per file: the first glossary's value applies to all of them.
    SHARED_SETTINGS = ("case_sensitive", "match_whole_words", "max_highlights_per_term_per_block")

    @classmethod
    def load_glossary(cls, glossary_config: Path, kind: str = MLOPS) -> None:
        """Loads one glossary from a JSON configuration file."""
        with glossary_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        config = GlossaryConfig(**{**data, "kind": data.get("kind", kind)})

        known_categories = {c.id for c in config.categories}
        seen_ids: set[str] = set()
        valid_terms: list[GlossaryTerm] = []
        for term in config.terms:
            if term.id in seen_ids:
                print(f"glossary ({config.kind}): skipping duplicate term id '{term.id}'")
                continue
            if known_categories and term.category not in known_categories:
                print(f"glossary ({config.kind}): term '{term.id}' references unknown category '{term.category}'")
            seen_ids.add(term.id)
            valid_terms.append(term)

        config.terms = valid_terms
        cls.configs[config.kind] = config
        for warning in cls.collisions() + cls.shared_setting_conflicts():
            print(f"glossary: {warning}")

    @classmethod
    def clear(cls) -> None:
        cls.configs = {}

    @classmethod
    def get_config(cls, kind: str = MLOPS) -> GlossaryConfig:
        """Returns one loaded configuration, or an empty one when nothing loaded."""
        return cls.configs.get(kind) or GlossaryConfig(kind=kind)

    @classmethod
    def get_configs(cls) -> list[GlossaryConfig]:
        """Every loaded glossary, in the order the client should compile them."""
        ordered = [cls.configs[k] for k in KIND_ORDER if k in cls.configs]
        extra = [c for k, c in sorted(cls.configs.items()) if k not in KIND_ORDER]
        return ordered + extra

    @classmethod
    def get_config_dict(cls, kind: str = MLOPS) -> dict:
        """One configuration as plain JSON-serialisable data for the client."""
        return cls.get_config(kind).model_dump()

    @classmethod
    def get_configs_dict(cls) -> list[dict]:
        """Every configuration as plain JSON-serialisable data for the client."""
        return [c.model_dump() for c in cls.get_configs()]

    @classmethod
    def get_terms(cls, kind: str | None = None) -> list[GlossaryTerm]:
        """Every term that is currently active, from one glossary or from all of them."""
        configs = [cls.get_config(kind)] if kind else cls.get_configs()
        return [t for c in configs for t in c.terms if not t.disabled]

    @classmethod
    def surface_forms(cls, config: GlossaryConfig) -> dict[str, str]:
        """Every spelling this glossary answers to, lowercased, mapped to the term that owns it."""
        forms: dict[str, str] = {}
        for term in config.terms:
            if term.disabled:
                continue
            for form in [term.term, *term.aliases]:
                key = (form or "").strip().lower()
                if key:
                    forms.setdefault(key, term.id)
        return forms

    @classmethod
    def collisions(cls) -> list[str]:
        """Spellings that more than one glossary claims.

        The client matches both glossaries in one pass and prefers the longest form, so
        "distribution centre" beats the MLOps "distribution" without anyone having to intervene.
        An identical spelling in both files has no such tie-breaker: the first glossary compiled
        wins every occurrence, and the other entry silently never appears. That is an authoring
        mistake, so it is reported rather than resolved. Lengthen one of the two forms, for
        instance "shelf edge label" rather than a second "label".
        """
        seen: dict[str, tuple[str, str]] = {}
        found: list[str] = []
        for config in cls.get_configs():
            for form, term_id in cls.surface_forms(config).items():
                if form in seen and seen[form][0] != config.kind:
                    other_kind, other_term = seen[form]
                    found.append(
                        f"'{form}' is claimed by both the {other_kind} glossary ({other_term}) and the "
                        f"{config.kind} glossary ({term_id}); only the {other_kind} one will ever match"
                    )
                else:
                    seen[form] = (config.kind, term_id)
        return found

    @classmethod
    def shared_setting_conflicts(cls) -> list[str]:
        """Settings a later glossary sets differently and will therefore not get."""
        configs = cls.get_configs()
        if len(configs) < 2:
            return []
        leading, *rest = configs
        found = []
        for config in rest:
            for name in cls.SHARED_SETTINGS:
                mine, theirs = getattr(config.settings, name), getattr(leading.settings, name)
                if mine != theirs:
                    found.append(
                        f"the {config.kind} glossary sets {name}={mine}, but matching happens in one "
                        f"pass, so the {leading.kind} glossary's {name}={theirs} is what applies"
                    )
        return found
