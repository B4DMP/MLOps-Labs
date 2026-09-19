"""Deterministic objection firing for the OBJECT stage of the pitch phase (plan 06).

All functions are pure: they take explicit data and return typed objects.
Callers resolve ground-truth intel and graph state before calling.

Order of firing: boundary → technical → stance → price → correction.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Literal, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.domain.requirement import item_target as _target_id_for

if TYPE_CHECKING:
    from mlops_serious_game.domain.requirement import StakeholderIntelItem

ObjectionKind = Literal["boundary", "technical", "stance", "price", "correction"]


class Objection(BaseModel):
    """One fired objection instance."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: ObjectionKind
    stakeholder_id: str
    item_id: Optional[str] = None
    target: Optional[str] = None
    text: str
    hard: bool = False


# ---------------------------------------------------------------------------
# Internal helpers — one kind each
# ---------------------------------------------------------------------------

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
            filed_as = getattr(item, "categorized_type", None)
            # Ground truth carries no player tag: only the player's own copy can be mis-filed.
            if filed_as is not None and filed_as != getattr(item, "type", None):
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

