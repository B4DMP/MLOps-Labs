"""Pitch phase orchestration (plan 06): what sits between the player's card and the outcome.

Pure over its inputs. The caller hands in the graph, the player's graph state, the room and the
ground truth intel of the challenge; it gets back predictions for the builder, the objections that
fire, and the committed outcome. Persistence, websockets and emotion writes stay in the handler,
so all of this is testable without a database.

Nothing here asks an LLM anything: same card, same objections, same outcome (standing rule).
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.application.pitch_debate_service.objections import (
    Objection,
    DialogueOptionSpec,
    dialogue_options_for,
    fire_objections,
)
from mlops_serious_game.application.pitch_debate_service.scoring import (
    buy_in,
    coverage,
    emotions_norm,
    fit,
    loss,
    outcome,
)
from mlops_serious_game.domain.graph import GraphOp, GraphState, Knowledge, TechnicalGraph
from mlops_serious_game.domain.graph_predicates import PredicateError, evaluate
from mlops_serious_game.domain.requirement import IntelTag

MAX_CARD_ITEMS = 5
DEFAULT_MAX_AMENDMENTS = 3
DEFAULT_PATIENCE = 2
MIN_REBUILD_DELTA = 2
RISK_GREEN = 0.6
RISK_AMBER = 0.4


class ItemPrediction(BaseModel):
    """What one slotted item would do, as far as the player can tell."""

    item_id: str
    target: Optional[str] = None
    asked: Optional[int] = None
    predicted: Optional[int] = Field(default=None, description="None when the player cannot know yet")
    capped_by: Optional[str] = None
    known: bool = True


class BoundaryWarning(BaseModel):
    item_id: str
    stakeholder_id: Optional[str] = None
    target: Optional[str] = None
    checkable: bool = True
    violated: bool = False


class StakeholderRead(BaseModel):
    """One stakeholder's standing against the current card."""

    stakeholder_id: str
    power: str
    coverage: float
    loss: float
    fit: float
    emotions: float
    buy_in: float
    band: str
    boundary_violated: bool = False


class CardView(BaseModel):
    """Everything the builder and the commit screen need about the current card."""

    predictions: list[ItemPrediction] = Field(default_factory=list)
    boundary_warnings: list[BoundaryWarning] = Field(default_factory=list)
    uncompensated_losses: dict[str, float] = Field(default_factory=dict)
    reads: list[StakeholderRead] = Field(default_factory=list)
    outcome: str = "PASS"


def risk_band(value: float) -> str:
    if value >= RISK_GREEN:
        return "green"
    if value >= RISK_AMBER:
        return "amber"
    return "red"


def card_items(all_intel: list, card_item_ids: set[str]) -> list:
    return [i for i in all_intel if i.id in card_item_ids]


def card_ops(items: list) -> list[GraphOp]:
    """The card's ops are the union of its items' ops, in slot order."""
    ops: list[GraphOp] = []
    for item in items:
        for raw in getattr(item, "ops", None) or []:
            ops.append(GraphOp.model_validate({**raw, "source_kind": "action_card"}))
        suggested = getattr(item, "suggested", None)
        if suggested and getattr(suggested, "target", None) and not getattr(item, "ops", None):
            ops.append(GraphOp(
                kind="raise_to", target=suggested.target, value=suggested.level, source_kind="action_card"
            ))
    return ops


def predicted_state(graph: TechnicalGraph, state: GraphState, items: list) -> GraphState:
    """The graph as it would be right after this card, without writing anything."""
    ops = card_ops(items)
    return apply_ops(graph, state, ops).state if ops else state


def _item_target_and_level(item) -> tuple[Optional[str], Optional[int]]:
    suggested = getattr(item, "suggested", None)
    if suggested and getattr(suggested, "target", None):
        return suggested.target, getattr(suggested, "level", None)
    for raw in getattr(item, "ops", None) or []:
        if raw.get("target"):
            op = GraphOp.model_validate({**raw, "source_kind": "action_card"})
            return op.target, op.value if isinstance(op.value, int) else None
    return None, None


