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
    shift_emotions,
    fit,
    loss,
    outcome,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import GraphOp, GraphState, Knowledge, TechnicalGraph
from mlops_serious_game.domain.graph_predicates import PredicateError, evaluate
from mlops_serious_game.domain.requirement import IntelTag, item_target_and_level

MAX_CARD_ITEMS = 5
DEFAULT_MAX_AMENDMENTS = 3
DEFAULT_PATIENCE = 2
MIN_REBUILD_DELTA = 2
RISK_GREEN = 0.6
RISK_AMBER = 0.4

# D38: the tuned numbers behind fit/buy_in/outcome live in config (EmotionValueConfig.json's
# pitch_tuning), not code - scoring.py itself stays factory-free (its own "no factory calls"
# contract), so this module reads the config once and passes the values in explicitly below.
_TUNING = EmotionFactory.get_pitch_tuning()


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


def _effective_of(effective, target: str) -> Optional[int]:
    if target in effective.components:
        return effective.components[target]
    return effective.edges.get(target)


def _boundary_target(item) -> Optional[str]:
    """The component a Boundary's predicate actually reads, for the fog check.

    A pure Boundary usually carries no `suggested`/`ops` of its own; without this fallback its
    fog state can never be "unknown" and `boundary_checks` would reveal a ground-truth violation
    on a target the player has never observed (D11).
    """
    target, _ = item_target_and_level(item)
    if target:
        return target
    holds = getattr(item, "holds", None)
    return holds.get("component") if isinstance(holds, dict) else None


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
        target, asked = item_target_and_level(item)
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
        target = _boundary_target(item)
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
    held_items: Optional[list] = None,
) -> list[Objection]:
    """Fires the deterministic objections against ground truth (stakeholders are never fogged).

    Correction objections are the exception: only the player's own copy of an item carries the tag
    they filed it under, so slotted items are read from `held_items` where they exist. Without it
    every ground truth item would look mis-tagged.
    """
    held_by_id = {i.id: i for i in (held_items or []) if i.id in card_item_ids}
    all_intel = [held_by_id.get(i.id, i) for i in all_intel]
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
        # Amend never answers a mis-filed tag: only Concede Correction does. Returning the item
        # itself here would make `no_answer` false and wrongly light up Amend, which would then
        # let any unrelated held item clear the objection (session.answer_objection only checks
        # that the item is not already on the card).
        return set()
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
        ft = (
            fit(archetypes[st_id], main_archetype, secondary_archetype, secondary_malus=_TUNING.secondary_malus)
            if st_id in archetypes else 0.5
        )
        em = emotions_norm(emotion_values.get(st_id, {}))
        bi = buy_in(cov, em, ft, lo, loss_w=_TUNING.loss_w)
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
        outcome=outcome(
            [(r.stakeholder_id, r.power, r.buy_in, r.boundary_violated) for r in reads],
            veto_threshold=_TUNING.veto_threshold,
            objection_threshold=_TUNING.objection_threshold,
        ),
    )


# How much one answer moves the room. Tunable, deliberately small: the pitch is decided by
# coverage and Boundaries, emotions only tip the close calls. D38: sourced from config
# (EmotionValueConfig.json's pitch_tuning) via _TUNING above, falling back to the pre-D38 values
# baked into domain.emotion.PitchTuning if config omits pitch_tuning.
EMOTION_STONEWALL = _TUNING.emotion_stonewall
EMOTION_STONEWALL_ALLY = _TUNING.emotion_stonewall_ally
EMOTION_REFRAME = _TUNING.emotion_reframe
EMOTION_ADDENDUM = _TUNING.emotion_addendum
EMOTION_CONCEDE = _TUNING.emotion_concede
EMOTION_VETO_BREAKER = _TUNING.emotion_veto_breaker
EMOTION_CONCEDE_WIN = _TUNING.emotion_concede_win  # D41: the side that gets its way
EMOTION_CONCEDE_LOSE = _TUNING.emotion_concede_lose  # D41: the side whose card was dropped


