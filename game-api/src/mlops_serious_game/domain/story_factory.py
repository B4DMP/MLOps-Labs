"""Story fragment config: deterministic story lines for graph targets, lookup only.

Fragment keys are "<level>" or "<level>|k=v|k=v". For components the pairs match attributes,
for edges the only key is "trigger". Generic per-level templates are the last resort.
"""

import json
from pathlib import Path

from mlops_serious_game.domain.graph import NARRATIVE_TIERS, TechnicalGraph


def _parse_key(key: str) -> tuple[int, dict[str, str]]:
    level, *pairs = key.split("|")
    conditions = dict(p.split("=", 1) for p in pairs)
    return int(level), conditions


class StoryConfigError(ValueError):
    pass


class StoryFactory:
    generic: dict[str, dict[int, str]] = {}
    targets: dict[str, list[tuple[int, dict[str, str], str]]] = {}

    @classmethod
    def load(cls, path: Path, graph: TechnicalGraph) -> None:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        cls.load_dict(data, graph)

    @classmethod
    def load_dict(cls, data: dict, graph: TechnicalGraph) -> None:
        generic = {kind: {int(k): v for k, v in templates.items()} for kind, templates in data.get("generic", {}).items()}
        levels = range(NARRATIVE_TIERS)
        for kind in ("component", "edge"):
            missing = [lv for lv in levels if lv not in generic.get(kind, {})]
            if missing:
                raise StoryConfigError(f"generic {kind} templates missing levels {missing}")
        targets: dict[str, list[tuple[int, dict[str, str], str]]] = {}
        for target, fragments in data.get("targets", {}).items():
            if not graph.is_target(target):
                raise StoryConfigError(f"story fragment for unknown target '{target}'")
            targets[target] = [(*_parse_key(k), text) for k, text in fragments.items()]
        cls.generic = generic
        cls.targets = targets

    @classmethod
    def has_specific(cls, target: str, level: int) -> bool:
        return any(lv == level for lv, _, _ in cls.targets.get(target, []))
