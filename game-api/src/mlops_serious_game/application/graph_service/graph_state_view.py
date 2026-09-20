"""Builds the graph:state payload sent to the client, filtered by player knowledge.

The server filters every component and edge by the player's Knowledge before sending:
- unknown: topology only (id, name, owner), no levels
- current: full data at current ground truth
- stale: data at last-seen snapshot, marked with seen_at seq

Stage health is sent as ground truth (server knows it) plus a player-viewable band that
reflects what the player can infer from their observations. The band shrinks to a point
once all targets in a stage are observed.
"""

from typing import Optional

from mlops_serious_game.domain.graph import (
    GraphState,
    Knowledge,
    Level,
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
            nominal = state.component_levels.get(tid, state.edge_levels.get(tid, Level.ABSENT))
            if nominal == Level.BROKEN:
                known_broken += 1
        elif ks == "stale":
            entry = knowledge.seen[tid]
            if entry.nominal == Level.BROKEN:
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
    """Governance band is always visible; everything else waits until its phase is current (D33)."""
    if stage.band or stage.phase_id is None:
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
                "band": s.band,
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
            "band": s.band,
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
    governance_flows = [
        {"from": f.from_stage, "to": f.to_stage, "level": f.level, "weakest_edge_id": f.weakest_edge_id}
        for f in stage_view.governance_flows
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
                    "allowed_levels": c.allowed_levels,
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
                nominal, eff_val = entry.nominal, entry.effective
                extra = {"seen_at": entry.seq}
            else:
                nominal = state.component_levels[c.id]
                eff_val = effective.components[c.id]
                extra = {}

            comp: dict = {
                "id": c.id,
                "name": c.name,
                "stage_id": c.stage_id,
                "owner_id": owner,
                "knowledge": ks,
                "nominal": nominal,
                "effective": eff_val,
                "allowed_levels": c.allowed_levels,
                "story": story_for(graph, state, c.id, nominal),
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
                    {"intended": d.intended_level, "applied": d.applied_level, "owner_id": d.owner_id}
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
            
            from_known = reached and knowledge.state_of(e.from_id, state) != "unknown"
            to_known = reached and knowledge.state_of(e.to_id, state) != "unknown"
            edge_directly_known = reached and knowledge.state_of(e.id, state) != "unknown"

            is_known = edge_directly_known or from_known or to_known
            ks = knowledge.state_of(e.id, state) if edge_directly_known else ("current" if is_known else "unknown")

            if ks == "unknown":
                edges.append({
                    "id": e.id,
                    "from_id": e.from_id,
                    "to_id": e.to_id,
                    "kind": e.kind,
                    "slack": e.slack,
                    "knowledge": "unknown",
                    "allowed_levels": e.allowed_levels,
                    "allowed_triggers": e.allowed_triggers,
                })
                continue

            if ks == "stale":
                entry = knowledge.seen.get(e.id)
                lv = entry.nominal if entry else state.edge_levels[e.id]
                trigger = (entry.trigger or "none") if entry else state.edge_triggers.get(e.id, "none")
                extra = {"seen_at": entry.seq} if entry else {}
            else:
                lv = state.edge_levels[e.id]
                trigger = state.edge_triggers.get(e.id, "none")
                extra = {}

            edge: dict = {
                "id": e.id,
                "from_id": e.from_id,
                "to_id": e.to_id,
                "kind": e.kind,
                "slack": e.slack,
                "knowledge": ks,
                "level": lv,
                "trigger": trigger,
                "allowed_levels": e.allowed_levels,
                "allowed_triggers": e.allowed_triggers,
                "story": story_for(graph, state, e.id, lv),
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
        "governance_flows": governance_flows,
        "technical": technical,
        "system_health": stage_view.system_health,
    }
