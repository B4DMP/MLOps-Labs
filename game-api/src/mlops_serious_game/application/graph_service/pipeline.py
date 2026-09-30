"""Simulation phase: the 13 steps that run after COMMIT (plan 07).

```
1.  before          state with effective levels and active patterns
2.  owner_buyin     buy-in of each component owner, from COMMIT
3.  card ops        union of the ops of every slotted stance item
4.  after, debt     apply the card, unhappy owners degrade what they own
5.  effective       recompute, remember what capped what
6.  world events    on_exit_ops of the challenge plus the consequences of active antipatterns
7.  after           apply the world events
8.  patterns        recompute and diff against before
9.  grudges         fire the friction scheduled earlier
10. metrics         weighted sum of effective level deltas
11. persist         ops and snapshot
12. next challenge  left to the caller (plan 07 step 9)
```

`simulate` is pure: same inputs, same report, no database and no LLM (standing rule). Only
`run_simulation` touches the store.
"""

from typing import Any, Iterable, Optional, Sequence

from pydantic import BaseModel, Field

from mlops_serious_game.application.graph_service.apply import ApplyResult, apply_ops, pick_neglect_target
from mlops_serious_game.application.graph_service.scheduler import stable_rank
from mlops_serious_game.application.graph_service.view import GraphEvaluation, evaluate_graph
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.graph import Axis, DebtEntry, GraphOp, GraphState, TechnicalGraph
from mlops_serious_game.domain.grudge import (
    GRUDGE_EFFECTS,
    GRUDGE_LIFETIME,
    FiredGrudge,
    Grudge,
    PendingObjection,
)
from mlops_serious_game.domain.pattern import Pattern, PatternFactory

PASS = "PASS"
SOFT_PASS = "SOFT_PASS"
VETO_BROKEN = "VETO_BROKEN"
STALEMATE = "STALEMATE"
CONCEDED = "CONCEDED"

# Outcomes where the player's own card never goes in: on STALEMATE nothing was agreed, on
# CONCEDED the card was dropped in favour of the opposing position (D41) — that op is applied
# directly by the caller (pitch_handler.handle_pitch_concede), not through this pipeline's card_ops.
NO_CARD_OUTCOMES = (STALEMATE, CONCEDED)


class LevelPair(BaseModel):
    before: int
    after: int


class TargetDelta(BaseModel):
    id: str
    axis: Axis
    name: str = ""
    stage: str
    nominal: LevelPair
    effective: LevelPair
    capped_by: Optional[dict] = Field(default=None, description="{id, level} of the binding constraint")
    degraded_by: Optional[str] = Field(default=None, description="Owner who made the raise land lower")
    owner_id: Optional[str] = None
    owner_name: Optional[str] = None
    status: str = "flawless"  # "flawless", "capped", "delayed", "degraded"
    story: str = ""
    icon: Optional[str] = Field(default=None, description="Iconify icon name, same as the graph node's own")


class WorldEventDelta(BaseModel):
    target: str
    axis: Axis
    name: str = ""
    before: int
    after: int
    reason: str = ""
    icon: Optional[str] = Field(default=None, description="Iconify icon name, same as the graph node's own")


class Propagation(BaseModel):
    """A target nobody touched whose effective automation moved because something upstream did.
    Automation-only: governance never caps and so never propagates (00-plan.md decision 1)."""

    target: str
    name: str = ""
    effective: LevelPair
    via: Optional[str] = None
    icon: Optional[str] = Field(default=None, description="Iconify icon name, same as the graph node's own")


class PatternDiff(BaseModel):
    gained: list[str] = Field(default_factory=list)
    lost: list[str] = Field(default_factory=list)
    anti_created: list[str] = Field(default_factory=list)
    anti_resolved: list[str] = Field(default_factory=list)


class GrudgeReport(BaseModel):
    created: list[Grudge] = Field(default_factory=list)
    fired: list[FiredGrudge] = Field(default_factory=list)


class StakeholderExecutionDelta(BaseModel):
    stakeholder_id: str
    name: str = ""
    power: str = "low"
    interest: str = "low"
    status: str = "committed"  # "committed", "resistant", "overridden"
    delivery_sentiment: Optional[str] = None  # "clean_delivery", "capped_delivery", "technical_debt"
    emotion_deltas: dict[str, float] = Field(default_factory=dict)
    story: str = ""


