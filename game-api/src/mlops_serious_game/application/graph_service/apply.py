"""Applying ops to the graph, and replaying the op log into ground truth plus player knowledge.

Everything here is pure. Owner degradation is resolved once, when an action card is applied,
and the resolved op (with its `intended` level) is what gets logged. Replay therefore never
needs buy-in values and always reproduces the same state.
"""

from typing import Iterable, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.application.graph_service.effective import EffectiveView, compute_effective
from mlops_serious_game.domain.graph import (
    DebtEntry,
    GraphOp,
    GraphState,
    Instance,
    Knowledge,
    Level,
    LoggedOp,
    NON_AUTOMATIC_TRIGGERS,
    SeenEntry,
    TechnicalGraph,
    trigger_for_level,
)


class RejectedOp(BaseModel):
    op: GraphOp
    reason: str


class ApplyResult(BaseModel):
    state: GraphState
    resolved_ops: list[GraphOp] = Field(default_factory=list, description="What to persist")
    debt_created: list[DebtEntry] = Field(default_factory=list)
    debt_cleared: list[DebtEntry] = Field(default_factory=list)
    rejected: list[RejectedOp] = Field(default_factory=list)


def snap_down(level: int, allowed: list[int]) -> int:
    """Nearest allowed level at or below `level`, or the lowest allowed one."""
    below = [a for a in allowed if a <= level]
    return max(below) if below else min(allowed)


def _level_below(level: int, allowed: list[int]) -> Optional[int]:
    below = [a for a in allowed if a < level]
    return max(below) if below else None


def resolve_degradation(
    graph: TechnicalGraph, state: GraphState, op: GraphOp, owner_buyin: Optional[dict[str, float]]
) -> GraphOp:
    """An unhappy owner makes an action card raise land one allowed level lower.

    Returns the op to apply and log, carrying `intended` when degraded.
    """
    if owner_buyin is None or op.kind != "raise_to" or op.source_kind != "action_card":
        return op
    if not graph.is_target(op.target):
        return op
    owner = graph.owner_of(op.target)
    if owner_buyin.get(owner, 1.0) >= graph.thresholds.debt_buyin_threshold:
        return op

    allowed = graph.allowed_levels(op.target)
    intended = snap_down(int(op.value), allowed)
    current = state.level(op.target)
    if current == Level.BROKEN:
        applied = Level.BROKEN  # a degraded repair of something broken stays broken
    else:
        applied = _level_below(intended, allowed)
        if applied is None:
            return op
    return op.model_copy(update={"value": int(applied), "intended": intended})


def _mark(state: GraphState, target: str, seq: Optional[int]) -> None:
    if seq is not None:
        state.changed_at[target] = seq


def _sync_trigger(graph: TechnicalGraph, state: GraphState, edge_id: str, seq: Optional[int]) -> None:
    edge = graph.edge(edge_id)
    current = state.edge_triggers.get(edge_id)
    expected = trigger_for_level(edge, state.edge_levels[edge_id], current)
    if expected is not None and expected != current:
        state.edge_triggers[edge_id] = expected
        _mark(state, edge_id, seq)


def _resolve_target(graph: TechnicalGraph, op: GraphOp) -> Optional[GraphOp]:
    """Maps renamed ids to their current id. Returns None for ops on retired ids."""
    target = graph.resolve(op.target)
    if graph.is_retired(target):
        return None
    return op if target == op.target else op.model_copy(update={"target": target})


