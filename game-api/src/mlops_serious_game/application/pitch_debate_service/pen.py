"""Hand the Pen (docs/plans/hand-over-the-pen.md): a stakeholder drafts a component's next change
themselves, instead of the player picking it.

Pure: the caller resolves ground truth (graph, state, intel, room, emotions) and performs the
actual writes (reserving the slot, sealing the draft) from what `draft_for_pen` decides. Same
inputs, same draft, every time - ties go to axis order (automation before governance), never to
randomness.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel

from mlops_serious_game.application.pitch_debate_service import card_search
from mlops_serious_game.application.pitch_debate_service.session import (
    MAX_ATOMIC_CHANGES,
    AtomicChange,
    PitchState,
    boundary_checks,
    card_view,
)
from mlops_serious_game.domain.emotion import EmotionValues, PitchTuning
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import AutomationState
from mlops_serious_game.domain.requirement import IntelTag, item_target, item_target_and_level

TrustBand = Literal["low", "medium", "high"]

_AXES = ("automation", "governance")


class PenDraft(BaseModel):
    """The sealed result of handing the pen to one stakeholder for one component."""

    stakeholder_id: str
    target: str
    change: AtomicChange
    band: TrustBand
    #: The holder's own item the draft came from, if any (a revealed draft from one of these
    #: discloses that item - "they told you directly").
    item_id: Optional[str] = None


def trust_band(emotion_values: Optional[EmotionValues]) -> TrustBand:
    """The holder's Trust reading, in the dossier's own words (EmotionFactory's low/medium/high)."""
    dims = EmotionFactory.derive_all_dimensions(emotion_values or {})
    return next((d["bucket"] for d in dims if d["metric"] == "trust"), "medium")  # type: ignore[return-value]


def can_hand_pen_to(stakeholder_id: str, target: str, graph: Any, held_items: list) -> bool:
    """Who may take a component: its owner (`graph.owner_of`), or a stakeholder the player holds a
    note from about it. Nobody else, so the picker never reveals a stake the player hasn't found."""
    if graph.owner_of(target) == stakeholder_id:
        return True
    for item in held_items:
        if getattr(item, "stakeholder_id", None) != stakeholder_id:
            continue
        if item_target(item) == target:
            return True
        for branch in (getattr(item, "branch_x", None), getattr(item, "branch_y", None)):
            if branch is None:
                continue
            b_target = getattr(branch, "target", None) or (branch.get("target") if isinstance(branch, dict) else None)
            if b_target == target:
                return True
    return False


def _axis_order(change: AtomicChange) -> int:
    return _AXES.index(change.axis) if change.axis in _AXES else len(_AXES)


def _legal_changes_on_target(graph: Any, state: Any, target: str) -> list[AtomicChange]:
    """The legal next-rung changes on `target`: what `card_search.candidate_changes` already
    accepts (target allowed, level above current, in `graph.allowed_for`), restricted to this one
    target and - since a draft is a single slot, never a paired card -  a governance raise only
    once the component is implemented. `candidate_changes` itself still returns a lone governance
    candidate for an unimplemented target (it expects the search to pair it with the implementing
    automation step in the same card, `_implementation_pairs`); a single Hand the Pen slot can't
    pair anything, so that candidate would silently do nothing if drafted and must be dropped here."""
    candidates = card_search.candidate_changes(graph, state, allowed=[target], all_intel=[])
    implemented = state.value(target, "automation") >= AutomationState.MANUAL
    if implemented:
        return candidates
    return [c for c in candidates if c.axis != "governance"]


def _boundary_safe(graph: Any, state: Any, all_intel: list, room_st_ids: list[str], change: AtomicChange) -> bool:
    """Whether drafting `change` crosses a Boundary nobody had already crossed. A Boundary broken
    before the draft (e.g. by the challenge's own opening world event, untouched by this change)
    doesn't disqualify it - only a boundary this specific draft newly breaks does."""
    before = {w.item_id: w.violated for w in boundary_checks(graph, state, all_intel, [], room_st_ids)}
    after = boundary_checks(graph, state, all_intel, [change], room_st_ids)
    return not any(w.violated and not before.get(w.item_id, False) for w in after)


def _own_ask(
    stakeholder_id: str, target: str, all_intel: list, state: Any
) -> tuple[Optional[int], Optional[str], Optional[str]]:
    """The holder's own ask on `target`: a Driver's level, or whichever Trade-off branch is the
    cheaper first step (the smaller distance from the current state). Ties within a stakeholder
    (more than one item touching the same target) go to the cheapest. (None, None, None) if they
    have no ask on it at all."""
    best: tuple[Optional[int], Optional[str], Optional[str]] = (None, None, None)
    best_distance: Optional[int] = None

    for item in all_intel:
        if getattr(item, "stakeholder_id", None) != stakeholder_id:
            continue
        item_type = getattr(item, "type", None)
        item_type = getattr(item_type, "value", item_type)

        asks: list[tuple[int, str, str]] = []
        if item_type in (IntelTag.DRIVER.value, "driver"):
            d_target, level, axis = item_target_and_level(item)
            if d_target == target and level is not None and axis is not None:
                asks.append((level, axis, item.id))
        elif item_type in (IntelTag.TRADE_OFF.value, "trade_off"):
            for branch in (getattr(item, "branch_x", None), getattr(item, "branch_y", None)):
                if branch is None:
                    continue
                b_target = getattr(branch, "target", None) or (branch.get("target") if isinstance(branch, dict) else None)
                b_level = getattr(branch, "level", None) if not isinstance(branch, dict) else branch.get("level")
                b_axis = getattr(branch, "axis", None) if not isinstance(branch, dict) else branch.get("axis")
                if b_target == target and b_level is not None and b_axis is not None:
                    asks.append((b_level, b_axis, item.id))

        for level, axis, item_id in asks:
            distance = abs(level - state.value(target, axis))
            if best_distance is None or distance < best_distance:
                best, best_distance = (level, axis, item_id), distance

    return best


def _low_trust_pick(graph: Any, state: Any, target: str, legal_sorted: list[AtomicChange]) -> AtomicChange:
    """Among the changes a Low-trust holder would accept: a governance sign-off gate if the
    component is already working and allows one (serves them procedurally, costs the room a
    review step), otherwise the highest step they would accept (which can overshoot other
    people's ceilings - the room pays for the overreach, not the holder)."""
    implemented = state.value(target, "automation") >= AutomationState.MANUAL
    gate = next((c for c in legal_sorted if c.axis == "governance"), None)
    if implemented and gate is not None:
        return gate
    return sorted(legal_sorted, key=lambda c: (-(c.value if isinstance(c.value, int) else 0), _axis_order(c)))[0]


def _best_for_room(
    graph: Any, state: Any, all_intel: list, room: list[tuple], emotion_values: dict[str, EmotionValues],
    candidates: list[AtomicChange],
) -> AtomicChange:
    """Among equally-legal candidates, the one giving the room the best total alignment (alignment
    is intel-driven only - independent of power, interest or mood - so this reads as "what the room
    actually asked for", not a popularity contest). Ties go to axis order."""

    def total_alignment(change: AtomicChange) -> float:
        view = card_view(
            graph=graph, state=state, all_intel=all_intel, changes=[change], room=room,
            emotion_values=emotion_values,
        )
        return sum(r.alignment for r in view.reads)

    return sorted(candidates, key=lambda c: (-total_alignment(c), _axis_order(c)))[0]


def _extend_for_high_trust(
    graph: Any, state: Any, change: AtomicChange, all_intel: list, room_st_ids: list[str], steps: int,
) -> AtomicChange:
    """Lifts a High-trust draft up to `steps` rungs on the same axis in one slot (the trust
    dividend), stopping at the first rung that would cross a Boundary or that doesn't exist."""
    current = change
    for _ in range(max(0, steps - 1)):
        higher = [lv for lv in graph.allowed_for(current.target, current.axis) if lv > current.value]
        if not higher:
            break
        candidate = current.model_copy(update={"value": min(higher)})
        if not _boundary_safe(graph, state, all_intel, room_st_ids, candidate):
            break
        current = candidate
    return current


def draft_for_pen(
    stakeholder_id: str,
    target: str,
    graph: Any,
    state: Any,
    all_intel: list,
    room: list[tuple],
    emotion_values: dict[str, EmotionValues],
    tuning: PitchTuning,
) -> Optional[PenDraft]:
    """What `stakeholder_id` drafts for `target`, given how much they trust the player.

    A draft never crosses a Boundary of anyone in the room, so handing over the pen can cost a
    slot and buy-in but can never make the challenge unwinnable. Returns None when the component
    has no legal, boundary-safe change left to draft (nothing left to hand over).
    """
    room_st_ids = [entry[0] for entry in room]
    band = trust_band(emotion_values.get(stakeholder_id))

    legal = [
        c for c in _legal_changes_on_target(graph, state, target)
        if _boundary_safe(graph, state, all_intel, room_st_ids, c)
    ]
    if not legal:
        return None
    legal_sorted = sorted(legal, key=_axis_order)

    ask_level, ask_axis, ask_item_id = _own_ask(stakeholder_id, target, all_intel, state)
    own_ask_change = next(
        (c for c in legal_sorted if c.axis == ask_axis and c.value == ask_level), None
    )

    if len(legal_sorted) == 1:
        chosen, item_id = legal_sorted[0], (ask_item_id if own_ask_change else None)
    elif band == "low":
        chosen, item_id = _low_trust_pick(graph, state, target, legal_sorted), None
    elif band == "medium":
        chosen = own_ask_change or legal_sorted[0]
        item_id = ask_item_id if own_ask_change else None
    else:  # high
        if own_ask_change is not None:
            chosen, item_id = own_ask_change, ask_item_id
        else:
            chosen = _best_for_room(graph, state, all_intel, room, emotion_values, legal_sorted)
            item_id = None

    if band == "high":
        chosen = _extend_for_high_trust(
            graph, state, chosen, all_intel, room_st_ids, tuning.pen_trust_dividend_steps
        )

    return PenDraft(stakeholder_id=stakeholder_id, target=target, change=chosen, band=band, item_id=item_id)


def merge_pen_into_card(state: PitchState) -> Optional[str]:
    """Folds the sealed draft into `state.atomic_changes` before scoring, server-side, so it is
    never in a client payload before this point. Mutates `state` in place.

    Seals it (`pen.revealed = True`) the first time this runs after a delegation; from then on the
    delegated change is an ordinary, locked slot in `atomic_changes`, and a resubmitted card that
    dropped it is rejected (`pen` validation returns an error string instead of None).
    """
    if state.pen is None:
        return None

    if not state.pen.revealed:
        sealed = state.pen.change.model_copy(update={"delegated_to": state.pen.stakeholder_id})
        state.atomic_changes = state.atomic_changes[: MAX_ATOMIC_CHANGES - 1] + [sealed]
        state.pen.revealed = True
        return None

    has_it = any(
        c.delegated_to == state.pen.stakeholder_id and c.target == state.pen.target
        for c in state.atomic_changes
    )
    return None if has_it else "The delegated change can't be removed from the proposal"