class DeltaReport(BaseModel):
    outcome: str
    targets: list[TargetDelta] = Field(default_factory=list)
    debt_created: list[DebtEntry] = Field(default_factory=list)
    debt_cleared: list[DebtEntry] = Field(default_factory=list)
    world_events: list[WorldEventDelta] = Field(default_factory=list)
    propagated: list[Propagation] = Field(default_factory=list)
    stage_health: dict[str, LevelPair] = Field(default_factory=dict)
    system_health: LevelPair
    patterns: PatternDiff = Field(default_factory=PatternDiff)
    grudges: GrudgeReport = Field(default_factory=GrudgeReport)
    metric_deltas: dict[str, int] = Field(default_factory=dict)
    stakeholders: list[StakeholderExecutionDelta] = Field(default_factory=list)


class SimulationResult(BaseModel):
    report: DeltaReport
    state: GraphState
    ops: list[GraphOp] = Field(default_factory=list, description="What to append to the log, in order")
    grudges: list[Grudge] = Field(default_factory=list, description="The grudge list after ageing and firing")
    pending_objections: list[PendingObjection] = Field(default_factory=list)
    events: list[GameEvent] = Field(default_factory=list, description="The event log's record of this run (plan 11)")


# ---------------------------------------------------------------------------
# Step 2: owners
# ---------------------------------------------------------------------------

def owner_buyin_from_reads(reads: Sequence[Any]) -> dict[str, float]:
    """Buy-in per stakeholder id, as `apply_ops` wants it for owner degradation.

    Anyone not in the room is not unhappy: `apply.resolve_degradation` defaults them to 1.0.
    """
    return {r.stakeholder_id: float(r.buy_in) for r in reads if getattr(r, "stakeholder_id", None)}


def owners_of(graph: TechnicalGraph, targets: Iterable[str]) -> dict[str, Optional[str]]:
    """Owner per target: the component's own owner, else the owner of its stage (D: owner_role null)."""
    return {t: graph.owner_of(t) for t in targets if graph.is_target(t)}


# ---------------------------------------------------------------------------
# Step 6: world events
# ---------------------------------------------------------------------------

def _ops_from_raw(raw_ops: Iterable[dict], source_id: str, reason: Optional[str] = None) -> list[GraphOp]:
    ops: list[GraphOp] = []
    for raw in raw_ops or []:
        data = {**raw, "source_kind": "world_event", "source_id": source_id}
        if reason and not data.get("reason"):
            data["reason"] = reason
        ops.append(GraphOp.model_validate(data))
    return ops


def consequence_ops(active: Sequence[str], patterns: Sequence[Pattern]) -> list[GraphOp]:
    """What the antipatterns still standing after the card do to the world this round.

    Read on the post-card graph on purpose: an antipattern the card resolved does not get a
    parting shot.
    """
    by_id = {p.id: p for p in patterns}
    ops: list[GraphOp] = []
    for pid in active:
        pattern = by_id.get(pid)
        if pattern is None or pattern.kind != "anti":
            continue
        ops += _ops_from_raw(pattern.consequence_ops, f"pattern:{pid}", pattern.name)
    return ops


def veto_degradation_ops(
    graph: TechnicalGraph, state: GraphState, stakeholder_id: str, card_touches: Sequence[tuple[str, Axis]]
) -> list[GraphOp]:
    """A Veto Breaker costs the overridden stakeholder one step on whatever axis this card itself
    touched that they own (D-question 2): components and edges alike ("hybrid" - `owner_of` is
    edge-aware), but scoped to `card_touches` only, never their whole area and never anything
    up/downstream the card didn't touch. Already-lowest targets are left alone, so the punishment
    cannot be repeated into rubble by pressing the same button twice.
    """
    ops: list[GraphOp] = []
    for target, axis in card_touches:
        if graph.owner_of(target) != stakeholder_id:
            continue
        current = state.value(target, axis)
        below = [lv for lv in graph.allowed_for(target, axis) if lv < current]
        if not below:
            continue
        ops.append(GraphOp(
            kind="set_to",
            target=target,
            axis=axis,
            value=max(below),
            source_kind="world_event",
            source_id=f"veto_broken:{stakeholder_id}",
            reason=f"{stakeholder_id} was overridden and stopped covering this",
        ))
    return ops


# ---------------------------------------------------------------------------
# Step 9: grudges
# ---------------------------------------------------------------------------

