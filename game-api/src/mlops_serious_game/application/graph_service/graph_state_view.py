"""Builds the graph:state payload sent to the client.

Every component and edge ships full ground-truth data plus its curated automation/governance
options (docs/plans/graph-governance-automation-rework/00-plan.md §2.4) - the compose UI offers
these instead of raw values.
"""

from typing import Optional

from mlops_serious_game.domain.graph import (
    GraphState,
    Stage,
    TechnicalGraph,
)
from mlops_serious_game.application.graph_service.effective import EffectiveView
from mlops_serious_game.application.graph_service.phase_stage import stage_for_phase
from mlops_serious_game.application.graph_service.stage_graph import StageGraphView
from mlops_serious_game.application.graph_service.story import story_for
from mlops_serious_game.domain.pattern import Pattern


def _stage_reached(stage: Stage, current_phase_id: Optional[int]) -> bool:
    """A stage is reached once its phase is current (D33)."""
    if stage.phase_id is None:
        return True
    if current_phase_id is None:
        return True
    effective_phase = max(1, current_phase_id)
    return stage.phase_id <= effective_phase


def _patterns_by_stage(
    patterns: list[Pattern], active: set[str]
) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for p in patterns:
        if p.id not in active:
            continue
        for stage_id in p.stage_effects:
            result.setdefault(stage_id, []).append({"id": p.id, "kind": p.kind, "name": p.name})
    return result


def _options_payload(options) -> list[dict]:
    return [{"to_level": o.to_level, "trigger": o.trigger, "name": o.name, "description": o.description} for o in options]


def build_graph_state(
    graph: TechnicalGraph,
    state: GraphState,
    effective: EffectiveView,
    stage_view: StageGraphView,
    patterns: list[Pattern],
    active_patterns: list[str],
    current_phase_id: Optional[int],
) -> dict:
    """Returns the full graph:state payload."""
    active_set = set(active_patterns)
    pat_by_stage = _patterns_by_stage(patterns, active_set)
    sv_by_id = {sv.id: sv for sv in stage_view.stages}

    # The demo phase plays in a later stage than its own id, so stages are reached by that stage.
    active_stage = stage_for_phase(graph, current_phase_id)
    reach_phase = active_stage.phase_id if active_stage and active_stage.phase_id else current_phase_id

    stages = []
    for s in graph.stages:
        reached = _stage_reached(s, reach_phase)
        if not reached:
            stages.append({
                "id": s.id,
                "name": s.name,
                "phase_id": s.phase_id,
                "locked": True,
            })
            continue

        sv = sv_by_id[s.id]
        stages.append({
            "id": s.id,
            "name": s.name,
            "phase_id": s.phase_id,
            "locked": False,
            "health": sv.health,
            "status": sv.status,
            "maturity": sv.maturity,
            "broken": sv.broken,
            "starved": sv.starved,
            "debt": sv.debt,
            "patterns": pat_by_stage.get(s.id, []),
        })

    flows = [
        {"from": f.from_stage, "to": f.to_stage, "level": f.level, "weakest_edge_id": f.weakest_edge_id}
        for f in stage_view.flows
    ]
    feedback_flows = [
        {"from": f.from_stage, "to": f.to_stage, "level": f.level, "weakest_edge_id": f.weakest_edge_id}
        for f in stage_view.feedback_flows
    ]

    # Technical: one entry per stage, every target with full data.
    technical: dict[str, dict] = {}
    for s in graph.stages:
        components = []
        for c in graph.components:
            if c.stage_id != s.id:
                continue
            owner = graph.owner_of(c.id)
            nom_auto, nom_gov = state.component_automation[c.id], state.component_governance[c.id]
            eff_auto, eff_gov = effective.automation[c.id], effective.governance[c.id]

            comp: dict = {
                "id": c.id,
                "name": c.name,
                "stage_id": c.stage_id,
                "owner_id": owner,
                "nominal_automation": nom_auto,
                "nominal_governance": nom_gov,
                "effective_automation": eff_auto,
                "effective_governance": eff_gov,
                "allowed_automation": c.allowed_automation,
                "allowed_governance": c.allowed_governance,
                "automation_options": _options_payload(c.automation_options),
                "governance_options": _options_payload(c.governance_options),
                "story": story_for(graph, state, c.id, (nom_auto, nom_gov)),
            }
            if c.layout:
                comp["layout"] = c.layout
            if c.icon:
                comp["icon"] = c.icon
            if c.id in effective.capped_by:
                comp["capped_by"] = effective.capped_by[c.id]
            if state.debt:
                debt_entries = [
                    {"intended": d.intended_level, "applied": d.applied_level, "axis": d.axis, "owner_id": d.owner_id}
                    for d in state.debt if d.target_id == c.id
                ]
                if debt_entries:
                    comp["debt"] = debt_entries
            instances = [
                {"id": i.id, "kind": i.kind, "name": i.name, "state": i.state, "props": i.props}
                for i in state.instances.values()
                if i.component_id == c.id
            ]
            if instances:
                comp["instances"] = instances
            components.append(comp)

        edges = []
        for e in graph.edges:
            if graph.component(e.from_id).stage_id != s.id:
                continue

            automation = state.edge_automation[e.id]
            governance = state.edge_governance[e.id]
            eff_automation = effective.automation[e.id]
            eff_governance = effective.governance[e.id]
            trigger = state.edge_triggers.get(e.id, "none")

            edge: dict = {
                "id": e.id,
                "from_id": e.from_id,
                "to_id": e.to_id,
                "kind": e.kind,
                "slack": e.slack,
                "automation": automation,
                "governance": governance,
                "effective_automation": eff_automation,
                "effective_governance": eff_governance,
                "trigger": trigger,
                "allowed_automation": e.allowed_automation,
                "allowed_governance": e.allowed_governance,
                "allowed_triggers": e.allowed_triggers,
                "automation_options": _options_payload(e.automation_options),
                "governance_options": _options_payload(e.governance_options),
                "story": story_for(graph, state, e.id, (automation, governance)),
            }
            if e.id in effective.capped_by:
                edge["capped_by"] = effective.capped_by[e.id]
            edges.append(edge)

        technical[s.id] = {"components": components, "edges": edges}

    return {
        "stages": stages,
        "flows": flows,
        "feedback_flows": feedback_flows,
        "technical": technical,
        "system_health": stage_view.system_health,
        "active_stage_id": active_stage.id if active_stage else None,
    }
