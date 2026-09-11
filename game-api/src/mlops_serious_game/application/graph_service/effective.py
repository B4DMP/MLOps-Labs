"""Effective levels: what each component and edge actually delivers given its upstream.

Nominal is what was built. Effective is capped by the incoming pipeline edges and the
components feeding them, so a break upstream propagates downstream.
"""

from pydantic import BaseModel, Field

from mlops_serious_game.domain.graph import GraphState, Level, TechnicalGraph
from mlops_serious_game.domain.graph_factory import GraphFactory, validate_graph


class EffectiveView(BaseModel):
    components: dict[str, int] = Field(default_factory=dict)
    edges: dict[str, int] = Field(default_factory=dict)
    capped_by: dict[str, str] = Field(
        default_factory=dict, description="Binding constraint per capped target: an edge id or an upstream component id"
    )

    def level(self, target_id: str) -> int:
        if target_id in self.components:
            return self.components[target_id]
        return self.edges[target_id]


def _topo_order(graph: TechnicalGraph) -> list[str]:
    if graph is GraphFactory.graph and GraphFactory.topo_order:
        return GraphFactory.topo_order
    return validate_graph(graph)


def compute_effective(graph: TechnicalGraph, state: GraphState) -> EffectiveView:
    view = EffectiveView()
    incoming: dict[str, list] = {c.id: [] for c in graph.components}
    for e in graph.pipeline_edges():
        incoming[e.to_id].append(e)

    for cid in _topo_order(graph):
        nominal = state.component_levels[cid]
        effective = nominal
        # A component that does not exist cannot be broken by its upstream.
        if nominal > Level.ABSENT:
            for e in incoming[cid]:
                upstream = view.components[e.from_id]
                edge_level = state.edge_levels[e.id]
                cap = min(upstream, edge_level) + e.slack
                if cap < effective:
                    effective = cap
                    # Name the root cause: the upstream component if it is the tighter limit.
                    view.capped_by[cid] = e.from_id if upstream < edge_level else e.id
        view.components[cid] = effective

    for e in graph.edges:
        nominal = state.edge_levels[e.id]
        effective = nominal
        if nominal > Level.ABSENT:
            source_cap = view.components[e.from_id] + 1
            if source_cap < effective:
                effective = source_cap
                view.capped_by[e.id] = e.from_id
        view.edges[e.id] = effective

    return view