def _grudge_effect(grudge: Grudge, seed: str) -> str:
    """Deterministic by owner and age, so the same game always produces the same friction."""
    return GRUDGE_EFFECTS[stable_rank(seed, f"{grudge.stakeholder_id}|{grudge.age}") % len(GRUDGE_EFFECTS)]


def _degrade_target(graph: TechnicalGraph, state: GraphState, stakeholder_id: str) -> Optional[tuple[str, Axis]]:
    """The best thing the stakeholder owns, on whichever axis stands highest: the higher it
    stands, the more the slip is felt."""
    owned = [
        (state.value(c.id, axis), c.id, axis)
        for c in graph.components
        if graph.owner_of(c.id) == stakeholder_id
        for axis in ("automation", "governance")
        if any(lv < state.value(c.id, axis) for lv in graph.allowed_for(c.id, axis))
    ]
    if not owned:
        return None
    level, target, axis = max(owned, key=lambda t: (t[0], t[1], t[2]))
    return target, axis


def fire_grudges(
    graph: TechnicalGraph,
    state: GraphState,
    grudges: Sequence[Grudge],
    seed: str,
    upcoming_world_events: Sequence[GraphOp] = (),
) -> tuple[list[GraphOp], list[FiredGrudge], list[PendingObjection], list[Grudge]]:
    """Every grudge picks one effect, ages, and is spent after `GRUDGE_LIFETIME` firings."""
    ops: list[GraphOp] = []
    fired: list[FiredGrudge] = []
    pending: list[PendingObjection] = []
    kept: list[Grudge] = []
    brought_forward = list(upcoming_world_events)
    working = state

    for grudge in grudges:
        effect = _grudge_effect(grudge, seed)
        record = FiredGrudge(
            stakeholder_id=grudge.stakeholder_id, effect=effect, weight=grudge.weight, age=grudge.age
        )
        if effect == "world_event" and not brought_forward:
            # Nothing scheduled to pull forward, so the friction lands on their own area instead.
            effect = "degrade"
            record.effect = "degrade"

        new_ops: list[GraphOp] = []
        if effect == "degrade":
            picked = _degrade_target(graph, working, grudge.stakeholder_id)
            if picked is not None:
                target, axis = picked
                allowed = graph.allowed_for(target, axis)
                level = working.value(target, axis)
                for _ in range(grudge.weight):
                    below = [lv for lv in allowed if lv < level]
                    if not below:
                        break
                    level = max(below)
                new_ops.append(GraphOp(
                    kind="set_to", target=target, axis=axis, value=level, source_kind="world_event",
                    source_id=f"grudge:{grudge.stakeholder_id}",
                    reason=f"{grudge.stakeholder_id} stopped going out of their way here",
                ))
                record.target = target
                record.detail = f"dropped to level {level}"
        elif effect == "world_event":
            taken = brought_forward[: grudge.weight]
            brought_forward = brought_forward[grudge.weight:]
            new_ops += [op.model_copy(update={
                "source_kind": "world_event",
                "source_id": f"grudge:{grudge.stakeholder_id}",
                "reason": op.reason or f"{grudge.stakeholder_id} let this come early",
            }) for op in taken]
            record.target = taken[0].target if taken else None
            record.detail = "brought forward"
        else:
            pending.append(PendingObjection(stakeholder_id=grudge.stakeholder_id, patience_malus=grudge.weight))
            record.detail = f"one more objection next pitch, at patience minus {grudge.weight}"

        if new_ops:
            working = apply_ops(graph, working, new_ops).state
            ops += new_ops
        fired.append(record)
        aged = grudge.model_copy(update={"age": grudge.age + 1})
        if aged.age < GRUDGE_LIFETIME:
            kept.append(aged)

    return ops, fired, pending, kept


def grudges_created(
    outcome: str,
    reads: Sequence[Any],
    challenge_template: Optional[str],
    overridden_stakeholder_id: Optional[str] = None,
) -> list[Grudge]:
    """Who walks away owing the player one, per outcome branch (plan 07)."""
    from mlops_serious_game.application.pitch_debate_service.scoring import OBJECTION_THRESHOLD

    if outcome == STALEMATE:
        return [
            Grudge(stakeholder_id=r.stakeholder_id, reason="the room never agreed", created_in=challenge_template)
            for r in reads
        ]
    if outcome == VETO_BROKEN:
        if not overridden_stakeholder_id:
            return []
        return [Grudge(
            stakeholder_id=overridden_stakeholder_id, weight=2,
            reason="overridden by an escalation", created_in=challenge_template,
        )]
    if outcome == SOFT_PASS:
        return [
            Grudge(stakeholder_id=r.stakeholder_id, reason="passed over", created_in=challenge_template)
            for r in reads
            if r.power == "low" and (getattr(r, "boundary_violated", False) or r.buy_in < OBJECTION_THRESHOLD)
        ]
    return []