def _effective_of(effective, target: str) -> Optional[int]:
    if target in effective.components:
        return effective.components[target]
    return effective.edges.get(target)


def predictions_for(
    graph: TechnicalGraph,
    state: GraphState,
    items: list,
    knowledge: Optional[Knowledge] = None,
) -> list[ItemPrediction]:
    """Predicted effective level per raising item, from what the player knows (plan 06).

    A target the player has never observed comes back with `predicted=None`: the builder shows a
    question mark rather than leaking ground truth.
    """
    after = predicted_state(graph, state, items)
    effective = evaluate_graph(graph, after).effective
    out: list[ItemPrediction] = []
    for item in items:
        target, asked = _item_target_and_level(item)
        if not target:
            continue
        known = knowledge is None or knowledge.state_of(target, after) != "unknown"
        eff = _effective_of(effective, target)
        out.append(ItemPrediction(
            item_id=item.id,
            target=target,
            asked=asked,
            predicted=eff if known else None,
            capped_by=effective.capped_by.get(target) if known else None,
            known=known,
        ))
    return out


def boundary_checks(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    items: list,
    room_st_ids: list[str],
    knowledge: Optional[Knowledge] = None,
) -> list[BoundaryWarning]:
    """Every Boundary of everyone in the room, slotted or not (D27), against the post-card graph."""
    after = predicted_state(graph, state, items)
    ctx = evaluate_graph(graph, after).context(graph, after)
    warnings: list[BoundaryWarning] = []
    for item in all_intel:
        if item.type != IntelTag.BOUNDARY or item.stakeholder_id not in room_st_ids:
            continue
        holds = getattr(item, "holds", None)
        if holds is None:
            continue
        target, _ = _item_target_and_level(item)
        if knowledge is not None and target and knowledge.state_of(target, after) == "unknown":
            warnings.append(BoundaryWarning(
                item_id=item.id, stakeholder_id=item.stakeholder_id, target=target, checkable=False
            ))
            continue
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


def capped_item_ids(graph: TechnicalGraph, state: GraphState, items: list) -> set[str]:
    """Card items whose target will not reach the level they ask for, because of upstream."""
    capped: set[str] = set()
    for pred in predictions_for(graph, state, items):
        if pred.asked is not None and pred.predicted is not None and pred.predicted < pred.asked:
            capped.add(pred.item_id)
    return capped


def objections_for(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    card_item_ids: set[str],
    room_st_ids: list[str],
    authored: dict,
    max_per_stakeholder: int = 2,
) -> list[Objection]:
    """Fires the deterministic objections against ground truth (stakeholders are never fogged)."""
    items = card_items(all_intel, card_item_ids)
    violated = {
        w.item_id for w in boundary_checks(graph, state, all_intel, items, room_st_ids) if w.violated
    }
    return fire_objections(
        room_st_ids=room_st_ids,
        all_intel=all_intel,
        card_item_ids=card_item_ids,
        violated_boundary_ids=violated,
        capped_item_ids=capped_item_ids(graph, state, items),
        authored=authored,
        max_per_stakeholder=max_per_stakeholder,
    )


def answering_item_ids(objection: Objection, held_items: list, card_item_ids: set[str]) -> set[str]:
    """Items in hand that answer this objection: the only way to build a compromise (D23)."""
    wanted = {
        "stance": IntelTag.DRIVER,
        "boundary": IntelTag.BOUNDARY,
        "price": IntelTag.TRADE_OFF,
        "technical": IntelTag.FACT,
    }.get(objection.kind)
    if objection.kind == "correction":
        return {objection.item_id} if objection.item_id else set()
    if wanted is None:
        return set()
    out = set()
    for item in held_items:
        if item.id in card_item_ids or item.type != wanted:
            continue
        if objection.kind in ("stance", "price") and item.stakeholder_id != objection.stakeholder_id:
            continue
        out.add(item.id)
    return out


