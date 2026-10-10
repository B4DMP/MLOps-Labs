"""Pitch phase orchestration: streamlined negotiation flow.

Pure over its inputs. Evaluates Action Card proposal against stakeholder demands
(Drivers, Trade-offs with branch X/Y, Boundaries) and observations (Facts).
Convincer archetypes and dialogue mini-games are completely removed.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.application.pitch_debate_service.scoring import (
    buy_in,
    buy_in_band,
    emotions_norm,
    objection_line,
    outcome as calc_outcome,
)
from mlops_serious_game.domain.emotion import (
    MISCLASSIFICATION_MALUS,
    apply_emotion_delta,
    calculate_demand_alignment,
    calculate_dynamic_weights,
    calculate_pitch_deltas,
    calculate_reactivity,
    get_misclassification_malus,
    get_patience_malus,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.graph import Axis, GraphOp, GraphState, TechnicalGraph
from mlops_serious_game.domain.graph_predicates import PredicateError, evaluate
from mlops_serious_game.domain.requirement import IntelTag, item_target_and_level
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

MAX_ATOMIC_CHANGES = 4
RISK_GREEN = 0.6
RISK_AMBER = 0.4


class AtomicChange(BaseModel):
    """An atomic mutation in the MLOps graph.

    Can raise maturity levels or set edge triggers. `axis` is required for
    kind="raise_to" - which of the two independent maturity axes it moves
    (docs/plans/graph-governance-automation-rework/00-plan.md); there is no combined level to
    infer it from.
    """
    target: str
    kind: str = "raise_to"
    axis: Optional[Axis] = None
    value: Optional[Any] = None
    trigger: Optional[str] = None
    #: Hand the Pen (docs/plans/hand-over-the-pen.md): the stakeholder who drafted this change,
    #: once revealed. Never set on a change the player picked themselves.
    delegated_to: Optional[str] = None


class ItemPrediction(BaseModel):
    """What one slotted atomic change would do, as far as the player can tell."""

    item_id: str
    target: Optional[str] = None
    axis: Optional[Axis] = None
    asked: Optional[int] = None
    predicted: Optional[int] = Field(default=None, description="None when the player cannot know yet")
    capped_by: Optional[str] = None
    known: bool = True
    upstream_uncertain: bool = False
    upstream_uncertain_nodes: list[str] = Field(default_factory=list)


class BoundaryWarning(BaseModel):
    item_id: str
    stakeholder_id: Optional[str] = None
    target: Optional[str] = None
    checkable: bool = True
    violated: bool = False
    target_name: Optional[str] = None
    line: Optional[str] = Field(default=None, description="The Boundary in the player's own intel wording")


class StakeholderRead(BaseModel):
    """One stakeholder's standing against the current card."""

    stakeholder_id: str
    power: str
    alignment: float = 0.0
    emotions: float = 0.5
    buy_in: float = 0.5
    band: str = "green"
    boundary_violated: bool = False
    emotional_state: str = "neutral"
    emotion_values: dict[str, float] = Field(default_factory=dict)
    buy_in_band: str = "medium"
    threshold: float = Field(default=0.4, description="Buy-in below this makes them veto or object")
    impatience: int = Field(default=0, description="Impatience steps on show (0 to the configured cap)")


class CardView(BaseModel):
    """Everything the builder and commit screen need about the current card."""

    predictions: list[ItemPrediction] = Field(default_factory=list)
    boundary_warnings: list[BoundaryWarning] = Field(default_factory=list)
    reads: list[StakeholderRead] = Field(default_factory=list)
    outcome: str = "PASS"


class Objection(BaseModel):
    """One objection or feedback note raised during pitch evaluation."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: str  # "driver", "trade_off", "boundary", "misclassification"
    stakeholder_id: str
    item_id: Optional[str] = None
    target: Optional[str] = None
    text: str
    hard: bool = False


class PitchFeedbackMessage(BaseModel):
    """Single feedback message from a stakeholder during pitch review."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    stakeholder_id: str
    text: str
    kind: str = "feedback"  # "feedback", "refutation", "approval"


class PenState(BaseModel):
    """Hand the Pen (docs/plans/hand-over-the-pen.md): one sealed draft, pending the pitch's
    reveal. Excluded from every client-facing view (`card_view`, `pitch:state`) until revealed -
    see `pen.py` and `pitch_handler.py` for the sealed-state plumbing."""

    stakeholder_id: str
    target: str
    change: AtomicChange
    band: str  # "low" | "medium" | "high"
    item_id: Optional[str] = None
    revealed: bool = False
    #: Whether the holder's trust/control bonus (the next evaluate after reveal) has been paid.
    bonus_paid: bool = False


class PitchState(BaseModel):
    """State of the streamlined pitch negotiation."""

    stage: str = "PREPARE"  # PREPARE, PITCHED, DONE
    atomic_changes: list[AtomicChange] = Field(default_factory=list)
    objections: list[Objection] = Field(default_factory=list)
    feedback_messages: list[PitchFeedbackMessage] = Field(default_factory=list)
    emotion_deltas: dict[str, dict[str, float]] = Field(default_factory=dict)
    outcome: Optional[str] = None
    presentation_count: int = Field(default=0, description="How many times an action card has been presented in this challenge")
    # Set only by `veto_breaker()`. This is the whole signal `simulation_handler` needs to tell
    # the pipeline "this PASS was actually a broken veto, against this stakeholder" - see that
    # function's docstring for why a dedicated field replaced the old patience-based one.
    overridden_stakeholder_id: Optional[str] = None
    # The card and per-stakeholder card-driven emotion deltas of the last pitch, so a re-pitch can
    # be refused when unchanged and stakeholders whose reaction didn't move can stay silent.
    last_pitched_changes: list[AtomicChange] = Field(default_factory=list)
    reaction_signatures: dict[str, dict[str, float]] = Field(default_factory=dict)
    # Impatience steps per stakeholder for this challenge; the emotion offset is derived from them.
    impatience: dict[str, int] = Field(default_factory=dict)
    # The vetoing stakeholder's line, kept so a reload can show the veto again.
    veto_message: str = ""
    # Set once the intro's free first revision after a veto has been spent.
    free_repeat_used: bool = False
    # Per stakeholder, how the last re-pitch landed: quiet | unchanged | answered | changed_unanswered.
    repeat_context: dict[str, str] = Field(default_factory=dict)
    # Case board allies: who was lifted this pitch, and the confirmed ally who backed them.
    ally_lifts: dict[str, list[str]] = Field(default_factory=dict)
    # Hand the Pen: the currently sealed draft (if any), and who has already drafted one this
    # challenge (for `pen_max_per_challenge`).
    pen: Optional[PenState] = None
    pen_used: list[str] = Field(default_factory=list)

    def open_objections(self) -> list[Objection]:
        return self.objections


def risk_band(value: float) -> str:
    if value >= RISK_GREEN:
        return "green"
    if value >= RISK_AMBER:
        return "amber"
    return "red"


def same_card(a: list[AtomicChange], b: list[AtomicChange]) -> bool:
    """Whether two cards hold the same changes, ignoring slot order."""
    def key(c: AtomicChange) -> tuple:
        return (c.target, c.kind, c.axis, str(c.value), c.trigger)
    return sorted(map(key, a)) == sorted(map(key, b))