def _stakeholder_execution(
    reads: Sequence[Any],
    outcome: str,
    overridden_stakeholder_id: Optional[str] = None,
    names: Optional[dict[str, str]] = None,
) -> list[StakeholderExecutionDelta]:
    from mlops_serious_game.application.pitch_debate_service.scoring import OBJECTION_THRESHOLD

    names = names or {}
    results: list[StakeholderExecutionDelta] = []
    for r in reads:
        st_id = getattr(r, "stakeholder_id", None)
        if not st_id:
            continue
        power = getattr(r, "power", "low")
        interest = getattr(r, "interest", "low")
        is_overridden = outcome == VETO_BROKEN and st_id == overridden_stakeholder_id
        is_resistant = power == "low" and (getattr(r, "boundary_violated", False) or getattr(r, "buy_in", 1.0) < OBJECTION_THRESHOLD)

        status = "overridden" if is_overridden else ("resistant" if is_resistant else "committed")

        story = ""
        if status == "committed":
            story = "Fully backed the proposal and completed all assigned implementation work flawlessly."
        elif status == "resistant":
            story = "Disagreed with the proposal and lacked commitment, causing delays, missing metadata, or partial implementation shortcuts."
        elif status == "overridden":
            story = "Overruled by an escalation. Backed down reluctantly, reducing support on owned systems."

        results.append(
            StakeholderExecutionDelta(
                stakeholder_id=st_id,
                # "" (not st_id) on a miss - `names` is empty on the production call path, and an
                # empty name lets the frontend's own `st.name || stCtx.name` chain fall through to
                # its `stakeholders` context, which always has the real display name. Falling back
                # to the raw id here would be truthy and short-circuit that lookup, showing e.g.
                # "requirements_reuben" instead of "Requirements Reuben".
                name=names.get(st_id, ""),
                power=power,
                interest=interest,
                status=status,
                story=story,
            )
        )
    return results


# ---------------------------------------------------------------------------
# Step 10: metrics
# ---------------------------------------------------------------------------

def metric_deltas(
    before: GraphEvaluation, after: GraphEvaluation, metrics: Optional[Sequence[Any]] = None
) -> dict[str, int]:
    """Weighted sum of effective level deltas per metric. No LLM anywhere near a score."""
    if metrics is None:
        from mlops_serious_game.domain.metric_factory import MetricFactory

        metrics = MetricFactory.metrics
    deltas: dict[str, int] = {}
    for metric in metrics:
        weights = getattr(metric, "component_weights", None) or {}
        total = 0.0
        for target, weight in weights.items():
            was = _effective(before, target)
            now = _effective(after, target)
            if was is None or now is None:
                continue
            total += weight * (now - was)
        if total:
            deltas[metric.id] = int(round(total))
    return deltas


def _effective(evaluation: GraphEvaluation, target: str) -> Optional[int]:
    """Effective automation - metrics and capping both read this axis only (00-plan.md decision
    1: governance never caps, so "effective" for scoring purposes is always automation)."""
    return evaluation.effective.automation.get(target)


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------

def _capped_by(graph: TechnicalGraph, evaluation: GraphEvaluation, target: str, axis: Axis) -> Optional[dict]:
    if axis != "automation":
        return None  # only automation is ever capped (00-plan.md decision 1)
    why = evaluation.effective.capped_by.get(target)
    if why is None or not graph.is_target(why):
        return None
    return {"id": why, "level": _effective(evaluation, why)}


def _prettify_target_id(target: str) -> str:
    """"e.risk_acceptance" -> "Risk Acceptance". Fallback display for a target with no curated
    name (the `Edge` model has none - only components carry one) - same "last id segment,
    underscores to spaces" idiom the frontend's own `formatComponentId` uses, title-cased to
    match how curated component names are written in MlopsGraph.json (e.g. "Acceptance Criteria")
    so a fallen-back edge name doesn't read as visibly lesser than a curated one."""
    tail = target.rsplit(".", 1)[-1]
    return tail.replace("_", " ").title()


