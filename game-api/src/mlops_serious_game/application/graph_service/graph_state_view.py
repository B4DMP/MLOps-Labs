"""Builds the graph:state payload sent to the client, filtered by player knowledge.

The server filters every component and edge by the player's Knowledge before sending:
- unknown: topology only (id, name, owner), no levels
- current: full data at current ground truth
- stale: data at last-seen snapshot, marked with seen_at seq

Stage health is sent as ground truth (server knows it) plus a player-viewable band that
reflects what the player can infer from their observations. The band shrinks to a point
once all targets in a stage are observed.

Every component/edge also ships its curated automation/governance/attribute options
(docs/plans/graph-governance-automation-rework/00-plan.md §2.4/§2.5) - the compose UI offers
these instead of raw values.
"""

from typing import Optional

from mlops_serious_game.domain.graph import (
    AutomationState,
    GraphState,
    Knowledge,
    Stage,
    TechnicalGraph,
)
from mlops_serious_game.application.graph_service.effective import EffectiveView
from mlops_serious_game.application.graph_service.stage_graph import StageGraphView
from mlops_serious_game.application.graph_service.story import story_for
from mlops_serious_game.domain.pattern import Pattern


def _stage_band(
    stage_id: str,
    graph: TechnicalGraph,
    state: GraphState,
    effective: EffectiveView,
    knowledge: Knowledge,
    true_health: float,
    effect: float,
    debt: int,
) -> tuple[float, float]:
    """Min and max health the player can infer from their observations of this stage."""
    t = graph.thresholds
    bp = t.broken_penalty_per_target
    dp = t.debt_penalty_per_entry

    known_broken = 0
    unknown_count = 0

    targets: list[str] = [c.id for c in graph.components if c.stage_id == stage_id]
    targets += [
        e.id for e in graph.pipeline_edges()
        if graph.component(e.from_id).stage_id == stage_id
        and graph.component(e.to_id).stage_id == stage_id
    ]

    for tid in targets:
        ks = knowledge.state_of(tid, state)
        if ks == "current":
            # Only a target broken in itself costs health (D35); starved ones are free.
            if state.automation(tid) == AutomationState.BROKEN:
                known_broken += 1
        elif ks == "stale":
            entry = knowledge.seen[tid]
            if entry.nominal_automation == AutomationState.BROKEN:
                known_broken += 1
            else:
                unknown_count += 1  # last seen fine, may have changed
        else:
            unknown_count += 1

    base = 100 + effect - bp * known_broken - dp * debt
    best = round(max(0.0, min(100.0, base)), 1)
    worst = round(max(0.0, min(100.0, base - bp * unknown_count)), 1)
    return (worst, best)


def _stage_reached(stage: Stage, current_phase_id: Optional[int]) -> bool:
    """A stage is reached once its phase is current (D33)."""
    if stage.phase_id is None:
        return True
    if current_phase_id is None:
        return True
    # Phase 0 is the introduction phase; it is skipped for stage progression calculations (technical stages begin at Phase 1: 'req').
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
    knowledge: Knowledge,
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

    stages = []
    for s in graph.stages:
        reached = _stage_reached(s, current_phase_id)
        if not reached:
            stages.append({
                "id": s.id,
                "name": s.name,
                "phase_id": s.phase_id,
                "locked": True,
            })
            continue

        sv = sv_by_id[s.id]
        band = _stage_band(
            s.id, graph, state, effective, knowledge,
            sv.health, sv.pattern_effect, sv.debt,
        )
        stages.append({
            "id": s.id,
            "name": s.name,
            "phase_id": s.phase_id,
            "locked": False,
            "health": sv.health,
            "health_band": band,
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

    # Technical: one entry per stage. Stages the player has not reached yet still ship their
    # topology - names and wiring - so the board reads as a plan, not a blank. Everything about
    # their state stays hidden: every target is reported as "unknown" regardless of knowledge.
    technical: dict[str, dict] = {}
    for s in graph.stages:
        reached = _stage_reached(s, current_phase_id)

        components = []
        for c in graph.components:
            if c.stage_id != s.id:
                continue
            owner = graph.owner_of(c.id)
            ks = knowledge.state_of(c.id, state) if reached else "unknown"

            if ks == "unknown":
                base = {
                    "id": c.id,
                    "name": c.name,
                    "stage_id": c.stage_id,
                    "knowledge": "unknown",
                    "allowed_automation": c.allowed_automation,
                    "allowed_governance": c.allowed_governance,
                }
                if reached:
                    base["owner_id"] = owner
                if c.layout:
                    base["layout"] = c.layout
                if c.icon:
                    base["icon"] = c.icon
                components.append(base)
                continue

            if ks == "stale":
                entry = knowledge.seen[c.id]
                nom_auto, nom_gov = entry.nominal_automation, entry.nominal_governance
                eff_auto, eff_gov = entry.effective_automation, entry.effective_governance
                extra = {"seen_at": entry.seq}
            else:
                nom_auto, nom_gov = state.component_automation[c.id], state.component_governance[c.id]
                eff_auto, eff_gov = effective.automation[c.id], effective.governance[c.id]
                extra = {}

            comp: dict = {
                "id": c.id,
                "name": c.name,
                "stage_id": c.stage_id,
                "owner_id": owner,
                "knowledge": ks,
                "nominal_automation": nom_auto,
                "nominal_governance": nom_gov,
                "effective_automation": eff_auto,
                "effective_governance": eff_gov,
                "allowed_automation": c.allowed_automation,
                "allowed_governance": c.allowed_governance,
                "automation_options": _options_payload(c.automation_options),
                "governance_options": _options_payload(c.governance_options),
                "story": story_for(graph, state, c.id, (nom_auto, nom_gov)),
                **extra,
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

            # Investigating a component already observes every edge touching it
            # (component_investigation_service.conduct_component_investigation_turn), so an
            # edge's own knowledge entry is the only thing that should reveal its levels -
            # inferring it from an endpoint's knowledge leaked automation/governance/trigger
            # for edges the player never actually investigated.
            ks = knowledge.state_of(e.id, state) if reached else "unknown"

            if ks == "unknown":
                edges.append({
                    "id": e.id,
                    "from_id": e.from_id,
                    "to_id": e.to_id,
                    "kind": e.kind,
                    "slack": e.slack,
                    "knowledge": "unknown",
                    "allowed_automation": e.allowed_automation,
                    "allowed_governance": e.allowed_governance,
                    "allowed_triggers": e.allowed_triggers,
                })
                continue

            if ks == "stale":
                entry = knowledge.seen.get(e.id)
                automation = entry.nominal_automation if entry else state.edge_automation[e.id]
                governance = entry.nominal_governance if entry else state.edge_governance[e.id]
                eff_automation = entry.effective_automation if entry else effective.automation[e.id]
                eff_governance = entry.effective_governance if entry else effective.governance[e.id]
                trigger = (entry.trigger or "none") if entry else state.edge_triggers.get(e.id, "none")
                extra = {"seen_at": entry.seq} if entry else {}
            else:
                automation = state.edge_automation[e.id]
                governance = state.edge_governance[e.id]
                eff_automation = effective.automation[e.id]
                eff_governance = effective.governance[e.id]
                trigger = state.edge_triggers.get(e.id, "none")
                extra = {}

            edge: dict = {
                "id": e.id,
                "from_id": e.from_id,
                "to_id": e.to_id,
                "kind": e.kind,
                "slack": e.slack,
                "knowledge": ks,
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
                **extra,
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
    }
