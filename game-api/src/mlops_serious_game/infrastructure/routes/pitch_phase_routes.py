"""REST endpoints for the merged pitch phase (plan 06).

POST /api/pitch/objections     — fire deterministic objections for the current card
POST /api/pitch/commit         — score the card and return outcome
POST /api/pitch/dialogue-options — available options for one objection
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/pitch", tags=["Pitch Phase"])


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _load_intel(challenge_id: int):
    """Ground-truth intel items for a challenge as StakeholderIntelItem list."""
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    from mlops_serious_game.domain.requirement import StakeholderIntelItem, ConfidenceType

    reqs = RequirementFactory.get_requirements_for_challenge(challenge_id)
    items = []
    for req in reqs:
        try:
            items.append(StakeholderIntelItem.from_requirement(req, intel_type=ConfidenceType.VERIFIED))
        except Exception:
            pass
    return items


def _load_effective(username: str):
    """EffectiveView for a user, or None if the graph is not initialised."""
    try:
        from mlops_serious_game.application.graph_service.store import load_state
        from mlops_serious_game.application.graph_service.effective import compute_effective
        from mlops_serious_game.domain.graph_factory import GraphFactory

        replay = load_state(username)
        return compute_effective(GraphFactory.get_graph(), replay.state)
    except Exception:
        return None


def _phase_stakeholders(phase_id: int) -> list:
    """List of PhaseStakeholder for a phase, or [] if not found."""
    try:
        from mlops_serious_game.domain.phase_factory import PhaseFactory

        phases = PhaseFactory.get_phases()
        if 0 <= phase_id < len(phases):
            return phases[phase_id].stakeholders
    except Exception:
        pass
    return []


def _archetype_or_neutral(name: Optional[str]):
    """Return the named archetype, or a neutral one (all axes 2) if not found."""
    from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype

    if name:
        try:
            from mlops_serious_game.domain.emotion_factory import EmotionFactory

            arch = EmotionFactory.get_archetype_by_name(name)
            if arch:
                return arch
        except Exception:
            pass
    return ConvincerArchetype(
        name="neutral", icon="", color="",
        evidence_basis=2, risk_and_control=2, value_horizon=2, strategy="",
    )


def _stakeholder_archetype(st_id: str):
    try:
        from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
        from mlops_serious_game.domain.emotion_factory import EmotionFactory

        st = StakeholderFactory.get_stakeholder(st_id)
        name = getattr(st, "convincer_archetype", "") if st else ""
        arch = EmotionFactory.get_archetype_by_name(name) if name else None
        return arch
    except Exception:
        return None


def _violated_boundary_ids(all_intel, card_item_ids: set[str]) -> set[str]:
    """Conservative: any Boundary not slotted in the card is considered violated."""
    from mlops_serious_game.domain.requirement import IntelTag

    return {
        item.id
        for item in all_intel
        if getattr(item, "type", None) == IntelTag.BOUNDARY
        and item.id not in card_item_ids
    }


def _capped_item_ids(all_intel, card_item_ids: set[str], effective) -> set[str]:
    """Card items whose suggested target will be capped by an upstream break."""
    if effective is None:
        return set()
    capped = set()
    for item in all_intel:
        if item.id not in card_item_ids:
            continue
        suggested = getattr(item, "suggested", None)
        if suggested and getattr(suggested, "target", None):
            if suggested.target in effective.capped_by:
                capped.add(item.id)
    return capped


# ---------------------------------------------------------------------------
# /objections
# ---------------------------------------------------------------------------

class ObjectionsRequest(BaseModel):
    username: str
    phase_id: int
    challenge_id: int
    card_item_ids: list[str] = []
    main_archetype_name: Optional[str] = None
    secondary_archetype_name: Optional[str] = None


@router.post("/objections")
async def get_objections(req: ObjectionsRequest) -> dict[str, Any]:
    """Fire deterministic objections for the current card state.

    Returns objections in canonical order (boundary → technical → stance → price → correction)
    plus a rough buy-in preview per stakeholder using default emotions (0.5).
    """
    from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
    from mlops_serious_game.application.pitch_debate_service.authored import load_authored_index
    from mlops_serious_game.application.pitch_debate_service import scoring

    card_ids = set(req.card_item_ids)
    all_intel = _load_intel(req.challenge_id)
    effective = _load_effective(req.username)
    phase_stakeholders = _phase_stakeholders(req.phase_id)
    room_st_ids = [ps.stakeholder_id for ps in phase_stakeholders]

    violated = _violated_boundary_ids(all_intel, card_ids)
    capped = _capped_item_ids(all_intel, card_ids, effective)
    authored = load_authored_index()

    objections = fire_objections(
        room_st_ids=room_st_ids,
        all_intel=all_intel,
        card_item_ids=card_ids,
        violated_boundary_ids=violated,
        capped_item_ids=capped,
        authored=authored,
    )

    # Buy-in preview: coverage + default emotions + neutral fit, no loss penalty
    main_arch = _archetype_or_neutral(req.main_archetype_name)
    secondary_arch = _archetype_or_neutral(req.secondary_archetype_name) if req.secondary_archetype_name else None
    buy_in_preview: dict[str, float] = {}
    for ps in phase_stakeholders:
        st_id = ps.stakeholder_id
        st_arch = _stakeholder_archetype(st_id) or _archetype_or_neutral(None)
        cov = scoring.coverage(st_id, all_intel, card_ids)
        fit_val = scoring.fit(st_arch, main_arch, secondary_arch)
        loss_val = scoring.loss(st_id, all_intel, card_ids)
        buy_in_preview[st_id] = round(
            scoring.buy_in(cov, 0.5, fit_val, loss_val), 3
        )

    return {
        "objections": [o.model_dump() for o in objections],
        "buy_in_preview": buy_in_preview,
    }


# ---------------------------------------------------------------------------
# /commit
# ---------------------------------------------------------------------------

class CommitRequest(BaseModel):
    username: str
    phase_id: int
    challenge_id: int
    card_item_ids: list[str] = []
    main_archetype_name: Optional[str] = None
    secondary_archetype_name: Optional[str] = None
    emotion_values: dict[str, dict[str, float]] = {}


@router.post("/commit")
async def commit_card(req: CommitRequest) -> dict[str, Any]:
    """Score the final card and return the pitch outcome.

    Outcome is one of PASS, SOFT_PASS, VETO.
    """
    from mlops_serious_game.application.pitch_debate_service import scoring

    card_ids = set(req.card_item_ids)
    all_intel = _load_intel(req.challenge_id)
    phase_stakeholders = _phase_stakeholders(req.phase_id)

    main_arch = _archetype_or_neutral(req.main_archetype_name)
    secondary_arch = _archetype_or_neutral(req.secondary_archetype_name) if req.secondary_archetype_name else None

    violated = _violated_boundary_ids(all_intel, card_ids)

    buy_in_map: dict[str, float] = {}
    room: list[tuple[str, str, float, bool]] = []

    for ps in phase_stakeholders:
        st_id = ps.stakeholder_id
        st_arch = _stakeholder_archetype(st_id) or _archetype_or_neutral(None)
        cov = scoring.coverage(st_id, all_intel, card_ids)
        fit_val = scoring.fit(st_arch, main_arch, secondary_arch)
        loss_val = scoring.loss(st_id, all_intel, card_ids)

        # Use provided emotions or default 0.5
        ev_raw = req.emotion_values.get(st_id, {})
        emo = scoring.emotions_norm(ev_raw) if ev_raw else 0.5

        bi = scoring.buy_in(cov, emo, fit_val, loss_val)
        buy_in_map[st_id] = round(bi, 3)
        boundary_violated = st_id in violated
        room.append((st_id, ps.power, bi, boundary_violated))

    result = scoring.outcome(room)

    vetoing = [st_id for st_id, power, bi, bv in room if power == "high" and (bv or bi < scoring.VETO_THRESHOLD)]
    soft_blocking = [st_id for st_id, power, bi, bv in room if power == "low" and (bv or bi < scoring.OBJECTION_THRESHOLD)]

    return {
        "outcome": result,
        "buy_in": buy_in_map,
        "vetoing": vetoing,
        "soft_blocking": soft_blocking,
    }


# ---------------------------------------------------------------------------
# /dialogue-options
# ---------------------------------------------------------------------------

class DialogueOptionsRequest(BaseModel):
    objection: dict[str, Any]
    phase_id: int
    challenge_id: int
    card_item_ids: list[str] = []
    player_item_ids: list[str] = []  # items held but not in card
    escalation_points: int = 3
    amendments_used: int = 0
    max_amendments: int = 3


@router.post("/dialogue-options")
async def get_dialogue_options(req: DialogueOptionsRequest) -> dict[str, Any]:
    """Return the five dialogue option availability specs for one objection."""
    from mlops_serious_game.application.pitch_debate_service.objections import (
        Objection,
        dialogue_options_for,
    )

    try:
        objection = Objection(**req.objection)
    except Exception as e:
        return {"error": str(e), "options": []}

    # Determine answering items: player holds items that specifically answer this objection
    answering_ids: set[str] = set(req.player_item_ids)

    opts = dialogue_options_for(
        objection=objection,
        answering_item_ids=answering_ids,
        escalation_points=req.escalation_points,
        amendment_budget=req.max_amendments - req.amendments_used,
        card_size=len(req.card_item_ids),
    )
    return {"options": [o.model_dump() for o in opts]}