def silent_stakeholders(state: PitchState, new_signatures: dict[str, dict[str, float]]) -> set[str]:
    """Stakeholders reacting exactly as they did to the last pitch (same card-driven emotion deltas,
    which encode alignment, boundaries and misclassifications) - they skip the reply."""
    return {
        st_id for st_id, sig in new_signatures.items()
        if st_id in state.reaction_signatures and state.reaction_signatures[st_id] == sig
    }


def quiet_stakeholders(state: PitchState) -> set[str]:
    """Stakeholders who were fine and saw nothing change for them: no reaction, no emotion update."""
    return {st_id for st_id, ctx in state.repeat_context.items() if ctx == "quiet"}


def _patience_scale(sensitivities: Optional[dict[str, float]]) -> float:
    """Stress and sense-of-control sensitivities set how fast someone loses patience."""
    sens = sensitivities or {}
    mean = (sens.get("stress", 1.0) + sens.get("sense_of_control", 1.0)) / 2
    return max(0.75, min(1.5, mean))


def impatience_offset(step: int, sensitivities: Optional[dict[str, float]] = None) -> dict[str, float]:
    """Derived emotion offset for an impatience step count (never stored), growing less per step."""
    tuning = EmotionFactory.get_pitch_tuning()
    n = max(0, min(int(step), tuning.impatience_cap))
    if n == 0:
        return {}
    growth = sum(tuning.impatience_decay ** k for k in range(n))
    return get_patience_malus(tuning.impatience_step * growth * _patience_scale(sensitivities))


def _sensitivities_of(st_id: str) -> dict[str, float]:
    st_obj = StakeholderFactory.get_stakeholder(st_id)
    return getattr(st_obj, "emotion_sensitivities", {}) if st_obj else {}


def find_pipeline_predecessors(graph: TechnicalGraph, target: str) -> list[str]:
    """Returns all ancestor components in the pipeline graph feeding into target, in stable BFS
    discovery order. `seen` is only for membership testing - the returned order must not depend
    on set/dict iteration (which Python randomizes per-process via PYTHONHASHSEED for str keys),
    or the same graph state can report a different `upstream_uncertain_nodes` list on every run."""
    seen: set[str] = set()
    preds: list[str] = []
    if graph.is_edge(target):
        edge = graph.edge(target)
        queue = [edge.from_id]
        seen.add(edge.from_id)
        preds.append(edge.from_id)
    else:
        queue = [target]
    while queue:
        curr = queue.pop(0)
        for e in graph.pipeline_edges():
            if e.to_id == curr and e.from_id not in seen:
                seen.add(e.from_id)
                preds.append(e.from_id)
                queue.append(e.from_id)
    return preds


def _extract_target_and_level(
    item: Any, graph: TechnicalGraph, state: GraphState
) -> tuple[Optional[str], Optional[int], Optional[Axis]]:
    target = None
    asked = None
    axis = None
    if isinstance(item, AtomicChange):
        target = item.target
        asked = item.value
        axis = item.axis
    elif isinstance(item, dict):
        target = item.get("target")
        asked = item.get("value")
        axis = item.get("axis")
        if not target:
            sugg = item.get("suggested")
            if isinstance(sugg, dict):
                target = sugg.get("target")
                asked = sugg.get("level")
                axis = sugg.get("axis")
        if not target:
            bx = item.get("branch_x")
            if isinstance(bx, dict):
                target = bx.get("target")
                asked = bx.get("level")
                axis = bx.get("axis")
    else:
        target = getattr(item, "target", None)
        asked = getattr(item, "value", None)
        axis = getattr(item, "axis", None)
        if not target:
            sugg = getattr(item, "suggested", None)
            if sugg:
                target = getattr(sugg, "target", None) or (sugg.get("target") if isinstance(sugg, dict) else None)
                asked = getattr(sugg, "level", None) or (sugg.get("level") if isinstance(sugg, dict) else None)
                axis = getattr(sugg, "axis", None) or (sugg.get("axis") if isinstance(sugg, dict) else None)
        if not target:
            bx = getattr(item, "branch_x", None) or (item.get("branch_x") if isinstance(item, dict) else None)
            if bx:
                target = getattr(bx, "target", None) or (bx.get("target") if isinstance(bx, dict) else None)
                asked = getattr(bx, "level", None) or (bx.get("level") if isinstance(bx, dict) else None)
                axis = getattr(bx, "axis", None) or (bx.get("axis") if isinstance(bx, dict) else None)

    if target and graph.is_target(target) and axis in ("automation", "governance"):
        if asked is None:
            allowed = graph.allowed_for(target, axis)
            current = state.value(target, axis)
            next_levels = [a for a in allowed if a > current]
            asked = min(next_levels) if next_levels else current
        else:
            try:
                asked = int(asked)
            except (ValueError, TypeError):
                pass
        return target, asked, axis
    return None, None, None


def _automation_before_governance(ops: list[GraphOp]) -> list[GraphOp]:
    """A batch that raises both axes on the same target must apply automation first - governance
    is rejected outright on a target that isn't implemented yet (apply.py's `_apply_one`), and
    `replay` re-derives ground truth from these same logged ops with no lookahead of its own, so
    the order they're logged in is the only thing that can make this work regardless of which
    order the player's own choices (or a pitch's accepted stances) happened to name them in.
    Stable, so a chain of several steps on the same axis keeps its own relative order."""
    return sorted(ops, key=lambda op: op.axis == "governance")


def atomic_changes_to_ops(
    graph: TechnicalGraph,
    state: GraphState,
    changes: list[Any],
) -> list[GraphOp]:
    """Derives GraphOps from atomic changes or slotted items."""
    ops: list[GraphOp] = []
    for c in changes[:MAX_ATOMIC_CHANGES]:
        target = getattr(c, "target", None) or (c.get("target") if isinstance(c, dict) else None)
        kind = getattr(c, "kind", None) or (c.get("kind") if isinstance(c, dict) else "raise_to")
        axis = getattr(c, "axis", None) if hasattr(c, "axis") else (c.get("axis") if isinstance(c, dict) else None)
        val = getattr(c, "value", None) if hasattr(c, "value") else (c.get("value") if isinstance(c, dict) else None)
        trigger = getattr(c, "trigger", None) if hasattr(c, "trigger") else (c.get("trigger") if isinstance(c, dict) else None)
        delegated_to = getattr(c, "delegated_to", None) if hasattr(c, "delegated_to") else (c.get("delegated_to") if isinstance(c, dict) else None)
        # Hand the Pen (docs/plans/hand-over-the-pen.md): a delegated change's resolved op is
        # tagged so `resolve_step_cap` can let a High-trust draft move more than one rung.
        source_id = "pen" if delegated_to else None

        if not target:
            target, val, axis = _extract_target_and_level(c, graph, state)

        if not target or not graph.is_target(target):
            continue

        if kind == "raise_to":
            if axis not in ("automation", "governance"):
                continue  # no axis named or inferable - nothing to raise (00-plan.md §10.1)
            target_level = None
            if val is not None:
                try:
                    target_level = int(val)
                except (ValueError, TypeError):
                    target_level = None
            if target_level is None:
                allowed = graph.allowed_for(target, axis)
                current = state.value(target, axis)
                next_levels = [a for a in allowed if a > current]
                target_level = min(next_levels) if next_levels else current

            ops.append(
                GraphOp(
                    kind="raise_to",
                    target=target,
                    axis=axis,
                    value=target_level,
                    source_kind="action_card",
                    source_id=source_id,
                )
            )
            if graph.is_edge(target) and trigger:
                ops.append(
                    GraphOp(
                        kind="set_trigger",
                        target=target,
                        value=trigger,
                        source_kind="action_card",
                    )
                )
        elif kind == "set_trigger" and graph.is_edge(target):
            trigger_val = trigger or val
            if trigger_val:
                ops.append(
                    GraphOp(
                        kind="set_trigger",
                        target=target,
                        value=trigger_val,
                        source_kind="action_card",
                    )
                )
        else:
            tgt, lvl, ax = _extract_target_and_level(c, graph, state)
            if tgt and lvl is not None and ax is not None:
                ops.append(
                    GraphOp(
                        kind="raise_to",
                        target=tgt,
                        axis=ax,
                        value=lvl,
                        source_kind="action_card",
                    )
                )
    return _automation_before_governance(ops)