def _target_display(graph: TechnicalGraph, target: str) -> tuple[str, Optional[str]]:
    """Name and icon for any report target (component or edge) - same source the SVG canvas
    itself reads (`icon` on the component, from MlopsGraph.json), so a target mentioned in the
    Component Implementation Log or the Ripple Effects list reads as the same thing either way.
    Edges have no icon of their own."""
    if graph.is_component(target):
        component = graph.component(target)
        return component.name, component.icon
    return getattr(graph.edge(target), "name", None) or _prettify_target_id(target), None


def _story(graph: TechnicalGraph, state: GraphState, target: str) -> str:
    from mlops_serious_game.application.graph_service.story import story_for

    try:
        return story_for(graph, state, target)
    except (KeyError, IndexError, AttributeError):
        return ""  # story fragments are content, a missing one must not break a simulation


def _target_deltas(
    graph: TechnicalGraph,
    touches: Iterable[tuple[str, Axis]],
    before_state: GraphState,
    after_state: GraphState,
    before: GraphEvaluation,
    after: GraphEvaluation,
    degraded_by: dict[tuple[str, Axis], Optional[str]],
    debt_created: Optional[Sequence[Any]] = None,
    names: Optional[dict[str, str]] = None,
) -> list[TargetDelta]:
    names = names or {}
    debt_touches = {
        (d.target_id, d.axis) for d in (debt_created or []) if getattr(d, "target_id", None)
    }
    deltas: list[TargetDelta] = []
    for target, axis in touches:
        if not graph.is_target(target):
            continue
        capped = _capped_by(graph, after, target, axis)
        degraded = degraded_by.get((target, axis))
        owner_id = graph.owner_of(target)
        # None (not owner_id) on a miss - `names` is empty in the production call path (nothing
        # currently threads a stakeholder id -> display name map through), and the frontend's own
        # `stakeholders` context always has the real name for every owner role; falling back to
        # the raw id here would keep that lookup from ever running and show e.g.
        # "automation_alex" instead of "Automation Alex".
        owner_name = names.get(owner_id) if owner_id else None

        if degraded:
            status = "degraded"
        elif capped:
            status = "capped"
        elif (target, axis) in debt_touches:
            status = "delayed"
        else:
            status = "flawless"

        target_name, target_icon = _target_display(graph, target)

        deltas.append(TargetDelta(
            id=target,
            axis=axis,
            name=target_name,
            # Display name ("Requirements", "Modeling"), not `stage_of`'s raw stage id ("req",
            # "model") - that id is only a lookup key elsewhere (`stage_health` is keyed by it),
            # but here it renders straight into the row's stage tag.
            stage=graph.stage(graph.stage_of(target)).name,
            nominal=LevelPair(before=before_state.value(target, axis), after=after_state.value(target, axis)),
            effective=LevelPair(
                before=before.effective.value(target, axis), after=after.effective.value(target, axis)
            ),
            capped_by=capped,
            degraded_by=degraded,
            owner_id=owner_id,
            owner_name=owner_name,
            status=status,
            story=_story(graph, after_state, target),
            icon=target_icon,
        ))
    return deltas


def _propagated(
    graph: TechnicalGraph, touched: set[str], before: GraphEvaluation, after: GraphEvaluation
) -> list[Propagation]:
    """Everything the player did not touch that moved anyway. This is what makes capping fair.
    Automation-only: governance never caps and so never propagates (00-plan.md decision 1)."""
    out: list[Propagation] = []
    for target in before.effective.automation:
        if target in touched:
            continue
        was, now = _effective(before, target), _effective(after, target)
        if was == now:
            continue
        name, icon = _target_display(graph, target)
        out.append(Propagation(
            target=target,
            name=name,
            effective=LevelPair(before=was, after=now),
            via=after.effective.capped_by.get(target),
            icon=icon,
        ))
    return out


