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
    SeenEntry,
    TechnicalGraph,
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


def _apply_one(
    graph: TechnicalGraph, state: GraphState, op: GraphOp, seq: Optional[int], result: ApplyResult
) -> None:
    kind = op.kind
    if kind == "observe":
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
        if op.value not in graph.edge(op.target).allowed_triggers:
            result.rejected.append(RejectedOp(op=op, reason=f"trigger '{op.value}' not allowed"))
            return
        if state.edge_triggers.get(op.target) != op.value:
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
        if inst.kind not in graph.instance_kinds or inst.state not in graph.instance_states:
            result.rejected.append(RejectedOp(op=op, reason="unknown instance kind or state"))
            return
        if not graph.is_component(inst.component_id):
            result.rejected.append(RejectedOp(op=op, reason="instance on unknown component"))
            return
        state.instances[inst.id] = inst
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
    for target in graph.briefing_observed:
        ops.append(GraphOp(kind="observe", target=target, source_kind="challenge_seed"))
    return ops
