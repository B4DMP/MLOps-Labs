"""One call that turns ground truth into everything derived from it: effective levels, active
patterns and the stage graph with health."""

from typing import Optional

from pydantic import BaseModel

from mlops_serious_game.application.graph_service.effective import compute_effective
from mlops_serious_game.application.graph_service.stage_graph import StageGraphView, stage_graph
from mlops_serious_game.domain.graph import EffectiveView, GraphState, TechnicalGraph
from mlops_serious_game.domain.graph_predicates import PredicateContext, evaluate
from mlops_serious_game.domain.pattern import Pattern, PatternFactory


class GraphEvaluation(BaseModel):
    effective: EffectiveView
    active_patterns: list[str]
    stage_graph: StageGraphView

    def context(self, graph: TechnicalGraph, state: GraphState) -> PredicateContext:
        return PredicateContext(graph, state, self.effective, frozenset(self.active_patterns))


def active_patterns(
    graph: TechnicalGraph,
    state: GraphState,
    effective: EffectiveView,
    patterns: list[Pattern],
    order: list[str],
) -> list[str]:
    """Evaluates patterns dependencies first, so a pattern may reference another one."""
    by_id = {p.id: p for p in patterns}
    active: set[str] = set()
    for pid in order:
        ctx = PredicateContext(graph, state, effective, frozenset(active))
        if evaluate(by_id[pid].when, ctx).value:
            active.add(pid)
    return [pid for pid in order if pid in active]


def pattern_effects(active: list[str], patterns: list[Pattern]) -> dict[str, float]:
    by_id = {p.id: p for p in patterns}
    effects: dict[str, float] = {}
    for pid in active:
        for stage, delta in by_id[pid].stage_effects.items():
            effects[stage] = effects.get(stage, 0.0) + delta
    return effects


def evaluate_graph(
    graph: TechnicalGraph,
    state: GraphState,
    patterns: Optional[list[Pattern]] = None,
    order: Optional[list[str]] = None,
) -> GraphEvaluation:
    if patterns is None:
        patterns, order = PatternFactory.patterns, PatternFactory.order
    order = order if order is not None else [p.id for p in patterns]
    effective = compute_effective(graph, state)
    active = active_patterns(graph, state, effective, patterns, order)
    view = stage_graph(graph, state, effective, pattern_effects(active, patterns))
    return GraphEvaluation(effective=effective, active_patterns=active, stage_graph=view)
