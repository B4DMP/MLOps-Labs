"""Effective levels: what each component and edge actually delivers given its upstream.

Nominal is what was built. Effective is capped by the incoming pipeline edges and the
components feeding them, so a break upstream propagates downstream.

Only the automation axis is ever capped (docs/plans/graph-governance-automation-rework/00-plan.md
decision 1) - governance is a review/audit dimension, not a flow-capacity one, so it always
equals its nominal value.
"""

from typing import Optional

from mlops_serious_game.domain.graph import AutomationState, EffectiveView, GraphState, TechnicalGraph
from mlops_serious_game.domain.graph_factory import GraphFactory, validate_graph


def _topo_order(graph: TechnicalGraph) -> list[str]:
    if graph is GraphFactory.graph and GraphFactory.topo_order:
        return GraphFactory.topo_order
    return validate_graph(graph)


def compute_effective(graph: TechnicalGraph, state: GraphState) -> EffectiveView:
    """A component delivers at most what reaches it: min(upstream supply, edge automation) + slack.

    A missing (absent) step is skipped: whatever reaches it passes straight through, and a
    missing step with nothing upstream constrains nothing. A broken step blocks: it supplies 0.
    """
    view = EffectiveView()
    incoming: dict[str, list] = {c.id: [] for c in graph.components}
    for e in graph.pipeline_edges():
        incoming[e.to_id].append(e)

    # What each component passes downstream, and the root cause when that is a limit.
    supply: dict[str, Optional[int]] = {}
    cause: dict[str, str] = {}

    for cid in _topo_order(graph):
        nominal = state.component_automation[cid]
        view.governance[cid] = state.component_governance[cid]
        caps: list[tuple[int, str]] = []
        for e in incoming[cid]:
            upstream = supply[e.from_id]
            if upstream is None:
                continue  # nothing exists upstream of this edge
            edge_automation = state.edge_automation[e.id]
            if upstream < edge_automation:
                caps.append((min(upstream, edge_automation) + e.slack, cause.get(e.from_id, e.from_id)))
            else:
                caps.append((edge_automation + e.slack, e.id))

        if nominal == AutomationState.BROKEN:
            view.automation[cid] = nominal
            supply[cid], cause[cid] = nominal, cid
        elif nominal == AutomationState.ABSENT:
            view.automation[cid] = nominal
            if caps:
                supply[cid], cause[cid] = min(caps)
            else:
                supply[cid] = None
        else:
            effective = nominal
            for cap, why in caps:
                if cap < effective:
                    effective = cap
                    view.capped_by[cid] = why
            view.automation[cid] = effective
            supply[cid] = effective
            cause[cid] = view.capped_by.get(cid, cid)

    for e in graph.edges:
        nominal = state.edge_automation[e.id]
        view.governance[e.id] = state.edge_governance[e.id]
        effective = nominal
        upstream = supply.get(e.from_id) if e.kind == "pipeline" else view.automation[e.from_id]
        if nominal > AutomationState.ABSENT and upstream is not None and upstream + 1 < effective:
            effective = upstream + 1
            view.capped_by[e.id] = cause.get(e.from_id, e.from_id)
        view.automation[e.id] = effective

    return view


__all__ = ["EffectiveView", "compute_effective"]
