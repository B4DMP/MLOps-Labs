import json
from pathlib import Path

from mlops_serious_game.domain.graph import AutomationState, TechnicalGraph, trigger_for_automation


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


def _trigger_errors(e) -> list[str]:
    """Automation state and trigger must agree: who starts the work is part of what `automated`
    means."""
    errors = []
    expected = trigger_for_automation(e, e.initial_automation, e.initial_trigger)
    if e.initial_trigger != expected:
        errors.append(
            f"edge '{e.id}' starts at automation {e.initial_automation} with trigger "
            f"'{e.initial_trigger}', expected '{expected}'"
        )
    if any(lv >= AutomationState.AUTOMATED for lv in e.allowed_automation) and e.default_automatic_trigger is None:
        errors.append(f"edge '{e.id}' can be automated but allows no automatic trigger")
    if AutomationState.MANUAL in e.allowed_automation and "manual_request" not in e.allowed_triggers:
        errors.append(f"edge '{e.id}' can be manual but does not allow 'manual_request'")
    if any(lv <= AutomationState.ABSENT for lv in e.allowed_automation) and "none" not in e.allowed_triggers:
        errors.append(f"edge '{e.id}' can be absent but does not allow trigger 'none'")
    return errors


def _option_errors(kind: str, target_id: str, axis: str, allowed: list[int], options) -> list[str]:
    errors = []
    covered = set()
    for opt in options:
        if opt.to_level == AutomationState.BROKEN and axis == "automation":
            errors.append(f"{kind} '{target_id}' has an automation option targeting broken - players can never do that")
        if opt.to_level == AutomationState.ABSENT and axis == "automation":
            errors.append(
                f"{kind} '{target_id}' has an automation option targeting absent - broken and absent are both "
                "resting states a player recovers past in one step, straight to manual"
            )
        if opt.to_level not in allowed:
            errors.append(f"{kind} '{target_id}' has a {axis} option targeting disallowed level {opt.to_level}")
        covered.add(opt.to_level)
    if not options:
        return errors  # not authored yet - a gap to fill in later, not a config error
    # Every rung above the resting state needs an option once any are authored at all. Automation's
    # resting states are BROKEN and ABSENT (nothing built yet, or backend-only failure, 00-plan.md
    # decision 5) - options start at MANUAL. Governance's only resting state is NONE.
    floor = AutomationState.ABSENT if axis == "automation" else 0
    reachable = {lv for lv in allowed if lv > floor}
    missing = reachable - covered
    if missing:
        errors.append(f"{kind} '{target_id}' has no {axis} option reaching {sorted(missing)}")
    return errors


def validate_graph(graph: TechnicalGraph) -> list[str]:
    """Returns the topological order of components over pipeline edges. Raises on any config error."""
    errors: list[str] = []
    automation_range = set(range(len(graph.automation_states)))
    governance_range = set(range(len(graph.governance_levels)))

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
        if not set(c.allowed_automation) <= automation_range or not c.allowed_automation:
            errors.append(f"component '{c.id}' has invalid allowed_automation {c.allowed_automation}")
        if not set(c.allowed_governance) <= governance_range or not c.allowed_governance:
            errors.append(f"component '{c.id}' has invalid allowed_governance {c.allowed_governance}")
        if c.initial_automation not in c.allowed_automation:
            errors.append(f"component '{c.id}' initial_automation {c.initial_automation} not allowed")
        if c.initial_governance not in c.allowed_governance:
            errors.append(f"component '{c.id}' initial_governance {c.initial_governance} not allowed")
        if not (c.owner_role or graph.stage(c.stage_id).owner_role):
            errors.append(f"component '{c.id}' has no owner and its stage has none either")
        errors += _option_errors("component", c.id, "automation", c.allowed_automation, c.automation_options)
        errors += _option_errors("component", c.id, "governance", c.allowed_governance, c.governance_options)

    for e in graph.edges:
        for end in (e.from_id, e.to_id):
            if not graph.is_component(end):
                errors.append(f"edge '{e.id}' references unknown component '{end}'")
        if not set(e.allowed_automation) <= automation_range or not e.allowed_automation:
            errors.append(f"edge '{e.id}' has invalid allowed_automation {e.allowed_automation}")
        if not set(e.allowed_governance) <= governance_range or not e.allowed_governance:
            errors.append(f"edge '{e.id}' has invalid allowed_governance {e.allowed_governance}")
        if e.initial_automation not in e.allowed_automation:
            errors.append(f"edge '{e.id}' initial_automation {e.initial_automation} not allowed")
        if e.initial_governance not in e.allowed_governance:
            errors.append(f"edge '{e.id}' initial_governance {e.initial_governance} not allowed")
        unknown_triggers = set(e.allowed_triggers) - set(graph.triggers)
        if unknown_triggers:
            errors.append(f"edge '{e.id}' allows unknown triggers {sorted(unknown_triggers)}")
        if e.initial_trigger not in e.allowed_triggers:
            errors.append(f"edge '{e.id}' initial_trigger '{e.initial_trigger}' not allowed")

        errors += _trigger_errors(e)
        errors += _option_errors("edge", e.id, "automation", e.allowed_automation, e.automation_options)
        errors += _option_errors("edge", e.id, "governance", e.allowed_governance, e.governance_options)
        for opt in e.automation_options:
            if opt.trigger is not None and opt.trigger not in e.allowed_triggers:
                errors.append(f"edge '{e.id}' automation option '{opt.name}' names disallowed trigger '{opt.trigger}'")

    ids = [i.id for i in graph.initial_instances]
    if len(ids) != len(set(ids)):
        errors.append("duplicate initial instance ids")
    for inst in graph.initial_instances:
        errors += graph.instance_errors(inst)
        errors += [f"instance '{inst.id}' links to unknown instance '{x}'" for x in inst.links if x not in ids]

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
