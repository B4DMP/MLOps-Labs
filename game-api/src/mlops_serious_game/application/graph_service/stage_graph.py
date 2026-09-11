"""The stage graph: derived from the technical graph every time, never stored.

Health measures problems, not maturity (D32): a stage is at 100 until something goes wrong.

    health = clamp(100 + pattern effect - broken penalty * broken targets - debt penalty * debt, 0, 100)

Pattern effect is design bonuses minus antipattern penalties (plan 03), so design patterns buffer
damage. Broken targets are components and edges whose effective level is 0, which counts what a
break takes down downstream. Maturity is reported next to health, never mixed into it.
"""

from typing import Optional

from pydantic import BaseModel

from mlops_serious_game.application.graph_service.effective import EffectiveView
from mlops_serious_game.domain.graph import MAX_LEVEL, GraphState, Level, TechnicalGraph


class StageView(BaseModel):
    id: str
    name: str
    band: bool
    maturity: float
    pattern_effect: float
    broken: int
    debt: int
    health: float
    status: str


class FlowView(BaseModel):
    from_stage: str
    to_stage: str
    level: int
    weakest_edge_id: str


class StageGraphView(BaseModel):
    stages: list[StageView]
    flows: list[FlowView]
    feedback_flows: list[FlowView] = []
    system_health: float


def _status(health: float, graph: TechnicalGraph) -> str:
    if health > graph.thresholds.healthy:
        return "healthy"
    if health > graph.thresholds.degraded:
        return "degraded"
    return "broken"


def stage_graph(
    graph: TechnicalGraph,
    state: GraphState,
    effective: EffectiveView,
    pattern_effects: Optional[dict[str, float]] = None,
) -> StageGraphView:
    t = graph.thresholds
    pattern_effects = pattern_effects or {}
    stages: list[StageView] = []

    for s in graph.stages:
        levels = [effective.components[c.id] for c in graph.components if c.stage_id == s.id]
        levels += [
            effective.edges[e.id]
            for e in graph.edges
            if graph.component(e.from_id).stage_id == s.id and graph.component(e.to_id).stage_id == s.id
        ]
        maturity = sum(levels) / (len(levels) * MAX_LEVEL) if levels else 0.0
        broken = sum(1 for lv in levels if lv == Level.BROKEN)
        debt = sum(1 for d in state.debt if graph.stage_of(d.target_id) == s.id)
        effect = pattern_effects.get(s.id, 0.0)
        health = 100 + effect - t.broken_penalty_per_target * broken - t.debt_penalty_per_entry * debt
        health = round(max(0.0, min(100.0, health)), 1)
        stages.append(
            StageView(
                id=s.id,
                name=s.name,
                band=s.band,
                maturity=round(maturity, 3),
                pattern_effect=effect,
                broken=broken,
                debt=debt,
                health=health,
                status=_status(health, graph),
            )
        )

    weakest: dict[tuple[str, str], tuple[int, str]] = {}
    for e in graph.pipeline_edges():
        a, b = graph.component(e.from_id).stage_id, graph.component(e.to_id).stage_id
        if a == b:
            continue
        level = effective.edges[e.id]
        if (a, b) not in weakest or level < weakest[(a, b)][0]:
            weakest[(a, b)] = (level, e.id)
    flows = [FlowView(from_stage=a, to_stage=b, level=lv, weakest_edge_id=eid) for (a, b), (lv, eid) in weakest.items()]

    # Cross-stage non-pipeline edges (feedback, monitoring) — weakest per stage pair.
    fb_weakest: dict[tuple[str, str], tuple[int, str]] = {}
    for e in graph.edges:
        if e.kind == "pipeline":
            continue
        a, b = graph.component(e.from_id).stage_id, graph.component(e.to_id).stage_id
        if a == b:
            continue
        level = effective.edges[e.id]
        if (a, b) not in fb_weakest or level < fb_weakest[(a, b)][0]:
            fb_weakest[(a, b)] = (level, e.id)
    feedback_flows = [FlowView(from_stage=a, to_stage=b, level=lv, weakest_edge_id=eid) for (a, b), (lv, eid) in fb_weakest.items()]

    total_weight = sum(s.weight for s in graph.stages)
    by_id = {v.id: v for v in stages}
    system = sum(by_id[s.id].health * s.weight for s in graph.stages) / total_weight if total_weight else 0.0

    return StageGraphView(stages=stages, flows=flows, feedback_flows=feedback_flows, system_health=round(system, 1))
