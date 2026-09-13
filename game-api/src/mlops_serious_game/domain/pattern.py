"""Named graph shapes, good (design) or bad (anti). They set stage health and schedule challenges.

Authored in gameConfig/MlopsPatterns.json as predicates over the technical graph.
"""

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from mlops_serious_game.domain.graph import TechnicalGraph
from mlops_serious_game.domain.graph_factory import GraphConfigError, _toposort
from mlops_serious_game.domain.graph_predicates import validate_predicate


class Pattern(BaseModel):
    id: str
    kind: Literal["anti", "design"]
    name: str
    description: str = ""
    when: Any
    stage_effects: dict[str, float]
    story: str
    tags: list[str] = Field(default_factory=list)
    consequence_ops: list[dict] = Field(
        default_factory=list, description="World event ops fired each simulation while active (plan 07)"
    )


def pattern_refs(pred: Any) -> set[str]:
    """Pattern ids a predicate depends on."""
    if isinstance(pred, dict):
        refs = {pred["pattern"]} if "pattern" in pred else set()
        for key in ("all", "any"):
            for sub in pred.get(key, []):
                refs |= pattern_refs(sub)
        if "not" in pred:
            refs |= pattern_refs(pred["not"])
        return refs
    return set()


def predicate_targets(pred: Any) -> set[str]:
    """Components and edges a predicate reads. Attribute references count for their component."""
    if isinstance(pred, dict):
        found: set[str] = set()
        for key in ("component", "edge"):
            if key in pred:
                found.add(pred[key])
        if "attr" in pred:
            found.add(pred["attr"].rsplit(".", 1)[0])
        for key in ("all", "any"):
            for sub in pred.get(key, []):
                found |= predicate_targets(sub)
        if "not" in pred:
            found |= predicate_targets(pred["not"])
        return found
    return set()


def _op_errors(raw_ops: list[dict], graph: TechnicalGraph) -> list[str]:
    """Consequence ops fire without the player in the room, so a typo there has to fail on load."""
    from mlops_serious_game.domain.graph import GraphOp

    errors: list[str] = []
    for raw in raw_ops:
        try:
            op = GraphOp.model_validate(raw)
        except Exception as e:
            errors.append(str(e))
            continue
        if op.kind not in ("instance_upsert", "set_instance_prop") and not graph.is_target(graph.resolve(op.target)):
            errors.append(f"unknown target '{op.target}'")
    return errors


def validate_patterns(patterns: list[Pattern], graph: TechnicalGraph) -> list[str]:
    """Returns patterns in evaluation order (dependencies first). Raises on any config error."""
    errors: list[str] = []
    ids = [p.id for p in patterns]
    if len(ids) != len(set(ids)):
        errors.append("duplicate pattern ids")
    stage_ids = {s.id for s in graph.stages}
    for p in patterns:
        prefix = "ap_" if p.kind == "anti" else "dp_"
        if not p.id.startswith(prefix):
            errors.append(f"{p.kind} pattern '{p.id}' must start with '{prefix}'")
        for stage, effect in p.stage_effects.items():
            if stage not in stage_ids:
                errors.append(f"pattern '{p.id}' affects unknown stage '{stage}'")
            if (p.kind == "anti") != (effect < 0):
                errors.append(f"pattern '{p.id}': anti patterns subtract health, design patterns add it")
        errors += [f"pattern '{p.id}': {e}" for e in validate_predicate(p.when, graph, set(ids))]
        errors += [f"pattern '{p.id}' consequence_ops: {e}" for e in _op_errors(p.consequence_ops, graph)]
    if errors:
        raise GraphConfigError("; ".join(errors))
    try:
        return _toposort(ids, [(ref, p.id) for p in patterns for ref in pattern_refs(p.when)])
    except GraphConfigError as e:
        raise GraphConfigError(f"patterns reference each other in a cycle: {e}") from None


class PatternFactory:
    patterns: list[Pattern] = []
    order: list[str] = []

    @classmethod
    def load(cls, path: Path, graph: TechnicalGraph) -> list[Pattern]:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        patterns = [Pattern.model_validate(p) for p in data.get("patterns", [])]
        cls.order = validate_patterns(patterns, graph)
        cls.patterns = patterns
        return patterns

    @classmethod
    def get(cls, pattern_id: str) -> Pattern:
        for p in cls.patterns:
            if p.id == pattern_id:
                return p
        raise KeyError(pattern_id)

    @classmethod
    def ids(cls) -> set[str]:
        return {p.id for p in cls.patterns}


def uncovered_targets(patterns: list[Pattern], graph: TechnicalGraph) -> list[str]:
    """Components and pipeline edges no pattern reads. Raising them only moves the maturity term."""
    covered: set[str] = set()
    for p in patterns:
        covered |= predicate_targets(p.when)
    required = [c.id for c in graph.components] + [e.id for e in graph.pipeline_edges()]
    return [t for t in required if t not in covered]
