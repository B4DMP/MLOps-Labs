"""Deterministic objection firing for the OBJECT stage of the pitch phase (plan 06).

All functions are pure: they take explicit data and return typed objects.
Callers resolve ground-truth intel and graph state before calling.

Order of firing: boundary → technical → stance → price → correction.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Literal, Optional

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from mlops_serious_game.domain.requirement import StakeholderIntelItem

ObjectionKind = Literal["boundary", "technical", "stance", "price", "correction"]
DialogueOptionKind = Literal["amend", "reframe", "stonewall", "emergency_addendum", "concede_correction"]

# Reframe can only clear stance objections (soft Drivers). Boundary/technical/price are hard.
_REFRAME_CLEARABLE: frozenset[ObjectionKind] = frozenset({"stance"})
_HARD_KINDS: frozenset[ObjectionKind] = frozenset({"boundary", "technical"})


class Objection(BaseModel):
    """One fired objection instance."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: ObjectionKind
    stakeholder_id: str
    item_id: Optional[str] = None
    target: Optional[str] = None
    text: str
    hard: bool = False


class DialogueOptionSpec(BaseModel):
    """Availability of one dialogue option for a given objection."""

    option: DialogueOptionKind
    available: bool
    reason: Optional[str] = None  # non-None when available=False


# ---------------------------------------------------------------------------
# Internal helpers — one kind each
# ---------------------------------------------------------------------------

def _target_id_for(item: "StakeholderIntelItem") -> Optional[str]:
    """Best-effort target id from an intel item's payload."""
    suggested = getattr(item, "suggested", None)
    if suggested and getattr(suggested, "target", None):
        return suggested.target
    asserts = getattr(item, "asserts", None)
    if asserts and getattr(asserts, "target", None):
        return asserts.target
    concedes = getattr(item, "concedes", None)
    if concedes and getattr(concedes, "target", None):
        return concedes.target
    return None


def _text(authored: dict, st_id: str, kind: str, target: Optional[str], fallback: str) -> str:
    return authored.get((st_id, kind, target), authored.get((st_id, kind, None), fallback))


def _boundary_objections(
    all_intel: list["StakeholderIntelItem"],
    violated_boundary_ids: set[str],
    authored: dict,
) -> list[Objection]:
    from mlops_serious_game.domain.requirement import IntelTag

    result = []
    for item in all_intel:
        if (
            getattr(item, "type", None) == IntelTag.BOUNDARY
            and item.id in violated_boundary_ids
        ):
            st_id = getattr(item, "stakeholder_id", None) or ""
            target = _target_id_for(item)
            result.append(Objection(
                kind="boundary",
                stakeholder_id=st_id,
                item_id=item.id,
                target=target,
                text=_text(authored, st_id, "boundary", target, item.description),
                hard=True,
            ))
    return result


def _technical_objections(
    all_intel: list["StakeholderIntelItem"],
    card_item_ids: set[str],
    capped_item_ids: set[str],
    authored: dict,
) -> list[Objection]:
    result = []
    for item in all_intel:
        if item.id in card_item_ids and item.id in capped_item_ids:
            st_id = getattr(item, "stakeholder_id", None) or ""
            target = _target_id_for(item)
            result.append(Objection(
                kind="technical",
                stakeholder_id=st_id,
                item_id=item.id,
                target=target,
                text=_text(authored, st_id, "technical", target, item.description),
                hard=True,
            ))
    return result


def _stance_objections(
    room_st_ids: list[str],
    all_intel: list["StakeholderIntelItem"],
    card_item_ids: set[str],
    authored: dict,
) -> list[Objection]:
    """One objection per stakeholder with any uncovered Driver."""
    from mlops_serious_game.domain.requirement import IntelTag

    result = []
    for st_id in room_st_ids:
        for item in all_intel:
            if (
                getattr(item, "stakeholder_id", None) == st_id
                and getattr(item, "type", None) == IntelTag.DRIVER
                and item.id not in card_item_ids
            ):
                target = _target_id_for(item)
                result.append(Objection(
                    kind="stance",
                    stakeholder_id=st_id,
                    item_id=item.id,
                    target=target,
                    text=_text(authored, st_id, "stance", target, item.description),
                    hard=False,
                ))
                break  # one objection per stakeholder
    return result


def _price_objections(
    room_st_ids: list[str],
    all_intel: list["StakeholderIntelItem"],
    card_item_ids: set[str],
    authored: dict,
) -> list[Objection]:
    """One objection per stakeholder for the first uncompensated Trade-off loss."""
    from mlops_serious_game.domain.requirement import IntelTag

    result = []
    for st_id in room_st_ids:
        for item in all_intel:
            if (
                getattr(item, "stakeholder_id", None) == st_id
                and getattr(item, "type", None) == IntelTag.TRADE_OFF
                and item.id not in card_item_ids
            ):
                concedes = getattr(item, "concedes", None)
                if concedes and getattr(concedes, "loss", None):
                    target = _target_id_for(item)
                    result.append(Objection(
                        kind="price",
                        stakeholder_id=st_id,
                        item_id=item.id,
                        target=target,
                        text=_text(authored, st_id, "price", target, item.description),
                        hard=False,
                    ))
                    break
    return result


