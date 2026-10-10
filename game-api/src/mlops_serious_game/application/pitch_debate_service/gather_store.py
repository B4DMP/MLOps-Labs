"""Where a Gather conversation keeps its state between turns (plan 11, D49).

Conversations live on the challenge row, inside `action_card` under the `gather` key, keyed by
"{card_id}:{stakeholder_id}" - one per target, so a card played against several stakeholders at
once (Team Sync-Up) keeps each one's turns separate. A repeatable-target card (Investigate
Component) reuses the same key across plays instead, so the conversation continues rather than
resetting. Same shelf `pitch` already uses for `PitchState` (`pitch_debate_service.store`).
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select

from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.application.pitch_debate_service.gather import GatherConversation
from mlops_serious_game.infrastructure.database import GameChallenge, get_session

GATHER_KEY = "gather"


def _key(card_id: str, stakeholder_id: str) -> str:
    return f"{card_id}:{stakeholder_id}"


def _latest_challenge_row(db, user_id: int, phase_id: int, challenge_id: int):
    stmt = (
        select(GameChallenge)
        .where(
            GameChallenge.user_id == user_id,
            GameChallenge.phase_index == phase_id,
            GameChallenge.challenge_index == challenge_id,
        )
        .order_by(GameChallenge.id.desc())
    )
    return db.scalars(stmt).first()


def load_conversation(
    user_id: int, phase_id: int, challenge_id: int, card_id: str, stakeholder_id: str
) -> Optional[GatherConversation]:
    with get_session() as db:
        row = _latest_challenge_row(db, user_id, phase_id, challenge_id)
        if row is None or not isinstance(row.action_card, dict):
            return None
        raw = (row.action_card.get(GATHER_KEY) or {}).get(_key(card_id, stakeholder_id))
        if not raw:
            return None
        try:
            return GatherConversation.model_validate(raw)
        except Exception:
            return None


def save_conversation(user_id: int, phase_id: int, challenge_id: int, conversation: GatherConversation) -> None:
    with get_session() as db:
        row = _latest_challenge_row(db, user_id, phase_id, challenge_id)
        if row is None:
            return
        card = dict(row.action_card) if isinstance(row.action_card, dict) else {}
        conversations = dict(card.get(GATHER_KEY) or {})
        conversations[_key(conversation.card_id, conversation.stakeholder_id)] = conversation.model_dump(mode="json")
        card[GATHER_KEY] = conversations
        row.action_card = card
        flag_modified(row, "action_card")
        db.commit()