class PitchState(BaseModel):
    """The whole pitch, as it is carried between messages and stored per challenge.

    Everything needed to redo the screen is in here, so a refresh or a reconnect resumes exactly
    where the player was. The graph is not touched before COMMIT (plan 06).
    """

    stage: str = "PREPARE"  # PREPARE, OBJECT, COMMIT, DONE
    card_item_ids: list[str] = Field(default_factory=list)
    main_archetype: Optional[str] = None
    secondary_archetype: Optional[str] = None
    objections: list[Objection] = Field(default_factory=list)
    resolved: dict[str, str] = Field(default_factory=dict, description="objection id to the option used")
    amendments_used: int = 0
    max_amendments: int = DEFAULT_MAX_AMENDMENTS
    patience: dict[str, int] = Field(default_factory=dict)
    rebuilds: int = 0
    conceded_item_ids: list[str] = Field(default_factory=list)
    emotion_deltas: dict[str, float] = Field(default_factory=dict)
    outcome: Optional[str] = None

    @property
    def amendments_left(self) -> int:
        return max(0, self.max_amendments - self.amendments_used)

    def open_objections(self) -> list[Objection]:
        return [o for o in self.objections if o.id not in self.resolved]


class AnswerResult(BaseModel):
    state: PitchState
    cleared: bool = False
    spent_escalation_point: bool = False
    rejected: Optional[str] = Field(default=None, description="Why the answer did not apply")


def start_pitch(room_st_ids: list[str], patience: int = DEFAULT_PATIENCE) -> PitchState:
    return PitchState(patience={st_id: patience for st_id in room_st_ids})


def set_card(
    state: PitchState,
    item_ids: list[str],
    main_archetype: Optional[str] = None,
    secondary_archetype: Optional[str] = None,
) -> tuple[PitchState, Optional[str]]:
    """PREPARE only. A card is 1 to 5 intel items in any mix (D27)."""
    if state.stage != "PREPARE":
        return state, "the card is locked once the room starts objecting"
    unique = list(dict.fromkeys(item_ids))
    if not 1 <= len(unique) <= MAX_CARD_ITEMS:
        return state, f"a card holds 1 to {MAX_CARD_ITEMS} items"
    if state.rebuilds and not rebuild_is_material(set(state.card_item_ids), set(unique)):
        return state, f"a rebuilt card has to change at least {MIN_REBUILD_DELTA} items"
    updated = state.model_copy(update={
        "card_item_ids": unique,
        "main_archetype": main_archetype if main_archetype is not None else state.main_archetype,
        "secondary_archetype": secondary_archetype if secondary_archetype is not None else state.secondary_archetype,
    })
    return updated, None


def open_objection_round(state: PitchState, objections: list[Objection]) -> PitchState:
    return state.model_copy(update={"stage": "OBJECT", "objections": objections})


def _bump(deltas: dict[str, float], st_id: Optional[str], amount: float) -> dict[str, float]:
    if not st_id:
        return deltas
    out = dict(deltas)
    out[st_id] = round(out.get(st_id, 0.0) + amount, 3)
    return out


def answer_objection(
    state: PitchState,
    objection_id: str,
    option: str,
    escalation_points: int,
    available: set[str],
    item_id: Optional[str] = None,
    opposing_st_id: Optional[str] = None,
) -> AnswerResult:
    """Applies one dialogue option. `available` is what `options_for` allowed for this objection."""
    objection = next((o for o in state.objections if o.id == objection_id), None)
    if objection is None or objection_id in state.resolved:
        return AnswerResult(state=state, rejected="that objection is not open")
    if option not in available:
        return AnswerResult(state=state, rejected="that option is not available here")

    deltas = state.emotion_deltas
    card = list(state.card_item_ids)
    amendments = state.amendments_used
    conceded = list(state.conceded_item_ids)
    cleared = False
    spent_point = False

    if option == "amend":
        if not item_id or item_id in card:
            return AnswerResult(state=state, rejected="pick an intel item that is not on the card yet")
        card.append(item_id)
        amendments += 1
        cleared = True
    elif option == "reframe":
        deltas = _bump(deltas, objection.stakeholder_id, EMOTION_REFRAME)
        cleared = objection.kind == "stance"
    elif option == "stonewall":
        deltas = _bump(deltas, objection.stakeholder_id, EMOTION_STONEWALL)
        deltas = _bump(deltas, opposing_st_id, EMOTION_STONEWALL_ALLY)
        cleared = True  # the objection stands, but the room moves on
    elif option == "emergency_addendum":
        if escalation_points <= 0:
            return AnswerResult(state=state, rejected="no Escalation Points left")
        deltas = _bump(deltas, objection.stakeholder_id, EMOTION_ADDENDUM)
        spent_point = True
        amendments += 1
        cleared = True
    elif option == "concede_correction":
        if objection.item_id:
            conceded.append(objection.item_id)
        deltas = _bump(deltas, objection.stakeholder_id, EMOTION_CONCEDE)
        cleared = True

    resolved = dict(state.resolved)
    resolved[objection_id] = option
    updated = state.model_copy(update={
        "card_item_ids": card,
        "amendments_used": amendments,
        "conceded_item_ids": conceded,
        "emotion_deltas": deltas,
        "resolved": resolved,
    })
    return AnswerResult(state=updated, cleared=cleared, spent_escalation_point=spent_point)