def options_for(
    objection: Objection,
    held_items: list,
    card_item_ids: set[str],
    escalation_points: int,
    amendments_left: int,
) -> list[DialogueOptionSpec]:
    return dialogue_options_for(
        objection=objection,
        answering_item_ids=answering_item_ids(objection, held_items, card_item_ids),
        escalation_points=escalation_points,
        amendment_budget=amendments_left,
        card_size=len(card_item_ids),
        max_card_size=MAX_CARD_ITEMS,
    )


def stakeholder_reads(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    card_item_ids: set[str],
    room: list[tuple[str, str]],
    archetypes: dict[str, Any],
    main_archetype: Optional[Any],
    secondary_archetype: Optional[Any],
    emotion_values: dict[str, dict[str, float]],
) -> list[StakeholderRead]:
    """Buy-in per stakeholder in the room. `room` is (stakeholder_id, power) pairs."""
    items = card_items(all_intel, card_item_ids)
    room_ids = [st_id for st_id, _ in room]
    violated_by_st: dict[str, bool] = {}
    for w in boundary_checks(graph, state, all_intel, items, room_ids):
        if w.violated and w.stakeholder_id:
            violated_by_st[w.stakeholder_id] = True

    reads: list[StakeholderRead] = []
    for st_id, power in room:
        cov = coverage(st_id, all_intel, card_item_ids)
        lo = loss(st_id, all_intel, card_item_ids)
        ft = fit(archetypes[st_id], main_archetype, secondary_archetype) if st_id in archetypes else 0.5
        em = emotions_norm(emotion_values.get(st_id, {}))
        bi = buy_in(cov, em, ft, lo)
        reads.append(StakeholderRead(
            stakeholder_id=st_id,
            power=power,
            coverage=round(cov, 3),
            loss=round(lo, 3),
            fit=round(ft, 3),
            emotions=round(em, 3),
            buy_in=round(bi, 3),
            band=risk_band(bi),
            boundary_violated=violated_by_st.get(st_id, False),
        ))
    return reads


def card_view(
    graph: TechnicalGraph,
    state: GraphState,
    all_intel: list,
    card_item_ids: set[str],
    room: list[tuple[str, str]],
    archetypes: dict[str, Any],
    main_archetype: Optional[Any] = None,
    secondary_archetype: Optional[Any] = None,
    emotion_values: Optional[dict[str, dict[str, float]]] = None,
    knowledge: Optional[Knowledge] = None,
) -> CardView:
    """One call for the builder and the risk read: predictions, warnings, losses, buy-in, outcome."""
    items = card_items(all_intel, card_item_ids)
    room_ids = [st_id for st_id, _ in room]
    reads = stakeholder_reads(
        graph, state, all_intel, card_item_ids, room, archetypes,
        main_archetype, secondary_archetype, emotion_values or {},
    )
    return CardView(
        predictions=predictions_for(graph, state, items, knowledge),
        boundary_warnings=boundary_checks(graph, state, all_intel, items, room_ids, knowledge),
        uncompensated_losses={
            st_id: round(loss(st_id, all_intel, card_item_ids), 3) for st_id in room_ids
        },
        reads=reads,
        outcome=outcome([(r.stakeholder_id, r.power, r.buy_in, r.boundary_violated) for r in reads]),
    )


def rebuild_is_material(previous_ids: set[str], new_ids: set[str], min_delta: int = MIN_REBUILD_DELTA) -> bool:
    """A rebuilt card has to differ by at least `min_delta` items, so patience buys a real change.

    Counted as changed slots, not as set difference: swapping one item for another is one change,
    which is what it looks like to the room.
    """
    return max(len(new_ids - previous_ids), len(previous_ids - new_ids)) >= min_delta
