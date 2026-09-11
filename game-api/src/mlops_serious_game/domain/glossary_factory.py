import json
from pathlib import Path

from mlops_serious_game.domain.glossary import GlossaryConfig, GlossaryTerm


class GlossaryFactory:
    """Holds the MLOps glossary that drives in-game term highlighting.

    The client does the actual matching, so this side only has to load, validate and hand out
    the configuration. Loading is tolerant on purpose: a broken or missing glossary must never
    stop a game from starting, it just means nothing gets highlighted.
    """

    config: GlossaryConfig | None = None

    @classmethod
    def load_glossary(cls, glossary_config: Path) -> None:
        """Loads the glossary from a JSON configuration file."""
        with glossary_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        config = GlossaryConfig(**data)

        known_categories = {c.id for c in config.categories}
        seen_ids: set[str] = set()
        valid_terms: list[GlossaryTerm] = []
        for term in config.terms:
            if term.id in seen_ids:
                print(f"glossary: skipping duplicate term id '{term.id}'")
                continue
            if known_categories and term.category not in known_categories:
                print(f"glossary: term '{term.id}' references unknown category '{term.category}'")
            seen_ids.add(term.id)
            valid_terms.append(term)

        config.terms = valid_terms
        cls.config = config

    @classmethod
    def get_config(cls) -> GlossaryConfig:
        """Returns the loaded configuration, or an empty one when nothing loaded."""
        return cls.config or GlossaryConfig()

    @classmethod
    def get_config_dict(cls) -> dict:
        """Returns the configuration as plain JSON-serialisable data for the client."""
        return cls.get_config().model_dump()

    @classmethod
    def get_terms(cls) -> list[GlossaryTerm]:
        """Returns every term that is currently active."""
        return [t for t in cls.get_config().terms if not t.disabled]
