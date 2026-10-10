"""Gathers what the case board needs for one player and challenge from the live game, then hands
it to the pure rules in `service.py` and `domain/relations.py`."""

from dataclasses import dataclass, field
from typing import Optional

from mlops_serious_game.application.case_board_service.state import BoardKey
from mlops_serious_game.application.intel_handler import (
    filter_edge_intel,
    is_first_playthrough,
    load_known_intel_items,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.relations import Relation, derive_relations
from mlops_serious_game.domain.requirement import IntelTag, counts_toward_readiness
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database import get_session
from mlops_serious_game.infrastructure.database.run_scope import current_run_index

MIN_PEOPLE = 3  # D5: fewer than this and there is no board


@dataclass
class BoardContext:
    key: BoardKey
    phase_id: int
    challenge_id: int
    visible: bool
    people: list[str]
    relations: list[Relation] = field(default_factory=list)
    held_ids: set[str] = field(default_factory=set)
    holder_of: dict[str, str] = field(default_factory=dict)
    names: dict[str, str] = field(default_factory=dict)
    attempts: int = 3

    def has_compromise(self, rel: Relation) -> bool:
        """A Trade-off sits on either side of a rift, so a middle path exists."""
        sides = set(rel.a_item_ids) | set(rel.b_item_ids)
        return any(getattr(RequirementFactory.get_requirement(i), "type", None) == IntelTag.TRADE_OFF for i in sides)


def board_context(user_id: int, challenge_index: Optional[int], phase_index: Optional[int]) -> Optional[BoardContext]:
    challenge = PhaseFactory.translate_challenge_index(challenge_index=challenge_index or 0, phase_index=phase_index or 0)
    return board_context_for(user_id, challenge) if challenge is not None else None


def board_context_for(user_id: int, challenge) -> BoardContext:
    phases = PhaseFactory.get_phases()
    in_phase = 0 <= challenge.phase_id < len(phases)
    people = [ps.stakeholder_id for ps in phases[challenge.phase_id].stakeholders] if in_phase else []
    with get_session() as session:
        run_index = current_run_index(session, user_id)
    key = BoardKey(user_id, run_index, challenge.phase_id, challenge.id)
    visible = len(people) >= MIN_PEOPLE and challenge.phase_id not in PhaseFactory.demo_phase_ids()
    ctx = BoardContext(
        key=key, phase_id=challenge.phase_id, challenge_id=challenge.id, visible=visible, people=people,
        attempts=EmotionFactory.get_pitch_tuning().case_board_attempts,
    )
    if not visible:
        return ctx
    reqs = filter_edge_intel(RequirementFactory.get_requirements_for_challenge(challenge.id), is_first_playthrough(user_id))
    in_room = set(people)
    ctx.relations = [
        r for r in derive_relations(reqs, getattr(challenge, "conflict", None), GraphFactory.get_graph())
        if r.a in in_room and r.b in in_room
    ]
    ctx.holder_of = {r.id: r.stakeholder_id for r in reqs if r.stakeholder_id}
    ctx.held_ids = {
        i.id for i in load_known_intel_items(user_id, up_to_phase=challenge.phase_id)
        if counts_toward_readiness(getattr(i, "intel_type", None))
    }
    ctx.names = {p: getattr(StakeholderFactory.get_stakeholder(p), "name", p) for p in people}
    return ctx


def pitch_markers(user_id: int, challenge) -> tuple[list[Relation], list[dict], list[dict], list[dict], list[dict]]:
    """The threads the player has confirmed, plus what the composer shows for them (D3): rifts a
    Trade-off can settle become `compromise_pairs`, chains become `after_notes`, shared steps become
    `shared_steps`, allies become `ally_pairs`. Only held items are named."""
    from mlops_serious_game.application.case_board_service.service import get_board
    from mlops_serious_game.application.case_board_service.store import DbBoardStore

    ctx = board_context_for(user_id, challenge)
    if not ctx.visible:
        return [], [], [], [], []
    confirmed = get_board(DbBoardStore(), ctx.key, ctx.relations, ctx.attempts).found
    pairs, notes, shared, allies = [], [], [], []
    for rel in confirmed:
        if rel.kind == "rift" and ctx.has_compromise(rel):
            pairs.append({
                "relation_id": rel.id, "a": rel.a, "b": rel.b, "target": rel.target,
                "item_ids": sorted((set(rel.a_item_ids) | set(rel.b_item_ids)) & ctx.held_ids),
            })
        elif rel.kind == "ally":
            allies.append({
                "relation_id": rel.id, "a": rel.a, "b": rel.b,
                "a_name": ctx.names.get(rel.a, rel.a), "b_name": ctx.names.get(rel.b, rel.b),
                "item_ids": sorted((set(rel.a_item_ids) | set(rel.b_item_ids)) & ctx.held_ids),
            })
        elif rel.kind == "step":
            shared.append({
                "relation_id": rel.id, "target": rel.target, "a": rel.a, "b": rel.b,
                "a_name": ctx.names.get(rel.a, rel.a), "b_name": ctx.names.get(rel.b, rel.b),
            })
        elif rel.kind == "chain":
            notes.append({
                "relation_id": rel.id, "target": rel.target, "waits": rel.a, "after": rel.b,
                "after_name": ctx.names.get(rel.b, rel.b), "via": rel.via,
            })
    return list(confirmed), pairs, notes, shared, allies
