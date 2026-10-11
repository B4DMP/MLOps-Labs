"""Hand the Pen (docs/plans/hand-over-the-pen.md): the player picks a person, and that person
decides what they would change and drafts it into the card straight away.

Pure: the caller resolves ground truth (graph, state, intel, room, emotions, the card so far) and
performs the actual writes (tokens, locked slot, emotions, dossier note) from what
`draft_for_pen` and `place_draft` decide. Same inputs, same draft: ties go to a seeded shuffle,
never to call order.
"""

from __future__ import annotations

import random
from typing import Any, Iterable, Literal, Optional

from pydantic import BaseModel

from mlops_serious_game.application.pitch_debate_service.session import (
    MAX_ATOMIC_CHANGES,
    AtomicChange,
    boundary_checks,
)
from mlops_serious_game.domain.emotion import EmotionValues, PitchTuning
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import AutomationState
from mlops_serious_game.domain.requirement import IntelTag, item_target_and_level

TrustBand = Literal["low", "medium", "high"]

LOCKED_ERROR = "The delegated change can't be removed from the proposal"

# Which item types a holder drafts from first, by how much they trust the player. A Low-trust
# holder only ever drafts a Driver (or the sign-off gate on it).
_ORDER: dict[str, tuple[str, ...]] = {
    "high": (IntelTag.TRADE_OFF.value, IntelTag.DRIVER.value),
    "medium": (IntelTag.DRIVER.value, IntelTag.TRADE_OFF.value),
    "low": (IntelTag.DRIVER.value,),
}


class PenDraft(BaseModel):
    """What one stakeholder drafts when handed the pen."""

    stakeholder_id: str
    target: str
    change: AtomicChange
    band: TrustBand
    #: The holder's own item the draft came from, if any (the player learns it, verified).
    item_id: Optional[str] = None


def trust_band(emotion_values: Optional[EmotionValues]) -> TrustBand:
    """The holder's Trust reading, in the dossier's own words (EmotionFactory's low/medium/high)."""
    dims = EmotionFactory.derive_all_dimensions(emotion_values or {})
    return next((d["bucket"] for d in dims if d["metric"] == "trust"), "medium")  # type: ignore[return-value]


def _type_of(item: Any) -> str:
    t = getattr(item, "type", None)
    return getattr(t, "value", t)


def _is_implemented(state: Any, target: str) -> bool:
    return state.value(target, "automation") >= AutomationState.MANUAL


def _rung_toward(graph: Any, state: Any, target: str, axis: str, level: int) -> Optional[int]:
    """The next allowed level above the current one, not past `level`: a slot moves one step."""
    higher = [lv for lv in graph.allowed_for(target, axis) if state.value(target, axis) < lv <= level]
    return min(higher) if higher else None


def _change(graph: Any, state: Any, target: str, axis: str, level: int) -> Optional[AtomicChange]:
    """One legal slot toward `level` on `target`, or None (a governance raise needs the component
    working first, and a single slot cannot pair it with the implementing step)."""
    if not graph.is_target(target):
        return None
    if axis == "governance" and not _is_implemented(state, target):
        return None
    rung = _rung_toward(graph, state, target, axis, level)
    if rung is None:
        return None
    return AtomicChange(target=target, kind="raise_to", axis=axis, value=rung)


def _boundary_safe(graph: Any, state: Any, all_intel: list, room_st_ids: list[str], change: AtomicChange) -> bool:
    """Whether drafting `change` crosses a Boundary nobody had already crossed. A boundary broken
    before the draft (e.g. by the challenge's opening world event) does not disqualify it."""
    before = {w.item_id: w.violated for w in boundary_checks(graph, state, all_intel, [], room_st_ids)}
    after = boundary_checks(graph, state, all_intel, [change], room_st_ids)
    return not any(w.violated and not before.get(w.item_id, False) for w in after)


def _asks(item: Any, state: Any) -> list[tuple[str, str, int]]:
    """The unmet (target, axis, level) an item asks for: a Driver's level, or each Trade-off branch
    and concession ceiling."""
    kind = _type_of(item)
    out: list[tuple[str, str, int]] = []
    if kind == IntelTag.DRIVER.value:
        target, level, axis = item_target_and_level(item)
        if target and level is not None and axis:
            out.append((target, axis, level))
    elif kind == IntelTag.TRADE_OFF.value:
        for branch in (getattr(item, "branch_x", None), getattr(item, "branch_y", None)):
            if branch is None:
                continue
            get = branch.get if isinstance(branch, dict) else lambda k, b=branch: getattr(b, k, None)
            if get("target") and get("level") is not None and get("axis"):
                out.append((get("target"), get("axis"), get("level")))
        # A concession ("I would accept it staying at most this high") is the ground they would
        # give: they draft a step toward that level, never past it.
        concedes = getattr(item, "concedes", None)
        if concedes is not None and getattr(concedes, "accepts_max_level", None) is not None:
            if getattr(concedes, "target", None) and getattr(concedes, "axis", None):
                out.append((concedes.target, concedes.axis, concedes.accepts_max_level))
    return [(t, a, lv) for t, a, lv in out if state.value(t, a) < lv]


