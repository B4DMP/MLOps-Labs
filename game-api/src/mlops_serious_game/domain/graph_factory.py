import json
from pathlib import Path

from mlops_serious_game.domain.graph import TechnicalGraph


class GraphConfigError(ValueError):
    pass


def _toposort(nodes: list[str], edges: list[tuple[str, str]]) -> list[str]:
    """Kahn's algorithm. Raises GraphConfigError on a cycle. Stable: ties keep config order."""
    incoming = {n: 0 for n in nodes}
    outgoing: dict[str, list[str]] = {n: [] for n in nodes}
    for src, dst in edges:
        outgoing[src].append(dst)
        incoming[dst] += 1
    ready = [n for n in nodes if incoming[n] == 0]
    order: list[str] = []
    while ready:
        n = ready.pop(0)
        order.append(n)
        for m in outgoing[n]:
            incoming[m] -= 1
            if incoming[m] == 0:
                ready.append(m)
    if len(order) != len(nodes):
        cyclic = sorted(n for n in nodes if incoming[n] > 0)
        raise GraphConfigError(f"pipeline edges form a cycle through: {cyclic}")
    return order


def validate_graph(graph: TechnicalGraph) -> list[str]:
    """Returns the topological order of components over pipeline edges. Raises on any config error."""
    errors: list[str] = []
    level_range = set(range(len(graph.levels)))

    def check_unique(kind: str, ids: list[str]):
        seen: set[str] = set()
        for i in ids:
            if i in seen:
                errors.append(f"duplicate {kind} id '{i}'")
            seen.add(i)

    check_unique("stage", [s.id for s in graph.stages])
    check_unique("component", [c.id for c in graph.components])
    check_unique("edge", [e.id for e in graph.edges])
    overlap = {c.id for c in graph.components} & {e.id for e in graph.edges}
    if overlap:
        errors.append(f"ids used for both a component and an edge: {sorted(overlap)}")

    stage_ids = {s.id for s in graph.stages}
    for c in graph.components:
        if c.stage_id not in stage_ids:
            errors.append(f"component '{c.id}' references unknown stage '{c.stage_id}'")
            continue
        if not set(c.allowed_levels) <= level_range or not c.allowed_levels:
            errors.append(f"component '{c.id}' has invalid allowed_levels {c.allowed_levels}")
        if c.initial_level not in c.allowed_levels:
            errors.append(f"component '{c.id}' initial_level {c.initial_level} not allowed")
        if not (c.owner_role or graph.stage(c.stage_id).owner_role):
            errors.append(f"component '{c.id}' has no owner and its stage has none either")

    for e in graph.edges:
        for end in (e.from_id, e.to_id):
            if not graph.is_component(end):
                errors.append(f"edge '{e.id}' references unknown component '{end}'")
        if not set(e.allowed_levels) <= level_range or not e.allowed_levels:
            errors.append(f"edge '{e.id}' has invalid allowed_levels {e.allowed_levels}")
        if e.initial_level not in e.allowed_levels:
            errors.append(f"edge '{e.id}' initial_level {e.initial_level} not allowed")
        unknown_triggers = set(e.allowed_triggers) - set(graph.triggers)
        if unknown_triggers:
            errors.append(f"edge '{e.id}' allows unknown triggers {sorted(unknown_triggers)}")
        if e.initial_trigger not in e.allowed_triggers:
            errors.append(f"edge '{e.id}' initial_trigger '{e.initial_trigger}' not allowed")

    for target in graph.briefing_observed:
        if not graph.is_target(target):
            errors.append(f"briefing_observed references unknown target '{target}'")

    for old, new in graph.aliases.items():
        if graph.is_target(old):
            errors.append(f"alias '{old}' shadows a live id")
        if not graph.is_target(graph.resolve(old)) and graph.resolve(old) not in graph.retired:
            errors.append(f"alias '{old}' resolves to unknown id '{graph.resolve(old)}'")
    for rid in graph.retired:
        if graph.is_target(rid):
            errors.append(f"retired id '{rid}' is still defined")

    if errors:
        raise GraphConfigError("; ".join(errors))

    return _toposort(
        [c.id for c in graph.components],
        [(e.from_id, e.to_id) for e in graph.pipeline_edges()],
    )


class GraphFactory:
    graph: TechnicalGraph | None = None
    topo_order: list[str] = []

    @classmethod
    def load_graph(cls, path: Path) -> TechnicalGraph:
        with path.open("r", encoding="utf-8") as f:
            graph = TechnicalGraph.model_validate(json.load(f))
        cls.topo_order = validate_graph(graph)
        cls.graph = graph
        return graph

    @classmethod
    def get_graph(cls) -> TechnicalGraph:
        if cls.graph is None:
            raise GraphConfigError("MLOps graph not loaded")
        return cls.graph