def _pattern_diff(before: GraphEvaluation, after: GraphEvaluation, patterns: Sequence[Pattern]) -> PatternDiff:
    """Reports each pattern by its curated display name (`Pattern.name`, e.g. "Silent Model
    Failure"), the same field the Performance Dashboard's own pattern badges read - not the raw
    `dp_.../ap_...` id, which is only a lookup key and was never meant to be shown to a player."""
    names_by_id = {p.id: p.name for p in patterns}

    def display(pattern_id: str) -> str:
        return names_by_id.get(pattern_id, pattern_id)

    was, now = set(before.active_patterns), set(after.active_patterns)
    gained, lost = sorted(now - was), sorted(was - now)
    return PatternDiff(
        gained=[display(p) for p in gained if p.startswith("dp_")],
        lost=[display(p) for p in lost if p.startswith("dp_")],
        anti_created=[display(p) for p in gained if p.startswith("ap_")],
        anti_resolved=[display(p) for p in lost if p.startswith("ap_")],
    )


def _health(before: GraphEvaluation, after: GraphEvaluation) -> tuple[dict[str, LevelPair], LevelPair]:
    was = {s.id: s.health for s in before.stage_graph.stages}
    now = {s.id: s.health for s in after.stage_graph.stages}
    stages = {sid: LevelPair(before=round(was[sid]), after=round(now.get(sid, was[sid]))) for sid in was}
    system = LevelPair(
        before=round(before.stage_graph.system_health), after=round(after.stage_graph.system_health)
    )
    return stages, system


# ---------------------------------------------------------------------------
# The event log (plan 11, D51): "what the world did" and "where you stand", fog aware. The
# player's own card (`report.targets`) is not logged here - they already know what they built.
# ---------------------------------------------------------------------------

def _metric_magnitude(delta: int) -> str:
    a = abs(delta)
    if a >= 6:
        return "large"
    if a >= 2:
        return "clear"
    return "slight"


def _target_label(graph: TechnicalGraph, target_id: str) -> str:
    if graph.is_component(target_id):
        return graph.component(target_id).name
    if graph.is_edge(target_id):
        return getattr(graph.edge(target_id), "name", None) or target_id
    return target_id


def _metric_label(metric_id: str) -> str:
    """The metric's display name, same one `MetricTab` shows - a log line should never make the
    player translate a config id (`model_intro`) back into the gauge they already know by name."""
    from mlops_serious_game.domain.metric_factory import MetricFactory

    try:
        return MetricFactory.get_metric(metric_id).name
    except Exception:
        return metric_id


def simulation_events(
    report: DeltaReport,
    graph: TechnicalGraph,
    names: Optional[dict[str, str]] = None,
) -> list[GameEvent]:
    """What gets logged for the simulation step: graph changes the world made,
    metric moves, and grudges written or fired."""
    names = names or {}
    events: list[GameEvent] = []

    for wd in report.world_events:
        direction = "up" if wd.after > wd.before else "down" if wd.after < wd.before else "none"
        if direction == "none":
            continue
        events.append(GameEvent(
            step="simulation", kind="graph", subject_id=wd.target, direction=direction, magnitude="clear",
            cause="graph.moved", params={"name": _target_label(graph, wd.target)},
        ))

    for prop in report.propagated:
        direction = "up" if prop.effective.after > prop.effective.before else "down" if prop.effective.after < prop.effective.before else "none"
        if direction == "none":
            continue
        events.append(GameEvent(
            step="simulation", kind="graph", subject_id=prop.target, direction=direction, magnitude="slight",
            cause="graph.moved", params={"name": _target_label(graph, prop.target)},
        ))

    for metric_id, delta in report.metric_deltas.items():
        if delta == 0:
            continue
        events.append(GameEvent(
            step="simulation", kind="metric", subject_id=metric_id,
            direction="up" if delta > 0 else "down", magnitude=_metric_magnitude(delta),
            cause="metric.moved", params={"metric": _metric_label(metric_id)},
        ))

    for grudge in report.grudges.created:
        events.append(GameEvent(
            step="simulation", kind="grudge", subject_id=grudge.stakeholder_id, direction="none",
            cause="grudge.written", params={"st": names.get(grudge.stakeholder_id, grudge.stakeholder_id)},
        ))
    for fired in report.grudges.fired:
        events.append(GameEvent(
            step="simulation", kind="grudge", subject_id=fired.stakeholder_id, direction="down", magnitude="clear",
            cause="grudge.fired", params={"st": names.get(fired.stakeholder_id, fired.stakeholder_id)},
        ))

    return events


# ---------------------------------------------------------------------------
# The pipeline
# ---------------------------------------------------------------------------