def card_items(all_intel: list, card_item_ids: set[str]) -> list:
    """Filter all_intel by matching ids."""
    return [i for i in all_intel if (getattr(i, "id", None) in card_item_ids or (isinstance(i, dict) and i.get("id") in card_item_ids))]


def card_ops(
    items: list,
    trade_off_branches: Optional[dict[str, str]] = None,
    graph: Optional[TechnicalGraph] = None,
    state: Optional[GraphState] = None,
) -> list[GraphOp]:
    """Derives GraphOps from items (AtomicChange, GraphOp, or intel items)."""
    ops: list[GraphOp] = []
    for item in items:
        if isinstance(item, GraphOp):
            ops.append(item)
            continue
        if isinstance(item, AtomicChange):
            if graph and state:
                derived = atomic_changes_to_ops(graph, state, [item])
                ops.extend(derived)
            else:
                ops.append(GraphOp(kind=item.kind or "raise_to", target=item.target, value=item.value, source_kind="action_card"))
            continue
        if isinstance(item, dict) and "target" in item:
            ac = AtomicChange.model_validate(item)
            if graph and state:
                derived = atomic_changes_to_ops(graph, state, [ac])
                ops.extend(derived)
            else:
                ops.append(GraphOp(kind=ac.kind or "raise_to", target=ac.target, value=ac.value, source_kind="action_card"))
            continue

        item_id = getattr(item, "id", None) or (item.get("id") if isinstance(item, dict) else None)
        branch_key = (trade_off_branches or {}).get(item_id)
        if branch_key == "X" and (getattr(item, "branch_x", None) or (isinstance(item, dict) and "branch_x" in item)):
            branch = getattr(item, "branch_x", None) or item.get("branch_x")
            target = getattr(branch, "target", None) or (branch.get("target") if isinstance(branch, dict) else None)
            level = getattr(branch, "level", None) or (branch.get("level") if isinstance(branch, dict) else None)
            axis = getattr(branch, "axis", None) or (branch.get("axis") if isinstance(branch, dict) else None)
            if target and axis:
                ops.append(GraphOp(kind="raise_to", target=target, axis=axis, value=level, source_kind="action_card"))
            continue
        elif branch_key == "Y" and (getattr(item, "branch_y", None) or (isinstance(item, dict) and "branch_y" in item)):
            branch = getattr(item, "branch_y", None) or item.get("branch_y")
            target = getattr(branch, "target", None) or (branch.get("target") if isinstance(branch, dict) else None)
            level = getattr(branch, "level", None) or (branch.get("level") if isinstance(branch, dict) else None)
            axis = getattr(branch, "axis", None) or (branch.get("axis") if isinstance(branch, dict) else None)
            if target and axis:
                ops.append(GraphOp(kind="raise_to", target=target, axis=axis, value=level, source_kind="action_card"))
            continue

        raw_ops = getattr(item, "ops", None) or (item.get("ops") if isinstance(item, dict) else None)
        if raw_ops:
            for raw in raw_ops:
                ops.append(GraphOp.model_validate({**raw, "source_kind": "action_card"}))
            continue

        suggested = getattr(item, "suggested", None) or (item.get("suggested") if isinstance(item, dict) else None)
        if suggested:
            target = getattr(suggested, "target", None) or (suggested.get("target") if isinstance(suggested, dict) else None)
            level = getattr(suggested, "level", None) or (suggested.get("level") if isinstance(suggested, dict) else None)
            axis = getattr(suggested, "axis", None) or (suggested.get("axis") if isinstance(suggested, dict) else None)
            if target and axis:
                ops.append(GraphOp(kind="raise_to", target=target, axis=axis, value=level, source_kind="action_card"))
            continue

        if isinstance(item, dict) and "target" in item:
            ops.append(GraphOp(
                kind=item.get("kind", "raise_to"), target=item["target"], axis=item.get("axis"),
                value=item.get("value"), source_kind="action_card",
            ))

    return _automation_before_governance(ops)



def predicted_state(
    graph: TechnicalGraph,
    state: GraphState,
    changes: list[Any],
) -> GraphState:
    """The graph as it would be right after this card, without writing anything."""
    ops = atomic_changes_to_ops(graph, state, changes)
    return apply_ops(graph, state, ops).state if ops else state


def _effective_of(effective, target: str, axis: Axis) -> Optional[int]:
    source = effective.automation if axis == "automation" else effective.governance
    return source.get(target)


def _boundary_target(item) -> Optional[str]:
    target, _, _ = item_target_and_level(item)
    if target:
        return target
    holds = getattr(item, "holds", None)
    return holds.get("component") if isinstance(holds, dict) else None


def predictions_for(
    graph: TechnicalGraph,
    state: GraphState,
    changes: list[Any],
) -> list[ItemPrediction]:
    ops = atomic_changes_to_ops(graph, state, changes)
    after = apply_ops(graph, state, ops).state if ops else state
    effective = evaluate_graph(graph, after).effective
    out: list[ItemPrediction] = []

    for c in changes[:MAX_ATOMIC_CHANGES]:
        target, target_lvl, axis = _extract_target_and_level(c, graph, state)
        if not target or axis is None:
            continue
        item_id = getattr(c, "id", None) or (c.get("id") if isinstance(c, dict) else None) or target
        eff = _effective_of(effective, target, axis)

        out.append(ItemPrediction(
            item_id=item_id,
            target=target,
            axis=axis,
            asked=target_lvl,
            predicted=eff,
            capped_by=effective.capped_by.get(target),
        ))
    return out


def capped_item_ids(
    graph: TechnicalGraph,
    state: GraphState,
    items: list,
) -> set[str]:
    preds = predictions_for(graph, state, items)
    return {p.item_id for p in preds if p.capped_by is not None}


def boundary_checks(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    changes: list[AtomicChange],
    room_st_ids: list[str],
) -> list[BoundaryWarning]:
    """Checks Boundary constraints of room stakeholders against post-card state."""
    after = predicted_state(graph, state, changes)
    ctx = evaluate_graph(graph, after).context(graph, after)
    warnings: list[BoundaryWarning] = []
    for item in all_intel:
        r_type = getattr(item, "type", None)
        if hasattr(r_type, "value"):
            r_type = r_type.value
        if r_type != IntelTag.BOUNDARY.value and r_type != "boundary":
            continue
        if item.stakeholder_id not in room_st_ids:
            continue
        holds = getattr(item, "holds", None)
        if holds is None:
            continue
        target = _boundary_target(item)
        try:
            violated = not evaluate(holds, ctx).value
        except PredicateError:
            warnings.append(BoundaryWarning(
                item_id=item.id, stakeholder_id=item.stakeholder_id, target=target, checkable=False
            ))
            continue
        warnings.append(BoundaryWarning(
            item_id=item.id, stakeholder_id=item.stakeholder_id, target=target, violated=violated
        ))
    return warnings