def _extend_for_high_trust(
    graph: Any, state: Any, change: AtomicChange, all_intel: list, room_st_ids: list[str], steps: int,
) -> AtomicChange:
    """Lifts a High-trust draft up to `steps` rungs on the same axis in one slot (the trust
    dividend), stopping before a Boundary or the top rung."""
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
    graph: Any,
    state: Any,
    all_intel: list,
    room: list[tuple],
    emotion_values: dict[str, EmotionValues],
    tuning: PitchTuning,
    card: Iterable[AtomicChange] = (),
    *,
    allowed_targets: Iterable[str] = (),
    skip_item_ids: Iterable[str] = (),
    seed: str = "",
) -> Optional[PenDraft]:
    """What `stakeholder_id` drafts, given how much they trust the player.

    They pick from their own unmet items, the item types ordered by trust band. With nothing unmet
    they take the next step on a component they own. A draft never newly crosses a Boundary of
    anyone in the room, so the pen can cost tokens, a slot and buy-in but never makes the challenge
    unwinnable. None when there is nothing legal to draft.

    `skip_item_ids` are items the player must not learn from this (edge items on a first run).
    """
    room_st_ids = [entry[0] for entry in room]
    band = trust_band(emotion_values.get(stakeholder_id))
    allowed = set(allowed_targets)
    skip = set(skip_item_ids)
    on_card = {(c.target, c.axis, c.value) for c in card}
    rng = random.Random(seed)

    def usable(change: Optional[AtomicChange]) -> bool:
        return (
            change is not None
            and change.target in allowed
            and (change.target, change.axis, change.value) not in on_card
            and _boundary_safe(graph, state, all_intel, room_st_ids, change)
        )

    mine = sorted(
        (i for i in all_intel if getattr(i, "stakeholder_id", None) == stakeholder_id and i.id not in skip),
        key=lambda i: i.id,
    )
    chosen: Optional[AtomicChange] = None
    item_id: Optional[str] = None
    for kind in _ORDER[band]:
        pool = [i for i in mine if _type_of(i) == kind]
        rng.shuffle(pool)
        for item in pool:
            # Of a Trade-off's branches, the cheaper one (the smaller distance to its level) first.
            asks = sorted(_asks(item, state), key=lambda ask: ask[2] - state.value(ask[0], ask[1]))
            pick = next((c for c in (_change(graph, state, *ask) for ask in asks) if usable(c)), None)
            if pick:
                chosen, item_id = pick, item.id
                break
        if chosen:
            break

    if chosen and band == "low":
        # A holder who does not trust you prefers a sign-off gate on the thing, if it already works.
        gate = _change(graph, state, chosen.target, "governance", max(graph.allowed_for(chosen.target, "governance")))
        if usable(gate):
            chosen = gate

    if chosen is None:
        owned = sorted(
            c.id for c in graph.components if graph.owner_of(c.id) == stakeholder_id and c.id in allowed
        )
        rng.shuffle(owned)
        for target in owned:
            for axis in ("automation", "governance"):
                top = max(graph.allowed_for(target, axis), default=0)
                change = _change(graph, state, target, axis, top)
                if usable(change):
                    chosen = change
                    break
            if chosen:
                break

    if chosen is None:
        return None
    if band == "high" and chosen.axis == "automation":
        chosen = _extend_for_high_trust(graph, state, chosen, all_intel, room_st_ids, tuning.pen_trust_dividend_steps)
    return PenDraft(stakeholder_id=stakeholder_id, target=chosen.target, change=chosen, band=band, item_id=item_id)


def place_draft(
    card: list[AtomicChange], draft: PenDraft, leave: int = 1
) -> Optional[tuple[list[AtomicChange], Optional[AtomicChange]]]:
    """The card with the draft in it, plus the player's change it replaced (or None).

    A draft on a `(target, axis)` the card already has takes that slot over. Otherwise it needs a
    free slot and, afterwards, `leave` slots still free. None when it cannot be placed.
    """
    locked = draft.change.model_copy(update={"delegated_to": draft.stakeholder_id})
    for i, c in enumerate(card):
        if c.delegated_to is None and (c.target, c.axis) == (locked.target, locked.axis):
            return card[:i] + [locked] + card[i + 1:], c
    if len(card) + 1 > MAX_ATOMIC_CHANGES - leave:
        return None
    return [*card, locked], None


def lock_card(
    stored: Iterable[AtomicChange], submitted: list[AtomicChange]
) -> tuple[list[AtomicChange], Optional[str]]:
    """What the player submitted, with a drafted slot kept as the stakeholder wrote it.

    The client never owns `delegated_to`: it is stripped from whatever was sent and restored from
    the stored card. A submission that drops a drafted slot is an error.
    """
    locked = [c for c in stored if c.delegated_to]
    merged = [c.model_copy(update={"delegated_to": None}) for c in submitted]
    for l in locked:
        i = next((k for k, c in enumerate(merged) if (c.target, c.axis) == (l.target, l.axis)), None)
        if i is None:
            return submitted, LOCKED_ERROR
        merged[i] = l
    return merged, None