def simulate(
    graph: TechnicalGraph,
    before_state: GraphState,
    *,
    outcome: str = PASS,
    card_items: Sequence[Any] = (),
    reads: Sequence[Any] = (),
    challenge: Optional[Any] = None,
    grudges: Sequence[Grudge] = (),
    overridden_stakeholder_id: Optional[str] = None,
    upcoming_world_events: Sequence[GraphOp] = (),
    seed: str = "",
    patterns: Optional[list[Pattern]] = None,
    pattern_order: Optional[list[str]] = None,
    metrics: Optional[Sequence[Any]] = None,
    names: Optional[dict[str, str]] = None,
) -> SimulationResult:
    """The whole simulation phase for one committed card. Pure: nothing here reads or writes."""
    patterns = patterns if patterns is not None else PatternFactory.patterns
    pattern_order = pattern_order if pattern_order is not None else PatternFactory.order

    def evaluate(state: GraphState) -> GraphEvaluation:
        return evaluate_graph(graph, state, patterns, pattern_order)

    before = evaluate(before_state)                                            # 1
    owner_buyin = owner_buyin_from_reads(reads)                                # 2

    card: list[GraphOp] = []
    if outcome not in NO_CARD_OUTCOMES:                                        # 3
        # Lazily imported: the pure graph modules stay usable without the pitch service.
        from mlops_serious_game.application.pitch_debate_service.session import card_ops

        card = card_ops(list(card_items), graph=graph, state=before_state)

    card_touches_raw = list(dict.fromkeys(
        (op.target, op.axis) for op in card
        if op.kind == "raise_to" and op.axis is not None and graph.is_target(op.target)
    ))
    neglect = pick_neglect_target(graph, card_touches_raw, reads)

    applied: ApplyResult = apply_ops(graph, before_state, card, owner_buyin, neglect)  # 4
    state = applied.state
    mid = evaluate(state)                                                      # 5

    card_touches: list[tuple[str, Axis]] = []
    seen_touches: set[tuple[str, Axis]] = set()
    for op in applied.resolved_ops:
        if op.axis is None or not graph.is_target(op.target):
            continue
        pair = (op.target, op.axis)
        if pair not in seen_touches:
            seen_touches.add(pair)
            card_touches.append(pair)

    world: list[GraphOp] = []                                                  # 6
    if challenge is not None:
        raw = getattr(challenge, "stalemate_ops" if outcome == STALEMATE else "on_exit_ops", [])
        world += _ops_from_raw(raw, f"exit:{getattr(challenge, 'template_id', '')}")
        if outcome != STALEMATE:
            touched_this_round = set(card_touches)
            sweep_raw = [
                op for op in getattr(challenge, "baseline_sweep_ops", [])
                if (op.get("target"), op.get("axis")) not in touched_this_round
            ]
            world += _ops_from_raw(sweep_raw, f"sweep:{getattr(challenge, 'template_id', '')}")
    world += consequence_ops(mid.active_patterns, patterns)
    if outcome == VETO_BROKEN and overridden_stakeholder_id:
        world += veto_degradation_ops(graph, state, overridden_stakeholder_id, card_touches)

    # Levels are read before each batch so the report says what that event itself changed. Only
    # raise_to/set_to ops carry an axis and so a reportable level; other op kinds (set_trigger,
    # set_attr) a world event might also fire are not level changes and are skipped here.
    world_before = {
        (op.target, op.axis): state.value(op.target, op.axis)
        for op in world if op.axis is not None and graph.is_target(op.target)
    }
    state = apply_ops(graph, state, world).state                               # 7

    grudge_ops, fired, pending, kept = fire_grudges(                           # 9
        graph, state, grudges, seed, upcoming_world_events
    )
    grudge_before = {
        (op.target, op.axis): state.value(op.target, op.axis)
        for op in grudge_ops if op.axis is not None and graph.is_target(op.target)
    }
    state = apply_ops(graph, state, grudge_ops).state
    after = evaluate(state)                                                    # 8, on the settled graph

    degraded_by = {(d.target_id, d.axis): d.owner_id for d in applied.debt_created}

    # Kept as two passes (not one merged dict) so a target hit by both a world op and a grudge
    # reports each event's own before-level, not the other batch's.
    def _world_event(op: GraphOp, before_levels: dict[tuple[str, Axis], int]) -> WorldEventDelta:
        name, icon = _target_display(graph, op.target)
        return WorldEventDelta(
            target=op.target,
            axis=op.axis,
            name=name,
            before=before_levels[(op.target, op.axis)],
            after=state.value(op.target, op.axis),
            reason=op.reason or "",
            icon=icon,
        )

    events = [
        _world_event(op, world_before) for op in world
        if op.axis is not None and graph.is_target(op.target)
    ] + [
        _world_event(op, grudge_before) for op in grudge_ops
        if op.axis is not None and graph.is_target(op.target)
    ]
    world_touches = list({**world_before, **grudge_before})

    # Propagation is automation-only (00-plan.md decision 1): only that axis ever moves anything
    # it wasn't directly told to.
    touched = {t for t, axis in card_touches if axis == "automation"} | {
        t for t, axis in world_touches if axis == "automation"
    }
    stage_health, system_health = _health(before, after)
    created = grudges_created(outcome, reads, getattr(challenge, "template_id", None), overridden_stakeholder_id)
    stakeholders = _stakeholder_execution(reads, outcome, overridden_stakeholder_id, names)

    report = DeltaReport(
        outcome=outcome,
        targets=_target_deltas(
            graph,
            card_touches,
            before_state,
            state,
            before,
            after,
            degraded_by,
            applied.debt_created,
            names,
        ),
        debt_created=applied.debt_created,
        debt_cleared=applied.debt_cleared,
        world_events=events,
        propagated=_propagated(graph, touched, before, after),
        stage_health=stage_health,
        system_health=system_health,
        patterns=_pattern_diff(before, after, patterns),
        grudges=GrudgeReport(created=created, fired=fired),
        metric_deltas=metric_deltas(before, after, metrics),                   # 10
        stakeholders=stakeholders,
    )
    return SimulationResult(
        report=report,
        state=state,
        ops=applied.resolved_ops + world + grudge_ops,
        grudges=kept + created,
        pending_objections=pending,
    )