def player_boundary_warnings(graph: TechnicalGraph, warnings: list[BoundaryWarning], held: list) -> list[BoundaryWarning]:
    mine = {
        i.id: i for i in held
        if getattr(i, "categorized_type", None) in (IntelTag.BOUNDARY, "boundary")
    }
    out: list[BoundaryWarning] = []
    for w in warnings:
        item = mine.get(w.item_id)
        if item is None:
            continue
        name = None
        if w.target and graph.is_component(w.target):
            name = graph.component(w.target).name
        elif w.target and graph.is_edge(w.target):
            name = getattr(graph.edge(w.target), "name", None)
        out.append(w.model_copy(update={"target_name": name or w.target, "line": item.description}))
    return out


_RAISE_ATOM = re.compile(r"^raise_to\((.+), (\d+)\)$")


def _atom_credit(
    atom: str,
    card_atoms: set[str],
    target_levels: dict[tuple[str, str], int],
    state: Optional[GraphState],
) -> float:
    """Credit in [0, 1] for one authored driver atom. A `raise_to` atom is met by any level at or
    above it, and a card that moves the target up without reaching it earns the share of the
    distance covered (the step cap often stops a card on the first rung)."""
    if atom in card_atoms:
        return 1.0
    m = _RAISE_ATOM.match(atom)
    if not m:
        return 0.0
    target, asked = m.group(1), int(m.group(2))
    best = 0.0
    for (t, axis), achieved in target_levels.items():
        if t != target:
            continue
        if achieved >= asked:
            return 1.0
        start = state.value(t, axis) if state is not None else None
        if start is not None and start < asked and achieved > start:
            best = max(best, (achieved - start) / (asked - start))
    return best


def driver_fulfillment(
    req: Any,
    card_atoms: set[str],
    target_levels: dict[tuple[str, str], int],
    state: Optional[GraphState] = None,
) -> float:
    """Fraction of this Driver satisfied by the card, in [0.0, 1.0].

    A Driver with several `atoms` (one per atomic graph operation it names) gets partial credit
    for however many of them the card covers (`_atom_credit`: a higher level counts, and so does
    progress toward it). A Driver with no authored atoms falls back to the single
    target/axis/level check, with the same credit for progress when `state` is given.
    """
    atoms = set(getattr(req, "atoms", None) or (req.get("atoms", []) if isinstance(req, dict) else []))
    if atoms:
        return sum(_atom_credit(a, card_atoms, target_levels, state) for a in atoms) / len(atoms)
    target, asked, axis = item_target_and_level(req)
    key = (target, axis)
    if target and axis and key in target_levels:
        achieved = target_levels[key]
        if asked is None or achieved >= asked:
            return 1.0
        start = state.value(target, axis) if state is not None else None
        if start is not None and start < asked and achieved > start:
            return (achieved - start) / (asked - start)
    return 0.0


def is_driver_satisfied(
    req: Any,
    card_atoms: set[str],
    target_levels: dict[tuple[str, str], int],
    state: Optional[GraphState] = None,
) -> bool:
    return driver_fulfillment(req, card_atoms, target_levels, state) > 0.0


def trade_off_fulfillment(
    req: Any,
    card_atoms: set[str],
    target_levels: dict[tuple[str, str], int],
    state: Optional[GraphState] = None,
) -> float:
    """Fraction of this Trade-off satisfied by the card, in [0.0, 1.0]: the better-covered of its
    two branches, or - for a `concedes`-only Trade-off with no branches - whether the conceded
    target/axis stays at or under the level the stakeholder said she'd settle for. `state` is the
    pre-card graph state, needed because a `concedes` target the card never touches has no entry in
    `target_levels` but is still, correctly, satisfied by being left alone."""
    bx_atoms = set(getattr(req, "branch_x_atoms", None) or (req.get("branch_x_atoms", []) if isinstance(req, dict) else []))
    by_atoms = set(getattr(req, "branch_y_atoms", None) or (req.get("branch_y_atoms", []) if isinstance(req, dict) else []))
    bx_data = getattr(req, "branch_x", None)
    by_data = getattr(req, "branch_y", None)
    bx_target = getattr(bx_data, "target", None) or (bx_data.get("target") if isinstance(bx_data, dict) else None)
    bx_level = getattr(bx_data, "level", None) or (bx_data.get("level") if isinstance(bx_data, dict) else 3)
    bx_axis = getattr(bx_data, "axis", None) or (bx_data.get("axis") if isinstance(bx_data, dict) else None)
    by_target = getattr(by_data, "target", None) or (by_data.get("target") if isinstance(by_data, dict) else None)
    by_level = getattr(by_data, "level", None) or (by_data.get("level") if isinstance(by_data, dict) else 3)
    by_axis = getattr(by_data, "axis", None) or (by_data.get("axis") if isinstance(by_data, dict) else None)

    def _branch_fulfillment(atoms: set[str], target: Optional[str], axis: Optional[str], level: Optional[int]) -> float:
        if atoms:
            return len(atoms & card_atoms) / len(atoms)
        key = (target, axis)
        if target and axis and key in target_levels and target_levels[key] >= (level or 3):
            return 1.0
        return 0.0

    if bx_data is not None or by_data is not None:
        fx = _branch_fulfillment(bx_atoms, bx_target, bx_axis, bx_level)
        fy = _branch_fulfillment(by_atoms, by_target, by_axis, by_level)
        return max(fx, fy)

    concedes = getattr(req, "concedes", None)
    if concedes is not None and getattr(concedes, "target", None) and getattr(concedes, "axis", None):
        key = (concedes.target, concedes.axis)
        ceiling = concedes.accepts_max_level
        if ceiling is None:
            return 1.0
        level = target_levels.get(key)
        if level is None and state is not None:
            level = state.value(concedes.target, concedes.axis)
        return 1.0 if level is None or level <= ceiling else 0.0

    return 0.0


def is_trade_off_satisfied(
    req: Any,
    card_atoms: set[str],
    target_levels: dict[tuple[str, str], int],
    state: Optional[GraphState] = None,
) -> bool:
    return trade_off_fulfillment(req, card_atoms, target_levels, state) > 0.0


def calculate_demand_alignment_for_changes(
    stakeholder_reqs: list,
    card_atoms: set[str],
    target_levels: dict[tuple[str, str], int],
    violated_map: Optional[dict[str, bool]] = None,
    state: Optional[GraphState] = None,
) -> float:
    stance_reqs = []
    for r in stakeholder_reqs:
        r_type = getattr(r, "type", None) or (r.get("type") if isinstance(r, dict) else None)
        if hasattr(r_type, "value"):
            r_type = r_type.value
        if r_type in ("driver", "trade_off"):
            stance_reqs.append(r)

    if not stance_reqs:
        if violated_map:
            for r in stakeholder_reqs:
                r_id = getattr(r, "id", None) or (r.get("id") if isinstance(r, dict) else "")
                if violated_map.get(r_id, False):
                    return -1.0
        return 1.0

    score = 0.0
    for req in stance_reqs:
        r_type = getattr(req, "type", None) or (req.get("type") if isinstance(req, dict) else None)
        if hasattr(r_type, "value"):
            r_type = r_type.value
        if r_type == "driver":
            f = driver_fulfillment(req, card_atoms, target_levels, state)
            score += (2.0 * f - 1.0)
        elif r_type == "trade_off":
            f = trade_off_fulfillment(req, card_atoms, target_levels, state)
            score += (2.0 * f - 1.0)

    return max(-1.0, min(1.0, score / len(stance_reqs)))