def _apply_one(
    graph: TechnicalGraph, state: GraphState, op: GraphOp, seq: Optional[int], result: ApplyResult
) -> None:
    kind = op.kind
    if kind == "observe":
        return
    if kind not in ("instance_upsert", "set_instance_prop"):
        op = _resolve_target(graph, op)
        if op is None:
            return

    if kind in ("raise_to", "set_to"):
        if not graph.is_target(op.target):
            result.rejected.append(RejectedOp(op=op, reason="unknown target"))
            return
        allowed = graph.allowed_levels(op.target)
        levels = state.component_levels if graph.is_component(op.target) else state.edge_levels
        current = levels[op.target]
        requested = snap_down(int(op.value), allowed)
        new = max(current, requested) if kind == "raise_to" else requested
        if new != current:
            levels[op.target] = new
            _mark(state, op.target, seq)
        if graph.is_edge(op.target):
            _sync_trigger(graph, state, op.target, seq)

        intended = op.intended
        if intended is not None and intended > new:
            entry = DebtEntry(
                target_id=op.target,
                intended_level=intended,
                applied_level=new,
                owner_id=graph.owner_of(op.target),
                source_id=op.source_id,
            )
            state.debt.append(entry)
            result.debt_created.append(entry)
        elif kind == "raise_to" and op.source_kind == "action_card" and intended is None:
            # A clean raise with a happy owner pays down debt it reaches.
            keep = []
            for d in state.debt:
                if d.target_id == op.target and new >= d.intended_level:
                    result.debt_cleared.append(d)
                else:
                    keep.append(d)
            state.debt = keep
        return

    if kind == "set_trigger":
        if not graph.is_edge(op.target):
            result.rejected.append(RejectedOp(op=op, reason="unknown edge"))
            return
        edge = graph.edge(op.target)
        if op.value not in edge.allowed_triggers:
            result.rejected.append(RejectedOp(op=op, reason=f"trigger '{op.value}' not allowed"))
            return
        level = state.edge_levels[op.target]
        if op.value in NON_AUTOMATIC_TRIGGERS:
            # Level and trigger must agree; demoting an edge is a level change, not a trigger change.
            if trigger_for_level(edge, level, None) != op.value:
                result.rejected.append(
                    RejectedOp(op=op, reason=f"trigger '{op.value}' does not fit level {level}, change the level")
                )
            return
        if level < Level.AUTOMATED:
            # Naming an automatic trigger automates the edge.
            automated = [lv for lv in edge.allowed_levels if lv >= Level.AUTOMATED]
            if not automated:
                result.rejected.append(RejectedOp(op=op, reason="edge cannot be automated"))
                return
            state.edge_levels[op.target] = min(automated)
        if state.edge_triggers.get(op.target) != op.value or level < Level.AUTOMATED:
            state.edge_triggers[op.target] = op.value
            _mark(state, op.target, seq)
        return

    if kind == "set_attr":
        if not graph.is_component(op.target):
            result.rejected.append(RejectedOp(op=op, reason="unknown component"))
            return
        attr_def = graph.component(op.target).attributes.get(op.attr or "")
        if attr_def is None:
            result.rejected.append(RejectedOp(op=op, reason=f"unknown attribute '{op.attr}'"))
            return
        if op.value not in attr_def.values:
            result.rejected.append(RejectedOp(op=op, reason=f"value '{op.value}' not allowed for '{op.attr}'"))
            return
        attrs = state.attrs.setdefault(op.target, {})
        if attrs.get(op.attr) != op.value:
            attrs[op.attr] = op.value
            _mark(state, op.target, seq)
        return

    if kind == "instance_upsert":
        try:
            inst = Instance.model_validate(op.value)
        except Exception as e:
            result.rejected.append(RejectedOp(op=op, reason=f"invalid instance: {e}"))
            return
        errors = graph.instance_errors(inst)
        if errors:
            result.rejected.append(RejectedOp(op=op, reason="; ".join(errors)))
            return
        previous = state.instances.get(inst.id)
        merged_props = {**(previous.props if previous else {}), **inst.props}
        state.instances[inst.id] = graph.with_default_props(inst.model_copy(update={"props": merged_props}))
        _mark(state, inst.id, seq)
        return

    if kind == "set_instance_prop":
        inst = state.instances.get(op.target)
        if inst is None:
            result.rejected.append(RejectedOp(op=op, reason="unknown instance"))
            return
        prop = graph.instance_kinds[inst.kind].properties.get(op.attr or "")
        if prop is None or op.value not in prop.values:
            result.rejected.append(RejectedOp(op=op, reason=f"invalid property '{op.attr}' = '{op.value}'"))
            return
        if inst.props.get(op.attr) != op.value:
            inst.props[op.attr] = op.value
            _mark(state, inst.id, seq)
        return