def run_simulation(
    user_id: int,
    *,
    challenge: Any,
    outcome: str = PASS,
    card_items: Sequence[Any] = (),
    reads: Sequence[Any] = (),
    grudges: Sequence[Grudge] = (),
    overridden_stakeholder_id: Optional[str] = None,
    upcoming_world_events: Sequence[GraphOp] = (),
    challenge_loop_index: int = 3,
    seed: Optional[str] = None,
    names: Optional[dict[str, str]] = None,
) -> SimulationResult:
    """Step 1 and step 12: load the player's graph, simulate, append the batch.

    Idempotent per challenge: committing twice does not apply the card twice - and (D-question 1,
    code review) a repeat call never recomputes either. `simulate()` reads `before` as it stands
    *right now*, which already includes the first call's effects, so blindly re-running it on a
    replay produced a DeltaReport that looked wrong (world events/grudges applied on top of an
    already-updated graph) even though nothing was double-persisted. The fix: check for an
    existing batch first, and if there is one, return its stored report and the current live
    state verbatim - never re-simulate.
    """
    from mlops_serious_game.application.graph_service import store
    from mlops_serious_game.domain.graph_factory import GraphFactory

    graph = GraphFactory.get_graph()
    source_id = f"sim:{challenge.template_id}:{challenge_loop_index}"

    if store.has_batch(user_id, source_id):
        stored_report = store.load_report(user_id, source_id)
        if stored_report is not None:
            state = store.load_state(user_id).state
            return SimulationResult(
                report=DeltaReport.model_validate(stored_report),
                state=state,
                ops=[],
                grudges=list(grudges),
                pending_objections=[],
            )
        # A batch persisted before this column existed has no stored report - fall through and
        # compute one best-effort, but the append below still won't run a second time.

    replay = store.load_state(user_id)
    before = replay.state
    result = simulate(
        graph,
        before,
        outcome=outcome,
        card_items=card_items,
        reads=reads,
        challenge=challenge,
        grudges=grudges,
        overridden_stakeholder_id=overridden_stakeholder_id,
        upcoming_world_events=upcoming_world_events,
        seed=seed if seed is not None else user_id,
        names=names,
    )
    result = result.model_copy(update={
        "events": simulation_events(result.report, graph, names)
    })
    if result.ops and not store.has_batch(user_id, source_id):
        store.append_ops(
            user_id,
            result.ops,
            phase_index=challenge.phase_id,
            challenge_template=challenge.template_id,
            challenge_loop_index=challenge_loop_index,
            source_kind="world_event" if outcome == STALEMATE else "action_card",
            source_id=source_id,
            report=result.report.model_dump(mode="json"),
        )
    return result