def stakeholder_reads(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    changes: list[AtomicChange],
    room: list[tuple],
    emotion_values: dict[str, dict[str, float]],
    impatience: Optional[dict[str, int]] = None,
) -> list[StakeholderRead]:
    """Evaluates continuous demand alignment, emotions, and buy-in for every stakeholder in the room."""
    ops = atomic_changes_to_ops(graph, state, changes)
    room_ids = [st_entry[0] for st_entry in room]

    warnings = boundary_checks(graph, state, all_intel, changes, room_ids)
    violated_by_st: dict[str, bool] = {}
    violated_by_item: dict[str, bool] = {}
    for w in warnings:
        if w.violated:
            violated_by_item[w.item_id] = True
            if w.stakeholder_id:
                violated_by_st[w.stakeholder_id] = True

    # Judge alignment on what the card actually delivers, not what it asks for: a raise_to op is
    # capped to one rung per slot (resolve_step_cap), so a Driver/Trade-off naming a level past
    # the next rung must only get credit for the rung the card really reaches.
    after = apply_ops(graph, state, ops).state if ops else state
    card_atoms: set[str] = set()
    target_levels: dict[tuple[str, str], int] = {}
    for op in ops:
        if op.kind in ("raise_to", "set_to") and op.axis:
            achieved = after.value(op.target, op.axis)
            card_atoms.add(f"{op.kind}({op.target}, {achieved})")
            target_levels[(op.target, op.axis)] = achieved
        else:
            card_atoms.add(f"{op.kind}({op.target}, {op.value})")

    reads: list[StakeholderRead] = []
    for room_entry in room:
        st_id = room_entry[0]
        power = room_entry[1]
        st_intel = [i for i in all_intel if getattr(i, "stakeholder_id", None) == st_id]
        
        align = calculate_demand_alignment_for_changes(
            stakeholder_reqs=st_intel,
            card_atoms=card_atoms,
            target_levels=target_levels,
            violated_map=violated_by_item,
            state=state,
        )
        ev = emotion_values.get(st_id, EmotionFactory.create_default_emotion_values(0.5))
        steps = (impatience or {}).get(st_id, 0)
        if steps:
            ev = apply_emotion_delta(ev, impatience_offset(steps, _sensitivities_of(st_id)))
        em_norm = emotions_norm(ev)
        bv = violated_by_st.get(st_id, False)
        bi = buy_in(alignment_val=align, emotions_val=em_norm, boundary_violated=bv)
        st_state = EmotionFactory.derive_emotional_state(ev)

        reads.append(StakeholderRead(
            stakeholder_id=st_id,
            power=power,
            alignment=align,
            emotions=em_norm,
            buy_in=bi,
            band=risk_band(bi),
            boundary_violated=bv,
            emotional_state=st_state,
            emotion_values=ev,
            buy_in_band=buy_in_band(bi),
            threshold=objection_line(power),
            impatience=min(steps, EmotionFactory.get_pitch_tuning().impatience_cap),
        ))
    return reads


def card_view(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    changes: list[AtomicChange],
    room: list[tuple],
    emotion_values: Optional[dict[str, dict[str, float]]] = None,
    impatience: Optional[dict[str, int]] = None,
) -> CardView:
    """One call for the builder and commit screen: predictions, warnings, reads, outcome."""
    room_ids = [st_entry[0] for st_entry in room]

    reads = stakeholder_reads(
        graph=graph,
        state=state,
        all_intel=all_intel,
        changes=changes,
        room=room,
        emotion_values=emotion_values or {},
        impatience=impatience,
    )
    return CardView(
        predictions=predictions_for(graph, state, changes),
        boundary_warnings=boundary_checks(graph, state, all_intel, changes, room_ids),
        reads=reads,
        outcome=calc_outcome([(r.stakeholder_id, r.power, r.buy_in, r.boundary_violated) for r in reads]),
    )


def start_pitch(room_st_ids: list[str]) -> PitchState:
    return PitchState()


