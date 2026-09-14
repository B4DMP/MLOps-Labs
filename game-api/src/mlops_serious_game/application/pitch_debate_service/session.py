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
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.event_causes import EventCauseFactory
from mlops_serious_game.domain.graph import GraphOp, GraphState, Knowledge, TechnicalGraph
from mlops_serious_game.domain.graph_predicates import PredicateError, evaluate
from mlops_serious_game.domain.requirement import IntelTag, item_target_and_level

MAX_CARD_ITEMS = 5
DEFAULT_MAX_AMENDMENTS = 3
MIN_REBUILD_DELTA = 2
RISK_GREEN = 0.6
RISK_AMBER = 0.4

# D38: the tuned numbers behind fit/buy_in/outcome live in config (EmotionValueConfig.json's
# pitch_tuning), not code - scoring.py itself stays factory-free (its own "no factory calls"
# contract), so this module reads the config once and passes the values in explicitly below.
_TUNING = EmotionFactory.get_pitch_tuning()
DEFAULT_PATIENCE = _TUNING.default_patience  # D50: 3, was 2


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
    target_name: Optional[str] = None
    line: Optional[str] = Field(default=None, description="The Boundary in the player's own intel wording")


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


def player_boundary_warnings(graph: TechnicalGraph, warnings: list[BoundaryWarning], held: list) -> list[BoundaryWarning]:
    """The warnings the builder may show: Boundaries the player holds and filed as Boundaries.

    The reads and the outcome still check every Boundary in the room. This only decides what the
    screen says, so a line the player never found (or filed as something else) is not revealed by
    name before anyone objects with it.
    """
    mine = {
        i.id: i for i in held
        if getattr(i, "categorized_type", None) == IntelTag.BOUNDARY
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
    hardened_item_ids: frozenset[str] = frozenset(),
) -> list[DialogueOptionSpec]:
    return dialogue_options_for(
        objection=objection,
        answering_item_ids=answering_item_ids(objection, held_items, card_item_ids),
        escalation_points=escalation_points,
        amendment_budget=amendments_left,
        card_size=len(card_item_ids),
        max_card_size=MAX_CARD_ITEMS,
        hardened=bool(objection.item_id) and objection.item_id in hardened_item_ids,
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
EMOTION_REFRAME_MISS = _TUNING.emotion_reframe_miss  # D48: Reframe Miss, the objecting stakeholder hardens
EMOTION_ROOM_LISTENING = _TUNING.emotion_room_listening  # D48: other high-power seats with a poor fit
EMOTION_ADDENDUM = _TUNING.emotion_addendum
EMOTION_CONCEDE = _TUNING.emotion_concede
EMOTION_VETO_BREAKER = _TUNING.emotion_veto_breaker
EMOTION_CONCEDE_WIN = _TUNING.emotion_concede_win  # D41: the side that gets its way
EMOTION_CONCEDE_LOSE = _TUNING.emotion_concede_lose  # D41: the side whose card was dropped
REFRAME_HIT = _TUNING.reframe_hit
REFRAME_PARTIAL = _TUNING.reframe_partial
ROOM_LISTEN = _TUNING.room_listen
SOUND_OUT_PATIENCE_COST = _TUNING.sound_out_patience_cost


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
    # D48: item ids a Reframe Miss hardened this challenge. From then on only Amend clears the
    # objection that item raises, no matter its kind - `options_for` reads this on every call.
    hardened_item_ids: list[str] = Field(default_factory=list)

    @property
    def amendments_left(self) -> int:
        return max(0, self.max_amendments - self.amendments_used)

    def open_objections(self) -> list[Objection]:
        return [o for o in self.objections if o.id not in self.resolved]

    def patience_word(self, st_id: str) -> str:
        """Patience in words, not pips (D50): full shows nothing, one step down is impatient,
        the last point is at their limit."""
        left = self.patience.get(st_id, DEFAULT_PATIENCE)
        if left <= 0:
            return "at their limit"
        if left < DEFAULT_PATIENCE:
            return "impatient"
        return "full"


class ReframeContext(BaseModel):
    """What a Reframe answer needs to score (D48): the archetype the player chose, the objecting
    stakeholder's true archetype (fit is measured against ground truth, stakeholders are never
    fogged), and the room's other stakeholders with their power and true archetype, for the
    "room is listening" side effect. All optional: a Reframe answered with no archetype context
    (chosen is None) just clears stance objections with no emotion change, as it always has."""

    model_config = {"arbitrary_types_allowed": True}

    chosen: Optional[Any] = None
    stakeholder_archetype: Optional[Any] = None
    room: list[tuple[str, str, Any]] = Field(default_factory=list, description="(stakeholder_id, power, archetype) for everyone else in the room")


class AnswerResult(BaseModel):
    state: PitchState
    cleared: bool = False
    spent_escalation_point: bool = False
    rejected: Optional[str] = Field(default=None, description="Why the answer did not apply")
    reframe_result: Optional[str] = Field(default=None, description="hit, partial or miss - set only for a scored Reframe")
    events: list[GameEvent] = Field(default_factory=list)


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


def _direction(amount: float) -> str:
    if amount > 0:
        return "up"
    if amount < 0:
        return "down"
    return "none"


def _bump(
    deltas: dict[str, float],
    st_id: Optional[str],
    amount: float,
    *,
    cause: str,
    step: str = "object",
    params: Optional[dict] = None,
    refs: Optional[dict] = None,
) -> tuple[dict[str, float], list[GameEvent]]:
    """Bumps one stakeholder's emotion delta and returns the event this change is logged as
    (plan 11, D51: nothing moves emotion without a cause). A no-op - no stakeholder, or a zero
    amount such as a Partial Reframe - returns no event: nothing happened, nothing to log."""
    if not st_id or amount == 0:
        return deltas, []
    out = dict(deltas)
    out[st_id] = round(out.get(st_id, 0.0) + amount, 3)
    event = GameEvent(
        step=step, kind="emotion", subject_id=st_id, direction=_direction(amount),
        magnitude=EventCauseFactory.magnitude_of(amount), cause=cause, params=params or {}, refs=refs or {},
    )
    return out, [event]


def _name(names: Optional[dict[str, str]], st_id: Optional[str]) -> str:
    if not st_id:
        return ""
    return (names or {}).get(st_id, st_id)


def _reframe_bucket(reframe: Optional[ReframeContext]) -> Optional[str]:
    """Direct Hit / Partial / Miss from fit against the stakeholder's true archetype (D48).
    None when the caller gave no archetype context - a Reframe answered blind clears stance
    objections with no emotion change, same as before D48."""
    if reframe is None or reframe.chosen is None or reframe.stakeholder_archetype is None:
        return None
    f = fit(reframe.stakeholder_archetype, reframe.chosen)
    if f >= REFRAME_HIT:
        return "hit"
    if f >= REFRAME_PARTIAL:
        return "partial"
    return "miss"


def _room_listening(
    deltas: dict[str, float],
    reframe: Optional[ReframeContext],
    objecting_st_id: str,
    names: Optional[dict[str, str]],
) -> tuple[dict[str, float], list[GameEvent]]:
    """Every other high-power stakeholder in the room with a poor fit to the chosen archetype
    turns slightly colder (D48): the room is listening, even to an argument aimed at someone else."""
    if reframe is None or reframe.chosen is None:
        return deltas, []
    events: list[GameEvent] = []
    for st_id, power, arch in reframe.room:
        if st_id == objecting_st_id or power != "high" or arch is None:
            continue
        if fit(arch, reframe.chosen) < ROOM_LISTEN:
            deltas, ev = _bump(
                deltas, st_id, EMOTION_ROOM_LISTENING, cause="emotion.room_listening",
                params={"st": _name(names, st_id)},
            )
            events += ev
    return deltas, events


def answer_objection(
    state: PitchState,
    objection_id: str,
    option: str,
    escalation_points: int,
    available: set[str],
    item_id: Optional[str] = None,
    opposing_st_id: Optional[str] = None,
    reframe: Optional[ReframeContext] = None,
    names: Optional[dict[str, str]] = None,
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
    hardened = list(state.hardened_item_ids)
    cleared = False
    spent_point = False
    reframe_result: Optional[str] = None
    events: list[GameEvent] = []
    st_name = _name(names, objection.stakeholder_id)

    if option == "amend":
        if not item_id or item_id in card:
            return AnswerResult(state=state, rejected="pick an intel item that is not on the card yet")
        card.append(item_id)
        amendments += 1
        cleared = True
    elif option == "reframe":
        # D48: Reframe picks an archetype per objection. Fit against the stakeholder's true
        # archetype decides Hit (clears a stance objection, warmer), Partial (clears, no emotion
        # change) or Miss (never clears, and hardens the item so only Amend can from now on).
        # Q37: emotion moves the same way on every objection kind, clearing stays stance-only.
        reframe_result = _reframe_bucket(reframe)
        if reframe_result == "hit":
            deltas, ev = _bump(deltas, objection.stakeholder_id, EMOTION_REFRAME, cause="emotion.reframe_hit", params={"st": st_name})
            events += ev
            cleared = objection.kind == "stance"
        elif reframe_result == "miss":
            deltas, ev = _bump(deltas, objection.stakeholder_id, EMOTION_REFRAME_MISS, cause="emotion.reframe_miss", params={"st": st_name})
            events += ev
            cleared = False
            if objection.kind == "stance" and objection.item_id and objection.item_id not in hardened:
                hardened.append(objection.item_id)
        else:
            # Partial, or no archetype context supplied at all: clears stance, no emotion change.
            cleared = objection.kind == "stance"
        deltas, room_events = _room_listening(deltas, reframe, objection.stakeholder_id, names)
        events += room_events
    elif option == "stonewall":
        deltas, ev = _bump(deltas, objection.stakeholder_id, EMOTION_STONEWALL, cause="emotion.stonewall", params={"st": st_name})
        events += ev
        deltas, ev = _bump(deltas, opposing_st_id, EMOTION_STONEWALL_ALLY, cause="emotion.stonewall_ally", params={"st": _name(names, opposing_st_id)})
        events += ev
        cleared = True  # the objection stands, but the room moves on
    elif option == "emergency_addendum":
        if escalation_points <= 0:
            return AnswerResult(state=state, rejected="no Escalation Points left")
        deltas, ev = _bump(deltas, objection.stakeholder_id, EMOTION_ADDENDUM, cause="emotion.addendum", params={"st": st_name})
        events += ev
        spent_point = True
        amendments += 1
        cleared = True
    elif option == "concede_correction":
        if objection.item_id:
            conceded.append(objection.item_id)
        deltas, ev = _bump(deltas, objection.stakeholder_id, EMOTION_CONCEDE, cause="emotion.concede_correction", params={"st": st_name})
        events += ev
        cleared = True

    resolved = dict(state.resolved)
    resolved[objection_id] = option
    updated = state.model_copy(update={
        "card_item_ids": card,
        "amendments_used": amendments,
        "conceded_item_ids": conceded,
        "emotion_deltas": deltas,
        "resolved": resolved,
        "hardened_item_ids": hardened,
    })
    return AnswerResult(
        state=updated, cleared=cleared, spent_escalation_point=spent_point,
        reframe_result=reframe_result, events=events,
    )


_OUTCOME_CAUSES = {"PASS": "outcome.pass", "SOFT_PASS": "outcome.soft_pass", "VETO": "outcome.veto"}


def commit_pitch(
    state: PitchState, view: CardView, names: Optional[dict[str, str]] = None
) -> tuple[PitchState, list[GameEvent]]:
    """Locks in the outcome. The caller applies the ops and writes the grudges."""
    updated = state.model_copy(update={
        "stage": "DONE" if view.outcome != "VETO" else "COMMIT",
        "outcome": view.outcome,
    })
    events: list[GameEvent] = []
    if view.outcome == "VETO":
        vetoing = [
            r.stakeholder_id for r in view.reads
            if r.power == "high" and (r.boundary_violated or r.band == "red")
        ]
        if vetoing:
            for st_id in vetoing:
                events.append(GameEvent(
                    step="commit", kind="outcome", subject_id=st_id,
                    cause="outcome.veto", params={"st": _name(names, st_id)},
                ))
        else:
            events.append(GameEvent(
                step="commit", kind="outcome", subject_id=None,
                cause="outcome.veto", params={"st": "the room"},
            ))
    else:
        events.append(GameEvent(
            step="commit", kind="outcome", subject_id=None,
            cause=_OUTCOME_CAUSES.get(view.outcome, "outcome.pass"),
            params={},
        ))
    return updated, events


def veto_breaker(state: PitchState, escalation_points: int, vetoing_st_ids: list[str], names: Optional[dict[str, str]] = None) -> AnswerResult:
    """One Escalation Point pushes the card through. The overridden stakeholder remembers it (D7)."""
    if escalation_points <= 0:
        return AnswerResult(state=state, rejected="no Escalation Points left")
    deltas = state.emotion_deltas
    patience = dict(state.patience)
    events: list[GameEvent] = []
    for st_id in vetoing_st_ids:
        deltas, ev = _bump(deltas, st_id, EMOTION_VETO_BREAKER, cause="emotion.veto_breaker", step="commit", params={"st": _name(names, st_id)})
        events += ev
        patience[st_id] = 0
        events.append(GameEvent(
            step="commit", kind="outcome", subject_id=st_id, cause="outcome.veto_breaker", params={"st": _name(names, st_id)},
        ))
    updated = state.model_copy(update={
        "stage": "DONE", "outcome": "PASS", "emotion_deltas": deltas, "patience": patience,
    })
    return AnswerResult(state=updated, spent_escalation_point=True, events=events)


def concede_pitch(
    state: PitchState, winning_st_id: str, losing_st_ids: list[str], names: Optional[dict[str, str]] = None
) -> tuple[PitchState, list[GameEvent]]:
    """Player drops their card; the conflict's opposing position applies (D41)."""
    deltas = state.emotion_deltas
    events: list[GameEvent] = []
    deltas, ev = _bump(deltas, winning_st_id, EMOTION_CONCEDE_WIN, cause="emotion.concede_win", step="commit", params={"st": _name(names, winning_st_id)})
    events += ev
    for st_id in losing_st_ids:
        deltas, ev = _bump(deltas, st_id, EMOTION_CONCEDE_LOSE, cause="emotion.concede_lose", step="commit", params={"st": _name(names, st_id)})
        events += ev
    events.append(GameEvent(
        step="commit", kind="outcome", subject_id=winning_st_id, cause="outcome.conceded",
        params={"st": _name(names, winning_st_id)},
    ))
    updated = state.model_copy(update={
        "stage": "DONE", "outcome": "CONCEDED", "emotion_deltas": deltas,
    })
    return updated, events


def rebuild(
    state: PitchState, room_st_ids: list[str], names: Optional[dict[str, str]] = None
) -> tuple[PitchState, Optional[str], list[GameEvent]]:
    """Back to PREPARE at the cost of one patience from everyone in the room.

    A high power stakeholder out of patience with no way left to push the card through is what
    ends the challenge in stalemate; the caller checks that with `is_stalemate`.
    """
    patience = {st_id: state.patience.get(st_id, DEFAULT_PATIENCE) - 1 for st_id in room_st_ids}
    events = [
        GameEvent(step="commit", kind="patience", subject_id=st_id, direction="down", magnitude="clear",
                  cause="patience.rebuild", params={"st": _name(names, st_id)})
        for st_id in room_st_ids
    ]
    updated = state.model_copy(update={
        "stage": "PREPARE",
        "patience": patience,
        "objections": [],
        "resolved": {},
        "rebuilds": state.rebuilds + 1,
        "outcome": None,
    })
    return updated, None, events


def is_stalemate(state: PitchState, room: list[tuple[str, str]], escalation_points: int) -> bool:
    """No patience left with a high power stakeholder vetoing, and no Escalation Point to spend."""
    if state.outcome != "VETO" or escalation_points > 0:
        return False
    return any(power == "high" and state.patience.get(st_id, DEFAULT_PATIENCE) <= 0 for st_id, power in room)


def mark_stalemate(state: PitchState) -> tuple[PitchState, list[GameEvent]]:
    """Nobody moved, and the moment passed: what the caller applies once `is_stalemate` fires."""
    updated = state.model_copy(update={"stage": "DONE", "outcome": "STALEMATE"})
    return updated, [GameEvent(step="commit", kind="outcome", cause="outcome.stalemate")]


def rebuild_is_material(previous_ids: set[str], new_ids: set[str], min_delta: int = MIN_REBUILD_DELTA) -> bool:
    """A rebuilt card has to differ by at least `min_delta` items, so patience buys a real change.

    Counted as changed slots, not as set difference: swapping one item for another is one change,
    which is what it looks like to the room.
    """
    return max(len(new_ids - previous_ids), len(previous_ids - new_ids)) >= min_delta


# ---------------------------------------------------------------------------
# Build your case (D48, D50): the Opener and Sound someone out
# ---------------------------------------------------------------------------

def opener_archetypes(guessed: dict[str, str]) -> list[str]:
    """Distinct archetypes the player has tagged for the room, in room order - the Opener's
    "2 to 4 opening lines" (D48). Empty when nothing is tagged yet: the picker falls back to
    "any other" alone. Uses the player's own guesses, never the ground truth - the player is
    only ever shown their own tagging back."""
    seen: list[str] = []
    for arch in guessed.values():
        if arch and arch not in seen:
            seen.append(arch)
    return seen


def sound_out_available(patience: int) -> bool:
    """Not available at a stakeholder's last point, so sounding out alone can never be what
    leaves them at zero patience (D50)."""
    return patience > 1


def sound_out_reply(read: StakeholderRead) -> str:
    """on_board, lukewarm or would_object: what Sound someone out tells the player, read off the
    same score the room would give this card if committed right now (D50). No text, no numbers."""
    if read.boundary_violated or read.band == "red":
        return "would_object"
    if read.band == "amber":
        return "lukewarm"
    return "on_board"


_SOUND_OUT_CAUSES = {
    "on_board": "objection.sound_out_on_board",
    "lukewarm": "objection.sound_out_lukewarm",
    "would_object": "objection.sound_out_would_object",
    "would_object_kind": "objection.sound_out_would_object_kind",
}


def sound_out(
    state: PitchState,
    stakeholder_id: str,
    read: StakeholderRead,
    objection_kind: Optional[str] = None,
    names: Optional[dict[str, str]] = None,
) -> tuple[PitchState, str, list[GameEvent]]:
    """Costs one patience from the sounded-out stakeholder; returns their decided reply and the
    updated state. Caller checks `sound_out_available` first - this does not re-check it."""
    patience = dict(state.patience)
    patience[stakeholder_id] = max(0, patience.get(stakeholder_id, DEFAULT_PATIENCE) - 1)
    updated = state.model_copy(update={"patience": patience})
    reply = sound_out_reply(read)
    st_name = _name(names, stakeholder_id)
    cause_key = "would_object_kind" if reply == "would_object" and objection_kind else reply
    events = [
        GameEvent(
            step="build", kind="patience", subject_id=stakeholder_id, direction="down", magnitude="slight",
            cause="patience.sound_out", params={"st": st_name},
        ),
        GameEvent(
            step="build", kind="objection", subject_id=stakeholder_id, direction="none",
            cause=_SOUND_OUT_CAUSES[cause_key],
            params={"st": st_name, **({"kind": objection_kind} if objection_kind else {})},
        ),
    ]
    return updated, reply, events