def apply_ops(
    graph: TechnicalGraph,
    state: GraphState,
    ops: Iterable[GraphOp | LoggedOp],
    owner_buyin: Optional[dict[str, float]] = None,
) -> ApplyResult:
    """Applies ops to a copy of `state`. Pass `owner_buyin` only when resolving a fresh action card."""
    result = ApplyResult(state=state.model_copy(deep=True))
    for item in ops:
        seq, op = (item.seq, item.op) if isinstance(item, LoggedOp) else (None, item)
        if op.kind not in ("instance_upsert", "set_instance_prop"):
            op = _resolve_target(graph, op)
            if op is None:
                continue
        op = resolve_degradation(graph, result.state, op, owner_buyin)
        result.resolved_ops.append(op)
        _apply_one(graph, result.state, op, seq, result)
    return result


class Replay(BaseModel):
    state: GraphState
    knowledge: Knowledge
    rejected: list[RejectedOp] = Field(default_factory=list)


def _observe(state: GraphState, effective: EffectiveView, graph: TechnicalGraph, target: str, seq: int) -> SeenEntry:
    if graph.is_component(target):
        return SeenEntry(
            seq=seq,
            nominal=state.component_levels[target],
            effective=effective.components[target],
            attrs=dict(state.attrs.get(target, {})),
        )
    return SeenEntry(
        seq=seq,
        nominal=state.edge_levels[target],
        effective=effective.edges[target],
        trigger=state.edge_triggers.get(target),
    )


def replay(graph: TechnicalGraph, log: Iterable[LoggedOp]) -> Replay:
    """Folds the log into ground truth and player knowledge. Log must be in seq order."""
    state = GraphState.from_config(graph)
    knowledge = Knowledge()
    rejected: list[RejectedOp] = []
    effective: Optional[EffectiveView] = None

    for entry in log:
        op = entry.op
        if op.kind == "observe":
            op = _resolve_target(graph, op)
            if op is None:
                continue
            if not graph.is_target(op.target):
                rejected.append(RejectedOp(op=op, reason="unknown target"))
                continue
            if effective is None:
                effective = compute_effective(graph, state)
            knowledge.seen[op.target] = _observe(state, effective, graph, op.target, entry.seq)
            continue
        result = ApplyResult(state=state)
        _apply_one(graph, state, op, entry.seq, result)
        rejected.extend(result.rejected)
        effective = None

    return Replay(state=state, knowledge=knowledge, rejected=rejected)


def seed_ops(graph: TechnicalGraph) -> list[GraphOp]:
    """The starting graph, pinned into the log so later config edits do not rewrite history,
    followed by the handful of facts the briefing reveals."""
    ops: list[GraphOp] = []
    for c in graph.components:
        ops.append(GraphOp(kind="set_to", target=c.id, value=c.initial_level, source_kind="challenge_seed"))
        for name, attr in c.attributes.items():
            ops.append(GraphOp(kind="set_attr", target=c.id, attr=name, value=attr.initial, source_kind="challenge_seed"))
    for e in graph.edges:
        ops.append(GraphOp(kind="set_to", target=e.id, value=e.initial_level, source_kind="challenge_seed"))
        ops.append(GraphOp(kind="set_trigger", target=e.id, value=e.initial_trigger, source_kind="challenge_seed"))
    for inst in graph.initial_instances:
        ops.append(
            GraphOp(
                kind="instance_upsert",
                target=inst.id,
                value=graph.with_default_props(inst).model_dump(),
                source_kind="challenge_seed",
            )
        )
    for target in graph.briefing_observed:
        ops.append(GraphOp(kind="observe", target=target, source_kind="challenge_seed"))
    return ops
