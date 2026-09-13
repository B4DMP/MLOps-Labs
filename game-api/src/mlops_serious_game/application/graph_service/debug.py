"""Build the admin/graph-debug payload. Intended for design and debugging only.

Never called during normal gameplay. Guarded by settings.ENABLE_GRAPH_DEBUG.
"""

from typing import Optional

from mlops_serious_game.application.graph_service.effective import EffectiveView
from mlops_serious_game.application.graph_service.stage_graph import StageGraphView
from mlops_serious_game.domain.graph import (
    GraphState,
    Knowledge,
    LoggedOp,
    TechnicalGraph,
)
from mlops_serious_game.domain.graph_predicates import PredicateContext, evaluate
from mlops_serious_game.domain.pattern import Pattern, predicate_targets


def build_graph_debug(
    graph: TechnicalGraph,
    state: GraphState,
    knowledge: Knowledge,
    effective: EffectiveView,
    stage_view: StageGraphView,
    patterns: list[Pattern],
    active_patterns: list[str],
    op_log: list[LoggedOp],
    phases: Optional[list] = None,
    played_templates: Optional[set[str]] = None,
) -> dict:
    """Returns the full graph:debug payload for the admin debug view."""
    active_set = set(active_patterns)
    played_set = played_templates or set()

    # 1. Stages — health decomposed.
    sv_by_id = {sv.id: sv for sv in stage_view.stages}
    stages = []
    for s in graph.stages:
        sv = sv_by_id.get(s.id)
        if sv is None:
            continue
        stages.append({
            "id": s.id,
            "name": s.name,
            "band": s.band,
            "health": sv.health,
            "maturity": sv.maturity,
            "broken": sv.broken,
            "starved": sv.starved,
            "starved_ids": sv.starved_ids,
            "debt": sv.debt,
            "pattern_effect": sv.pattern_effect,
        })

    # 2. Components — nominal and effective side by side, player knowledge vs ground truth.
    components = []
    for c in graph.components:
        ks = knowledge.state_of(c.id, state)
        nominal = state.component_levels.get(c.id, c.initial_level)
        eff_val = effective.components.get(c.id, nominal)
        row: dict = {
            "id": c.id,
            "stage_id": c.stage_id,
            "name": c.name,
            "owner": graph.owner_of(c.id),
            "nominal": nominal,
            "effective": eff_val,
            "knowledge": ks,
        }
        if c.id in effective.capped_by:
            row["capped_by"] = effective.capped_by[c.id]
        if state.attrs.get(c.id):
            row["attrs"] = dict(state.attrs[c.id])
        seen = knowledge.seen.get(c.id)
        if seen and ks == "stale":
            row["seen_level"] = seen.nominal
            row["seen_at"] = seen.seq
        components.append(row)

    # 3. Edges.
    edges = []
    for e in graph.edges:
        ks = knowledge.state_of(e.id, state)
        lv = state.edge_levels.get(e.id, e.initial_level)
        eff_edge = effective.edges.get(e.id, lv)
        trigger = state.edge_triggers.get(e.id, "none")
        row = {
            "id": e.id,
            "from": e.from_id,
            "to": e.to_id,
            "kind": e.kind,
            "level": lv,
            "effective": eff_edge,
            "trigger": trigger,
            "knowledge": ks,
        }
        if e.id in effective.capped_by:
            row["capped_by"] = effective.capped_by[e.id]
        seen = knowledge.seen.get(e.id)
        if seen and ks == "stale":
            row["seen_level"] = seen.nominal
            row["seen_at"] = seen.seq
        edges.append(row)

    # 4. Instances.
    instances = [
        {
            "id": i.id,
            "kind": i.kind,
            "component_id": i.component_id,
            "name": i.name,
            "state": i.state,
            "props": i.props,
        }
        for i in state.instances.values()
    ]

    # 5. Patterns — active with story, near-miss with full predicate trace showing why they failed.
    ctx = PredicateContext(graph, state, effective, frozenset(active_set))
    active_pat = []
    near_miss = []
    for p in patterns:
        result = evaluate(p.when, ctx)
        if p.id in active_set:
            active_pat.append({
                "id": p.id,
                "kind": p.kind,
                "name": p.name,
                "story": p.story,
                "stage_effects": p.stage_effects,
            })
        else:
            near_miss.append({
                "id": p.id,
                "kind": p.kind,
                "name": p.name,
                "failed_clause": result.trace,
            })

    # 6. Op log.
    op_log_rows = [
        {
            "seq": logged.seq,
            "kind": logged.op.kind,
            "target": logged.op.target,
            "value": logged.op.value,
            "source_kind": logged.op.source_kind,
            "source_id": logged.op.source_id,
            "reason": logged.op.reason,
        }
        for logged in op_log
    ]

    # 7. Challenge selection — eligible and rejected with predicate traces.
    challenges: dict = {"played": sorted(played_set), "eligible_now": [], "rejected": []}
    if phases is not None:
        for phase in phases:
            for c in phase.challenges:
                if c.template_id in played_set and not c.repeatable:
                    continue
                prec_result = evaluate(c.preconditions, ctx)
                excl_result = evaluate(c.excluded_if, ctx)
                if prec_result.value and not excl_result.value:
                    challenges["eligible_now"].append({
                        "template_id": c.template_id,
                        "phase_id": phase.id,
                        "fallback": c.fallback,
                        "priority": c.priority,
                    })
                else:
                    failed_trace = prec_result.trace if not prec_result.value else excl_result.trace
                    challenges["rejected"].append({
                        "template_id": c.template_id,
                        "phase_id": phase.id,
                        "failed_clause": failed_trace,
                    })

    # 8. Orphans — targets referenced by no pattern predicate (component/edge, or via an
    # attribute clause, which counts for the component it reads — see domain.pattern.predicate_targets).
    pattern_targets: set[str] = set()
    for p in patterns:
        pattern_targets |= predicate_targets(p.when)

    all_targets = {c.id for c in graph.components} | {e.id for e in graph.edges}
    targets_in_no_pattern = sorted(all_targets - pattern_targets)

    orphans = {
        "targets_in_no_pattern": targets_in_no_pattern,
        "targets_never_in_a_driver": [],   # plan 05: requires content index
        "levels_without_story_fragment": [],  # plan 05: requires fragment index
        "objections_never_reachable": [],   # plan 06
        "facts_on_nonexistent_targets": [], # plan 05
    }

    return {
        "stages": stages,
        "components": components,
        "edges": edges,
        "instances": instances,
        "patterns": {"active": active_pat, "near_miss": near_miss},
        "op_log": op_log_rows,
        "challenges": challenges,
        "orphans": orphans,
        "intel_index": [],   # plan 05
        "objections": [],    # plan 06
        "action_cards": [],  # plan 06
    }