def commit_pitch(state: PitchState, view: CardView) -> PitchState:
    """Locks in the outcome. The caller applies the ops and writes the grudges."""
    return state.model_copy(update={
        "stage": "DONE" if view.outcome != "VETO" else "COMMIT",
        "outcome": view.outcome,
    })


def veto_breaker(state: PitchState, escalation_points: int, vetoing_st_ids: list[str]) -> AnswerResult:
    """One Escalation Point pushes the card through. The overridden stakeholder remembers it (D7)."""
    if escalation_points <= 0:
        return AnswerResult(state=state, rejected="no Escalation Points left")
    deltas = state.emotion_deltas
    patience = dict(state.patience)
    for st_id in vetoing_st_ids:
        deltas = _bump(deltas, st_id, EMOTION_VETO_BREAKER)
        patience[st_id] = 0
    updated = state.model_copy(update={
        "stage": "DONE", "outcome": "PASS", "emotion_deltas": deltas, "patience": patience,
    })
    return AnswerResult(state=updated, spent_escalation_point=True)


def concede_pitch(state: PitchState, winning_st_id: str, losing_st_ids: list[str]) -> PitchState:
    """Player drops their card; the conflict's opposing position applies (D41)."""
    deltas = state.emotion_deltas
    deltas = _bump(deltas, winning_st_id, EMOTION_CONCEDE_WIN)
    for st_id in losing_st_ids:
        deltas = _bump(deltas, st_id, EMOTION_CONCEDE_LOSE)
    return state.model_copy(update={
        "stage": "DONE", "outcome": "CONCEDED", "emotion_deltas": deltas,
    })


def rebuild(state: PitchState, room_st_ids: list[str]) -> tuple[PitchState, Optional[str]]:
    """Back to PREPARE at the cost of one patience from everyone in the room.

    A high power stakeholder out of patience with no way left to push the card through is what
    ends the challenge in stalemate; the caller checks that with `is_stalemate`.
    """
    patience = {st_id: state.patience.get(st_id, DEFAULT_PATIENCE) - 1 for st_id in room_st_ids}
    updated = state.model_copy(update={
        "stage": "PREPARE",
        "patience": patience,
        "objections": [],
        "resolved": {},
        "rebuilds": state.rebuilds + 1,
        "outcome": None,
    })
    return updated, None


def is_stalemate(state: PitchState, room: list[tuple[str, str]], escalation_points: int) -> bool:
    """No patience left with a high power stakeholder vetoing, and no Escalation Point to spend."""
    if state.outcome != "VETO" or escalation_points > 0:
        return False
    return any(power == "high" and state.patience.get(st_id, DEFAULT_PATIENCE) <= 0 for st_id, power in room)


def rebuild_is_material(previous_ids: set[str], new_ids: set[str], min_delta: int = MIN_REBUILD_DELTA) -> bool:
    """A rebuilt card has to differ by at least `min_delta` items, so patience buys a real change.

    Counted as changed slots, not as set difference: swapping one item for another is one change,
    which is what it looks like to the room.
    """
    return max(len(new_ids - previous_ids), len(previous_ids - new_ids)) >= min_delta