def evaluate_pitch(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    changes: Optional[list[Any]] = None,
    room: Optional[list[tuple]] = None,
    current_emotions: Optional[dict[str, dict[str, float]]] = None,
    held_items: Optional[list] = None,
    names: Optional[dict[str, str]] = None,
    presentation_count: int = 1,
    previous: Optional[PitchState] = None,
    free_repeat: bool = False,
    confirmed_relations: Optional[list] = None,
    **kwargs,
) -> tuple[PitchState, CardView, list[str]]:
    """Evaluates the pitched Action Card once against all room stakeholders.
    
    Generates single-round stakeholder feedback:
    - Drivers: calls out missing upgrades.
    - Trade-offs: notes dissatisfaction only if neither branch is met.
    - Boundaries: warns of crossed red lines.
    - Misclassifications: refutes player categorization errors and applies constant malus.
    Calculates dynamic pitch emotion deltas and commits updated emotions.

    On a re-pitch (`previous` holds an evaluated pitch) each stakeholder reacts to what changed for
    them: fine and unchanged means no emotion update at all; a standing objection builds one
    impatience step (none when `free_repeat`); an answered one releases it down to one step and
    earns a little relief. Impatience is never written into emotions, reads derive it.
    """
    room = room or []
    current_emotions = current_emotions or {}
    if changes is None:
        card_item_ids = kwargs.get("card_item_ids", set())
        trade_off_branches = kwargs.get("trade_off_branches", {})
        if card_item_ids:
            slotted_items = card_items(all_intel, card_item_ids)
            changes = card_ops(slotted_items, trade_off_branches=trade_off_branches, graph=graph, state=state)
        else:
            changes = []

    names = names or {}
    room_ids = [st_entry[0] for st_entry in room]

    tuning = EmotionFactory.get_pitch_tuning()
    prior = previous if previous is not None and previous.reaction_signatures else None
    prior_objecting = {o.stakeholder_id for o in prior.objections} if prior else set()
    # Hand the Pen: the holder's trust/control bonus is paid once, on the evaluate right after
    # `merge_pen_into_card` reveals the draft (not every evaluate from then on).
    pen_state = previous.pen if previous else None
    pen_bonus_due = pen_state is not None and pen_state.revealed and not pen_state.bonus_paid

    ops = atomic_changes_to_ops(graph, state, changes)
    # Judge alignment on what the card actually delivers, not what it asks for: a raise_to op is
    # capped to one rung per slot (resolve_step_cap), so a Driver/Trade-off naming a level past
    # the next rung must only get credit for the rung the card really reaches.
    after = apply_ops(graph, state, ops).state if ops else state
    card_atoms: set[str] = set()
    target_levels: dict[tuple[str, str], int] = {}
    for op in ops:
        if op.kind in ("raise_to", "set_to") and op.axis:
            achieved = after.value(op.target, op.axis)
            card_atoms.add(f"{op.kind}({op.target}, {achieved})")
            target_levels[(op.target, op.axis)] = achieved
        else:
            card_atoms.add(f"{op.kind}({op.target}, {op.value})")

    # Detect boundary violations
    warnings = boundary_checks(graph, state, all_intel, changes, room_ids)
    violated_map: dict[str, list[BoundaryWarning]] = {}
    for w in warnings:
        if w.violated and w.stakeholder_id:
            violated_map.setdefault(w.stakeholder_id, []).append(w)

    objections: list[Objection] = []
    feedback: list[PitchFeedbackMessage] = []
    accumulated_deltas: dict[str, dict[str, float]] = {}
    reaction_signatures: dict[str, dict[str, float]] = {}
    impatience: dict[str, int] = {}
    repeat_context: dict[str, str] = {}
    items_to_correct: list[str] = []
    agreeing: set[str] = set()

    # Map held items by stakeholder
    held_by_st: dict[str, list] = {}
    for h_item in (held_items or []):
        st_owner = getattr(h_item, "stakeholder_id", None) or (h_item.get("stakeholder_id") if isinstance(h_item, dict) else None)
        if st_owner:
            held_by_st.setdefault(st_owner, []).append(h_item)

    for room_entry in room:
        st_id = room_entry[0]
        power = room_entry[1]
        interest = room_entry[2] if len(room_entry) > 2 else "high"
        st_intel = [i for i in all_intel if getattr(i, "stakeholder_id", None) == st_id]
        
        # 1. Check violated boundaries
        st_violations = violated_map.get(st_id, [])
        for v in st_violations:
            item = next((i for i in st_intel if getattr(i, "id", None) == v.item_id), None)
            item_desc = getattr(item, "description", None) if item else None
            target_label = (v.target or "").replace("req.", "").replace("_", " ") if v.target else "my boundary condition"
            msg_text = f"This violates my boundary constraint: '{item_desc}'." if item_desc else f"This crosses a hard boundary for me regarding {target_label}! I cannot sign off on this."
            obj = Objection(
                kind="boundary",
                stakeholder_id=st_id,
                item_id=v.item_id,
                target=v.target,
                text=msg_text,
                hard=True,
            )
            objections.append(obj)
            feedback.append(PitchFeedbackMessage(
                stakeholder_id=st_id,
                text=obj.text,
                kind="feedback",
            ))

        # 2. Check unaddressed Drivers
        drivers = [i for i in st_intel if getattr(i, "type", None) in (IntelTag.DRIVER, "driver")]
        unaddressed_drivers = [d for d in drivers if not is_driver_satisfied(d, card_atoms, target_levels)]
        for d in unaddressed_drivers:
            target = getattr(getattr(d, "suggested", None), "target", None)
            desc = getattr(d, "description", "")
            target_label = target.replace("req.", "").replace("_", " ") if target else "my required component"
            msg_text = f"The proposal neglects my demand: '{desc}'." if desc else f"The proposal completely neglects my demand for {target_label}."
            obj = Objection(
                kind="driver",
                stakeholder_id=st_id,
                item_id=d.id,
                target=target,
                text=msg_text,
                hard=False,
            )
            objections.append(obj)
            feedback.append(PitchFeedbackMessage(
                stakeholder_id=st_id,
                text=obj.text,
                kind="feedback",
            ))

        # 3. Check unaddressed Trade-offs (neither branch addressed)
        trade_offs = [i for i in st_intel if getattr(i, "type", None) in (IntelTag.TRADE_OFF, "trade_off")]
        unaddressed_trade_offs = [t for t in trade_offs if not is_trade_off_satisfied(t, card_atoms, target_levels, state)]
        for t in unaddressed_trade_offs:
            obj = Objection(
                kind="trade_off",
                stakeholder_id=st_id,
                item_id=t.id,
                text="Neither my primary demand nor my compromise was addressed in the proposal.",
                hard=False,
            )
            objections.append(obj)
            feedback.append(PitchFeedbackMessage(
                stakeholder_id=st_id,
                text=obj.text,
                kind="feedback",
            ))

        # 4. Check misclassified items held by player for this stakeholder
        st_held = held_by_st.get(st_id, [])
        st_misclass_malus: dict[str, float] = {}
        for h_item in st_held:
            h_id = getattr(h_item, "id", None) or (h_item.get("id") if isinstance(h_item, dict) else "")
            true_item = next((i for i in st_intel if getattr(i, "id", None) == h_id), None)
            if true_item:
                true_type = getattr(true_item, "type", None)
                if hasattr(true_type, "value"):
                    true_type = true_type.value
                cat_type = getattr(h_item, "categorized_type", getattr(h_item, "type", None)) or (h_item.get("categorized_type") if isinstance(h_item, dict) else None)
                if hasattr(cat_type, "value"):
                    cat_type = cat_type.value
                intel_type = getattr(h_item, "intel_type", None) or (h_item.get("intel_type") if isinstance(h_item, dict) else None)
                if hasattr(intel_type, "value"):
                    intel_type = intel_type.value

                if cat_type and true_type and str(cat_type).lower() != str(true_type).lower():
                    malus = get_misclassification_malus(str(true_type), str(cat_type))
                    for dim, m_val in malus.items():
                        st_misclass_malus[dim] = round(st_misclass_malus.get(dim, 0.0) + m_val, 4)
                    items_to_correct.append(h_id)
                    desc = getattr(h_item, "description", "") or (h_item.get("description", "") if isinstance(h_item, dict) else "")
                    feedback.append(PitchFeedbackMessage(
                        stakeholder_id=st_id,
                        text=f"You completely misjudged my stance on '{desc}'! That is a {true_type}, not a {cat_type}.",
                        kind="refutation",
                    ))
                    objections.append(Objection(
                        kind="misclassification",
                        stakeholder_id=st_id,
                        item_id=h_id,
                        text=f"Misclassification refutation: '{desc}' is a {true_type}, not a {cat_type}.",
                        hard=False,
                    ))

        # Positive approval message if no objections or misclassifications
        is_agreeing = not st_violations and not unaddressed_drivers and not unaddressed_trade_offs and not st_misclass_malus
        if is_agreeing:
            agreeing.add(st_id)
            feedback.append(PitchFeedbackMessage(
                stakeholder_id=st_id,
                text="The proposal looks aligned with my priorities. I'm on board.",
                kind="approval",
            ))

        # Calculate continuous demand alignment & pitch deltas
        align = calculate_demand_alignment_for_changes(
            stakeholder_reqs=st_intel,
            card_atoms=card_atoms,
            target_levels=target_levels,
            state=state,
        )
        if is_agreeing:
            align = 1.0
        react = calculate_reactivity(power, interest=interest)
        st_obj = StakeholderFactory.get_stakeholder(st_id)
        role_sens = getattr(st_obj, "emotion_sensitivities", {}) if st_obj else {}
        steps = prior.impatience.get(st_id, 0) if prior else 0
        weights = calculate_dynamic_weights(st_id, st_intel, role_sensitivities=role_sens)
        deltas = calculate_pitch_deltas(
            alignment=align,
            reactivity=react,
            violated_boundary_count=len(st_violations),
            weights=weights,
        )

        # Apply misclassification malus
        for dim, m_val in st_misclass_malus.items():
            deltas[dim] = round(deltas.get(dim, 0.0) + m_val, 4)

        # Hand the Pen: the holder's one-time trust/control bonus, more the lower their trust was.
        if pen_bonus_due and st_id == pen_state.stakeholder_id:
            deltas["trust"] = round(deltas.get("trust", 0.0) + tuning.pen_trust_gain.get(pen_state.band, 0.0) * react, 4)
            deltas["sense_of_control"] = round(
                deltas.get("sense_of_control", 0.0) + tuning.pen_control_gain.get(pen_state.band, 0.0) * react, 4
            )

        reaction_signatures[st_id] = dict(deltas)

        if prior and st_id in prior.reaction_signatures:
            was_objecting = st_id in prior_objecting
            unchanged = prior.reaction_signatures[st_id] == reaction_signatures[st_id]
            if not was_objecting and not is_agreeing:
                pass  # a new objection, not a repeat: normal delta, no impatience yet
            elif not was_objecting:
                steps = 0
                if unchanged:
                    repeat_context[st_id] = "quiet"
                    deltas = {}
            elif is_agreeing:
                repeat_context[st_id] = "answered"
                steps = min(steps, 1)
                relief = round(tuning.impatience_relief * _patience_scale(role_sens), 4)
                for dim in ("trust", "fairness"):
                    deltas[dim] = round(deltas.get(dim, 0.0) + relief, 4)
            else:
                repeat_context[st_id] = "unchanged" if unchanged else "changed_unanswered"
                if not free_repeat:
                    steps = min(tuning.impatience_cap, steps + 1)

        impatience[st_id] = steps
        accumulated_deltas[st_id] = deltas

    # Confirmed allies (case board, D3): an agreeing backer warms the one they stand with, once per
    # pitch. After the signatures above are recorded, so the re-pitch "quiet" logic is untouched.
    ally_lifts: dict[str, list[str]] = {}
    lift = tuning.ally_lift
    for rel in confirmed_relations or []:
        if rel.kind != "ally":
            continue
        for backer, other in ((rel.a, rel.b), (rel.b, rel.a)):
            if backer in agreeing and other in room_ids and other not in ally_lifts and repeat_context.get(other) != "quiet":
                ally_lifts[other] = [backer]
                boosted = dict(accumulated_deltas.get(other, {}))
                for dim in ("trust", "fairness"):
                    boosted[dim] = round(boosted.get(dim, 0.0) + lift, 4)
                accumulated_deltas[other] = boosted

    # Update emotions with deltas
    updated_emotions: dict[str, dict[str, float]] = {}
    for st_id in room_ids:
        ev = current_emotions.get(st_id, EmotionFactory.create_default_emotion_values(0.5))
        delta_vec = accumulated_deltas.get(st_id, {})
        updated_emotions[st_id] = apply_emotion_delta(ev, delta_vec)

    view = card_view(
        graph=graph,
        state=state,
        all_intel=all_intel,
        changes=changes,
        room=room,
        emotion_values=updated_emotions,
        impatience=impatience,
    )

    valid_atomic_changes: list[AtomicChange] = []
    for c in changes:
        if isinstance(c, AtomicChange):
            valid_atomic_changes.append(c)
        elif isinstance(c, GraphOp):
            valid_atomic_changes.append(AtomicChange(target=c.target, kind=c.kind, axis=c.axis, value=c.value))
        elif isinstance(c, dict) and "target" in c:
            valid_atomic_changes.append(AtomicChange(
                target=c["target"],
                kind=c.get("kind", "raise_to"),
                axis=c.get("axis"),
                value=c.get("value"),
                trigger=c.get("trigger"),
            ))
        else:
            tgt, lvl, ax = _extract_target_and_level(c, graph, state)
            if tgt:
                valid_atomic_changes.append(AtomicChange(target=tgt, kind="raise_to", axis=ax, value=lvl))

    new_pitch_state = PitchState(
        stage="PITCHED",
        atomic_changes=valid_atomic_changes,
        objections=objections,
        feedback_messages=feedback,
        emotion_deltas=accumulated_deltas,
        outcome=view.outcome,
        presentation_count=presentation_count,
        last_pitched_changes=valid_atomic_changes,
        reaction_signatures=reaction_signatures,
        impatience=impatience,
        repeat_context=repeat_context,
        free_repeat_used=bool(previous and previous.free_repeat_used) or free_repeat,
        ally_lifts=ally_lifts,
        pen=(pen_state.model_copy(update={"bonus_paid": True}) if pen_bonus_due else pen_state),
        pen_used=list(previous.pen_used) if previous else [],
    )
    return new_pitch_state, view, items_to_correct


