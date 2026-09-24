"""Applying ops to the graph, and replaying the op log into ground truth plus player knowledge.

Everything here is pure. Owner degradation and the one-step-per-slot cap are resolved once, when
an action card is applied, and the resolved op (with its `intended` level) is what gets logged.
Replay therefore never needs buy-in values and always reproduces the same state.
"""

from typing import Any, Iterable, Optional, Sequence

from pydantic import BaseModel, Field

from mlops_serious_game.application.graph_service.effective import EffectiveView, compute_effective
from mlops_serious_game.domain.graph import (
    AutomationState,
    Axis,
    DebtEntry,
    GraphOp,
    GraphState,
    Instance,
    Knowledge,
    LoggedOp,
    NON_AUTOMATIC_TRIGGERS,
    SeenEntry,
    TechnicalGraph,
    trigger_for_automation,
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


def resolve_step_cap(graph: TechnicalGraph, state: GraphState, op: GraphOp) -> GraphOp:
    """Caps a player raise to one step on one axis, per
    docs/plans/graph-governance-automation-rework/00-plan.md §2.3 - one slot moves one step,
    never more, regardless of what the underlying content asks for."""
    if op.kind != "raise_to" or op.source_kind != "action_card":
        return op
    axis: Axis = op.axis
    allowed = graph.allowed_for(op.target, axis)
    current = state.value(op.target, axis)
    requested = snap_down(int(op.value), allowed)
    if requested <= current:
        return op
    next_rung = min(a for a in allowed if a > current)
    if next_rung >= requested:
        return op
    return op.model_copy(update={"value": next_rung})


def resolve_degradation(
    graph: TechnicalGraph, state: GraphState, op: GraphOp, owner_buyin: Optional[dict[str, float]]
) -> GraphOp:
    """An unhappy owner makes an action card raise land one allowed step lower, on whichever axis
    it targets. Returns the op to apply and log, carrying `intended` when degraded.
    """
    if owner_buyin is None or op.kind != "raise_to" or op.source_kind != "action_card":
        return op
    if not graph.is_target(op.target):
        return op
    owner = graph.owner_of(op.target)
    if owner_buyin.get(owner, 1.0) >= graph.thresholds.debt_buyin_threshold:
        return op

    axis: Axis = op.axis
    allowed = graph.allowed_for(op.target, axis)
    intended = snap_down(int(op.value), allowed)
    current = state.value(op.target, axis)
    if axis == "automation" and current == AutomationState.BROKEN:
        applied = AutomationState.BROKEN  # a degraded repair of something broken stays broken
    else:
        applied = _level_below(intended, allowed)
        if applied is None:
            return op
    return op.model_copy(update={"value": int(applied), "intended": intended})


NEGLECT_ALIGNMENT_THRESHOLD = -0.999  # "completely ignored": every one of their own items unmet


def pick_neglect_target(
    graph: TechnicalGraph, card_touches: Sequence[tuple[str, Axis]], reads: Sequence[Any]
) -> Optional[tuple[str, Axis, str]]:
    """A low-power/high-interest stakeholder who was completely ignored by this card quietly
    holds up one governance step - the "keep informed" quadrant's classic risk
    (docs/plans/graph-governance-automation-rework/02-neglected-stakeholder-sabotage.md). At most
    one stakeholder acts, on at most one governance-axis op; never one the owner already owns.
    Returns (target, axis, saboteur_stakeholder_id), or None if nothing qualifies.
    """
    eligible: list[tuple[float, str]] = []
    for r in reads:
        st_id = getattr(r, "stakeholder_id", None)
        if not st_id:
            continue
        if getattr(r, "power", "low") != "low" or getattr(r, "interest", "low") != "high":
            continue
        if getattr(r, "alignment", 1.0) > NEGLECT_ALIGNMENT_THRESHOLD:
            continue
        if any(graph.is_target(t) and graph.owner_of(t) == st_id for t, _ in card_touches):
            continue
        eligible.append((getattr(r, "alignment", 1.0), st_id))
    if not eligible:
        return None
    eligible.sort(key=lambda pair: (pair[0], pair[1]))  # most-neglected, then deterministic
    saboteur = eligible[0][1]

    governance_touches = [t for t in card_touches if t[1] == "governance"]
    if not governance_touches:
        return None
    target, axis = sorted(governance_touches)[0]
    return target, axis, saboteur


def resolve_neglect(graph: TechnicalGraph, op: GraphOp, neglect: Optional[tuple[str, Axis, str]]) -> GraphOp:
    """Applies the one sabotage `pick_neglect_target` chose, if this op is it and the owner
    mechanic hasn't already degraded it (never stack two degradations on one op)."""
    if neglect is None or op.kind != "raise_to" or op.source_kind != "action_card" or op.intended is not None:
        return op
    target, axis, saboteur = neglect
    if op.target != target or op.axis != axis:
        return op

    allowed = graph.allowed_for(op.target, axis)
    intended = snap_down(int(op.value), allowed)
    applied = _level_below(intended, allowed)
    if applied is None:
        return op
    return op.model_copy(update={"value": int(applied), "intended": intended, "degraded_by": saboteur})


def _mark(state: GraphState, target: str, seq: Optional[int]) -> None:
    if seq is not None:
        state.changed_at[target] = seq


def _sync_trigger(graph: TechnicalGraph, state: GraphState, edge_id: str, seq: Optional[int]) -> None:
    edge = graph.edge(edge_id)
    current = state.edge_triggers.get(edge_id)
    expected = trigger_for_automation(edge, state.edge_automation[edge_id], current)
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
        axis: Axis = op.axis
        level = int(op.value)
        if kind == "set_to" and op.source_kind == "action_card" and axis == "automation" and level == AutomationState.BROKEN:
            # Players can never set a target to broken (00-plan.md decision 5) - only world
            # events/challenges/admin may. raise_to can't reach this case: it only ever raises,
            # and broken is the floor, so this guard only matters for a (today unused) action-card
            # set_to - defense in depth against a mis-authored future option.
            result.rejected.append(RejectedOp(op=op, reason="players cannot set a target to broken"))
            return
        allowed = graph.allowed_for(op.target, axis)
        state_dict = state.axis_dict(op.target, axis)
        current = state_dict[op.target]
        requested = snap_down(level, allowed)
        new = max(current, requested) if kind == "raise_to" else requested
        if new != current:
            state_dict[op.target] = new
            _mark(state, op.target, seq)
        if axis == "automation" and graph.is_edge(op.target):
            _sync_trigger(graph, state, op.target, seq)

        intended = op.intended
        if intended is not None and intended > new:
            entry = DebtEntry(
                target_id=op.target,
                intended_level=intended,
                applied_level=new,
                axis=axis,
                owner_id=op.degraded_by or graph.owner_of(op.target),
                source_id=op.source_id,
            )
            state.debt.append(entry)
            result.debt_created.append(entry)
        elif kind == "raise_to" and op.source_kind == "action_card" and intended is None:
            # A clean raise with a happy owner pays down debt it reaches, on the same axis.
            keep = []
            for d in state.debt:
                if d.target_id == op.target and d.axis == axis and new >= d.intended_level:
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
        automation = state.edge_automation[op.target]
        if op.value in NON_AUTOMATIC_TRIGGERS:
            # Automation and trigger must agree; demoting an edge is an automation change, not a
            # trigger change.
            if trigger_for_automation(edge, automation, None) != op.value:
                result.rejected.append(
                    RejectedOp(
                        op=op,
                        reason=f"trigger '{op.value}' does not fit automation state {automation}, change that instead",
                    )
                )
            return
        if automation < AutomationState.AUTOMATED:
            # Naming an automatic trigger automates the edge.
            automated = [lv for lv in graph.allowed_automation(op.target) if lv >= AutomationState.AUTOMATED]
            if not automated:
                result.rejected.append(RejectedOp(op=op, reason="edge cannot be automated"))
                return
            state.edge_automation[op.target] = min(automated)
        if state.edge_triggers.get(op.target) != op.value or automation < AutomationState.AUTOMATED:
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
    neglect: Optional[tuple[str, Axis, str]] = None,
) -> ApplyResult:
    """Applies ops to a copy of `state`. Pass `owner_buyin` (and, for a fresh action card,
    `neglect` from `pick_neglect_target`) only when resolving a fresh action card."""
    result = ApplyResult(state=state.model_copy(deep=True))
    for item in ops:
        seq, op = (item.seq, item.op) if isinstance(item, LoggedOp) else (None, item)
        if op.kind not in ("instance_upsert", "set_instance_prop"):
            op = _resolve_target(graph, op)
            if op is None:
                continue
        op = resolve_step_cap(graph, result.state, op)
        op = resolve_degradation(graph, result.state, op, owner_buyin)
        op = resolve_neglect(graph, op, neglect)
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
            nominal_automation=state.component_automation[target],
            nominal_governance=state.component_governance[target],
            effective_automation=effective.automation[target],
            effective_governance=effective.governance[target],
            attrs=dict(state.attrs.get(target, {})),
        )
    return SeenEntry(
        seq=seq,
        nominal_automation=state.edge_automation[target],
        nominal_governance=state.edge_governance[target],
        effective_automation=effective.automation[target],
        effective_governance=effective.governance[target],
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
        ops.append(GraphOp(kind="set_to", target=c.id, axis="automation", value=c.initial_automation, source_kind="challenge_seed"))
        ops.append(GraphOp(kind="set_to", target=c.id, axis="governance", value=c.initial_governance, source_kind="challenge_seed"))
        for name, attr in c.attributes.items():
            ops.append(GraphOp(kind="set_attr", target=c.id, attr=name, value=attr.initial, source_kind="challenge_seed"))
    for e in graph.edges:
        ops.append(GraphOp(kind="set_to", target=e.id, axis="automation", value=e.initial_automation, source_kind="challenge_seed"))
        ops.append(GraphOp(kind="set_to", target=e.id, axis="governance", value=e.initial_governance, source_kind="challenge_seed"))
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