def _correction_objections(
    all_intel: list["StakeholderIntelItem"],
    card_item_ids: set[str],
    authored: dict,
) -> list[Objection]:
    """One objection per mis-tagged item slotted in the card."""
    result = []
    for item in all_intel:
        if item.id in card_item_ids:
            if getattr(item, "categorized_type", None) != getattr(item, "type", None):
                st_id = getattr(item, "stakeholder_id", None) or ""
                target = _target_id_for(item)
                result.append(Objection(
                    kind="correction",
                    stakeholder_id=st_id,
                    item_id=item.id,
                    target=target,
                    text=_text(authored, st_id, "correction", target, item.description),
                    hard=False,
                ))
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fire_objections(
    room_st_ids: list[str],
    all_intel: list["StakeholderIntelItem"],
    card_item_ids: set[str],
    violated_boundary_ids: set[str],
    capped_item_ids: set[str],
    authored: dict,
    max_per_stakeholder: int = 2,
) -> list[Objection]:
    """Fire all applicable objections in canonical order, capped per stakeholder.

    Parameters
    ----------
    room_st_ids:
        Stakeholder ids present in the room (phase-level list).
    all_intel:
        Full ground-truth intel list for the challenge. Scoring is on
        ground truth (D11); the player's categorization is only checked
        for correction objections.
    card_item_ids:
        Ids of items slotted in the current card.
    violated_boundary_ids:
        Boundary item ids whose predicate is false after applying the card.
        Precomputed by the graph predicate evaluator (keeps scoring pure).
    capped_item_ids:
        Card item ids whose target will be capped by an upstream break.
        Precomputed by the effective-level evaluator.
    authored:
        Dict keyed by (stakeholder_id, kind, target_id) → authored text.
        Falls back to (stakeholder_id, kind, None) then to item.description.
    max_per_stakeholder:
        Upper bound on objections raised by any single stakeholder.
    """
    raw: list[Objection] = []
    raw.extend(_boundary_objections(all_intel, violated_boundary_ids, authored))
    raw.extend(_technical_objections(all_intel, card_item_ids, capped_item_ids, authored))
    raw.extend(_stance_objections(room_st_ids, all_intel, card_item_ids, authored))
    raw.extend(_price_objections(room_st_ids, all_intel, card_item_ids, authored))
    raw.extend(_correction_objections(all_intel, card_item_ids, authored))

    counts: dict[str, int] = {}
    capped: list[Objection] = []
    for obj in raw:
        n = counts.get(obj.stakeholder_id, 0)
        if n < max_per_stakeholder:
            capped.append(obj)
            counts[obj.stakeholder_id] = n + 1
    return capped


def dialogue_options_for(
    objection: Objection,
    answering_item_ids: set[str],
    escalation_points: int,
    amendment_budget: int,
    card_size: int,
    max_card_size: int = 5,
) -> list[DialogueOptionSpec]:
    """Return the full dialogue option menu for one objection.

    answering_item_ids: player-held item ids that specifically answer this
    objection (Driver for stance, Boundary for boundary, upstream item for
    technical, Trade-off for price). Empty means Amend is unavailable.
    """
    opts: list[DialogueOptionSpec] = []

    # --- Amend ---
    at_capacity = card_size >= max_card_size
    budget_gone = amendment_budget <= 0
    no_answer = not answering_item_ids
    if no_answer or budget_gone or at_capacity:
        reasons = []
        if no_answer:
            reasons.append("no matching intel item in hand")
        if budget_gone:
            reasons.append("amendment budget exhausted")
        if at_capacity:
            reasons.append("card is full (5 items)")
        opts.append(DialogueOptionSpec(option="amend", available=False, reason="; ".join(reasons)))
    else:
        opts.append(DialogueOptionSpec(option="amend", available=True))

    # --- Reframe ---
    opts.append(DialogueOptionSpec(
        option="reframe",
        available=True,
        reason=None if objection.kind in _REFRAME_CLEARABLE
        else f"Reframe cannot clear a {objection.kind} objection (emotion impact only)",
    ))

    # --- Stonewall ---
    opts.append(DialogueOptionSpec(option="stonewall", available=True))

    # --- Emergency Addendum ---
    ea_reasons = []
    if escalation_points <= 0:
        ea_reasons.append("no Escalation Points remaining")
    if budget_gone:
        ea_reasons.append("amendment budget exhausted")
    if at_capacity:
        ea_reasons.append("card is full (5 items)")
    if ea_reasons:
        opts.append(DialogueOptionSpec(
            option="emergency_addendum", available=False, reason="; ".join(ea_reasons)
        ))
    else:
        opts.append(DialogueOptionSpec(option="emergency_addendum", available=True))

    # --- Concede Correction ---
    if objection.kind == "correction":
        opts.append(DialogueOptionSpec(option="concede_correction", available=True))
    else:
        opts.append(DialogueOptionSpec(
            option="concede_correction",
            available=False,
            reason="only available for mis-tagged item objections",
        ))

    return opts