_AXIS_LEVEL_WORDS: dict[Axis, tuple[str, ...]] = {
    "automation": ("broken", "absent", "manual", "automated"),
    "governance": ("not reviewed", "partially reviewed", "mostly reviewed", "fully governed"),
}


def _axis_level_word(axis: Axis, value: int) -> str:
    words = _AXIS_LEVEL_WORDS[axis]
    return words[value] if 0 <= value < len(words) else str(value)


def _describe_change(graph: TechnicalGraph, change: "AtomicChange") -> Optional[str]:
    """A short player-facing phrase for one proposed graph change, e.g. "raising Data Validation
    to Automated" - without this, the commit event can only say the room's verdict, never what
    it was a verdict *on*."""
    target = change.target
    name: Optional[str] = None
    if graph.is_component(target):
        name = graph.component(target).name
    elif graph.is_edge(target):
        name = getattr(graph.edge(target), "name", None) or target
    if not name:
        return None
    if change.kind == "raise_to" and isinstance(change.value, int) and change.axis:
        level_name = _axis_level_word(change.axis, change.value)
        return f"raising {name}'s {change.axis} to {level_name}"
    if change.trigger:
        return f"changing {name}'s trigger to {change.trigger}"
    return f"changing {name}"


def _final_changes(changes: list["AtomicChange"]) -> list["AtomicChange"]:
    """Collapses a target chained through several raise_to steps on the same axis (one authored
    option per rung, each its own slot) down to the one that actually lands: the last one. Without
    this, "raising X to manual and raising X to automated" reads as two separate, contradictory
    commitments instead of the one the card actually settles on."""
    final_by_key: dict[tuple[str, Optional[str]], "AtomicChange"] = {}
    order: list[tuple[str, Optional[str]]] = []
    passthrough: list["AtomicChange"] = []
    for c in changes:
        if isinstance(c.value, int) and c.axis:
            key = (c.target, c.axis)
            if key not in final_by_key:
                order.append(key)
            final_by_key[key] = c
        else:
            passthrough.append(c)
    return [final_by_key[key] for key in order] + passthrough


def _changes_summary(graph: Optional[TechnicalGraph], changes: list["AtomicChange"]) -> str:
    """Every proposed change, joined for a sentence - falls back to "your proposal" when the
    graph is not available (defensive: every real caller has one) or nothing in it is nameable."""
    if not graph or not changes:
        return "your proposal"
    parts = [d for d in (_describe_change(graph, c) for c in _final_changes(changes)) if d]
    if not parts:
        return "your proposal"
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def commit_pitch(
    state: PitchState,
    view: CardView,
    names: Optional[dict[str, str]] = None,
    graph: Optional[TechnicalGraph] = None,
) -> tuple[PitchState, list[GameEvent]]:
    """Locks in the pitch outcome upon player commit."""
    names = names or {}
    updated = state.model_copy(update={
        "stage": "DONE",
        "outcome": view.outcome,
    })
    change = _changes_summary(graph, state.atomic_changes)
    events: list[GameEvent] = []
    if view.outcome == "VETO":
        # A stood veto never reaches the simulator (`_outcome_for`'s own comment: "a veto that
        # was never broken never gets here") - nothing gets applied, so this has no simulation
        # to lead into. It stays its own beat, not folded into a step that never happens.
        events.append(GameEvent(
            step="commit", kind="outcome", subject_id=None,
            cause="outcome.veto", params={"st": "the room", "change": change},
        ))
    elif view.outcome == "SOFT_PASS":
        # Everything else here does reach the simulator, so it's logged as `simulation`'s own
        # opening line - "here's the card that got applied" - rather than a separate step the
        # log then has to visually reconnect to what follows from it.
        events.append(GameEvent(
            step="simulation", kind="outcome", subject_id=None,
            cause="outcome.soft_pass", params={"change": change},
        ))
    else:
        events.append(GameEvent(
            step="simulation", kind="outcome", subject_id=None,
            cause="outcome.pass", params={"change": change},
        ))
    return updated, events


def veto_breaker(
    state: PitchState,
    overridden_stakeholder_id: str,
    names: Optional[dict[str, str]] = None,
) -> tuple[PitchState, list[GameEvent]]:
    """Spends an Escalation Point to push a stood veto through anyway (D15).

    Only callable on a committed VETO (the caller checks `state.stage == "DONE" and state.outcome
    == "VETO"` first): this pushes *that* card through, it does not build a new one. The
    overridden stakeholder remembers it - `overridden_stakeholder_id` is the one field this sets
    beyond the outcome, and it is the whole signal `simulation_handler` needs to tell the pipeline
    this PASS was actually a broken veto. The pipeline side of that (a weight-2 grudge, degrading
    whatever the card touched that the stakeholder owns, a distinct story beat) was never removed
    and needed no changes; only this link back from the pitch phase had gone missing.
    """
    names = names or {}
    malus = EmotionFactory.get_pitch_tuning().emotion_veto_breaker
    updated = state.model_copy(update={
        "stage": "DONE",
        "outcome": "PASS",
        "overridden_stakeholder_id": overridden_stakeholder_id,
    })
    events = [
        # This always resolves to PASS and does proceed to simulate (unlike a stood veto), so it
        # belongs with `commit_pitch`'s own PASS/SOFT_PASS events under `simulation`.
        GameEvent(
            step="simulation", kind="emotion", subject_id=overridden_stakeholder_id,
            direction="down" if malus < 0 else ("up" if malus > 0 else "none"),
            magnitude="large",
            cause="emotion.veto_breaker", params={"st": _name(names, overridden_stakeholder_id)},
        ),
        GameEvent(
            step="simulation", kind="outcome", subject_id=overridden_stakeholder_id,
            cause="outcome.veto_breaker", params={"st": _name(names, overridden_stakeholder_id)},
        ),
    ]
    return updated, events


def table_it(state: PitchState) -> tuple[PitchState, list[GameEvent]]:
    """Gives up on the room: the challenge ends in a stalemate without spending an Escalation Point.

    Only callable on a committed VETO. Nothing is agreed and no card goes in; the pipeline fires the
    challenge's stalemate events and every low-power stakeholder keeps a grudge. It exists so a room
    that no card can clear never leaves the player stuck once their Escalation Points are gone.
    """
    updated = state.model_copy(update={"stage": "DONE", "outcome": "STALEMATE"})
    events = [GameEvent(step="simulation", kind="outcome", cause="outcome.stalemate")]
    return updated, events


def _name(names: dict[str, str], st_id: Optional[str]) -> str:
    return names.get(st_id, st_id) if st_id else "them"


def compute_stakeholder_primary_objection(
    st_id: str,
    st_intel: list,
    changes: list[AtomicChange],
    card_atoms: set[str],
    violated_boundaries: list[BoundaryWarning],
    graph: Optional[TechnicalGraph] = None,
    state: Optional[GraphState] = None,
) -> dict[str, Any]:
    """Computes a stakeholder's primary assessment / most pressing objection."""
    target_levels = {}
    if graph and state:
        ops = atomic_changes_to_ops(graph, state, changes)
        target_levels = {(op.target, op.axis): int(op.value) for op in ops if op.kind in ("raise_to", "set_to")}

    # 1. Check for violated boundaries
    if violated_boundaries:
        v = violated_boundaries[0]
        item = next((i for i in st_intel if getattr(i, "id", None) == v.item_id), None)
        item_desc = getattr(item, "description", None) if item else None
        _, b_level, b_axis = item_target_and_level(item) if item else (None, None, None)
        target_name = (v.target or "").replace("req.", "").replace("_", " ") if v.target else "my boundary condition"
        if item_desc:
            detail = f"This violates my boundary constraint: '{item_desc}'."
        else:
            detail = f"This crosses a hard boundary for me regarding {target_name}! I cannot sign off on this."
        return {
            "item_id": v.item_id,
            "objection_kind": "boundary",
            "objection_detail": detail,
            "objection_target": v.target,
            "objection_level": b_level,
            "objection_axis": b_axis,
            "distance": 1.0,
            "is_approval": False,
        }

    # 2. Compute distance for stance requirements (Drivers and Trade-offs)
    candidates: list[tuple[float, str, str, str, Optional[str], Optional[int], Optional[str]]] = []

    for req in st_intel:
        r_type = getattr(req, "type", None) or (req.get("type") if isinstance(req, dict) else None)
        if hasattr(r_type, "value"):
            r_type = r_type.value
        r_id = getattr(req, "id", None) or (req.get("id") if isinstance(req, dict) else "")

        if r_type in (IntelTag.DRIVER, "driver"):
            is_sat = is_driver_satisfied(req, card_atoms, target_levels)
            dist = 0.0 if is_sat else 1.0
            target = getattr(getattr(req, "suggested", None), "target", None)
            desc = getattr(req, "description", "") or (req.get("description", "") if isinstance(req, dict) else "")
            target_label = target.replace("req.", "").replace("_", " ") if target else "my required component"
            detail = f"The proposal neglects my demand: '{desc}'." if desc else f"The proposal completely neglects my demand for {target_label}."
            if dist > 0.0:
                sugg = getattr(req, "suggested", None)
                candidates.append((dist, r_id, "driver", detail, target,
                                   getattr(sugg, "level", None), getattr(sugg, "axis", None)))

        elif r_type in (IntelTag.TRADE_OFF, "trade_off"):
            is_sat = is_trade_off_satisfied(req, card_atoms, target_levels, state)
            dist = 0.0 if is_sat else 1.0
            detail = "Neither my primary demand nor my compromise was addressed in the proposal."
            if dist > 0.0:
                candidates.append((dist, r_id, "trade_off", detail, None, None, None))

    if candidates:
        candidates.sort(key=lambda c: c[0], reverse=True)
        max_dist, item_id, kind, detail, target, level, axis = candidates[0]
        return {
            "item_id": item_id,
            "objection_kind": kind,
            "objection_detail": detail,
            "objection_target": target,
            "objection_level": level,
            "objection_axis": axis,
            "distance": max_dist,
            "is_approval": False,
        }

    return {
        "item_id": None,
        "objection_kind": "none",
        "objection_detail": "The proposal looks aligned with my priorities. I'm on board.",
        "objection_target": None,
        "objection_level": None,
        "objection_axis": None,
        "distance": 0.0,
        "is_approval": True,
    }

