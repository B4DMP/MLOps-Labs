"""Where the pitch keeps its state between messages (plan 06).

The pitch itself lives on the challenge row, inside `action_card` under the `pitch` key, so a
reconnect mid-objection resumes exactly where the player was. Escalation Points and grudges live
on the session row: they outlive the challenge (D15, plan 07).
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select

from mlops_serious_game.application.pitch_debate_service.session import PitchState
from mlops_serious_game.infrastructure.database import GameChallenge, GameSession, get_session

PITCH_KEY = "pitch"
DEFAULT_ESCALATION_POINTS = 3


def _latest_challenge_row(session, username: str, phase_id: int, challenge_id: int):
    stmt = (
        select(GameChallenge)
        .where(
            GameChallenge.user_name == username,
            GameChallenge.phase_index == phase_id,
            GameChallenge.challenge_index == challenge_id,
        )
        .order_by(GameChallenge.id.desc())
    )
    return session.scalars(stmt).first()


def load_pitch(username: str, phase_id: int, challenge_id: int) -> Optional[PitchState]:
    with get_session() as db:
        row = _latest_challenge_row(db, username, phase_id, challenge_id)
        if row is None or not isinstance(row.action_card, dict):
            return None
        raw = row.action_card.get(PITCH_KEY)
        if not raw:
            return None
        try:
            return PitchState.model_validate(raw)
        except Exception:
            return None


def save_pitch(username: str, phase_id: int, challenge_id: int, state: PitchState) -> None:
    with get_session() as db:
        row = _latest_challenge_row(db, username, phase_id, challenge_id)
        if row is None:
            return
        card = dict(row.action_card) if isinstance(row.action_card, dict) else {}
        card[PITCH_KEY] = state.model_dump(mode="json")
        row.action_card = card
        db.commit()


def _session_row(db, username: str) -> Optional[GameSession]:
    return db.scalars(
        select(GameSession).where(GameSession.player == username).order_by(GameSession.id.desc())
    ).first()


def escalation_points(username: str) -> int:
    with get_session() as db:
        row = _session_row(db, username)
        if row is None or row.escalation_points is None:
            return DEFAULT_ESCALATION_POINTS
        return int(row.escalation_points)


def spend_escalation_point(username: str) -> int:
    """Spends one point and returns what is left. Never goes below zero."""
    with get_session() as db:
        row = _session_row(db, username)
        if row is None:
            return DEFAULT_ESCALATION_POINTS
        left = max(0, int(row.escalation_points or 0) - 1)
        row.escalation_points = left
        db.commit()
        return left


def add_grudges(username: str, entries: list[dict[str, Any]]) -> None:
    """Appends what stakeholders remember. Plan 07 reads these when the card is simulated."""
    if not entries:
        return
    with get_session() as db:
        row = _session_row(db, username)
        if row is None:
            return
        row.grudges = list(row.grudges or []) + entries
        db.commit()


def load_grudges(username: str) -> list[dict[str, Any]]:
    with get_session() as db:
        row = _session_row(db, username)
        return list(row.grudges or []) if row is not None else []


def emotion_values(username: str) -> dict[str, dict[str, float]]:
    """The last emotion values written for this player, per stakeholder."""
    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_name == username, GameChallenge.emotion_values.isnot(None))
            .order_by(GameChallenge.id.desc())
        ).first()
        if row is None or not isinstance(row.emotion_values, dict):
            return {}
        return {st_id: dict(ev) for st_id, ev in row.emotion_values.items() if isinstance(ev, dict)}


def apply_emotion_deltas(username: str, deltas: dict[str, float]) -> dict[str, dict[str, float]]:
    """Moves every dimension of a stakeholder by the same amount, clamped to [0, 1].

    One number per stakeholder is what the pitch produces: how the answer landed with them. The
    per dimension detail belongs to the conversation model, not to the deterministic scoring.
    """
    if not deltas:
        return emotion_values(username)
    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_name == username, GameChallenge.emotion_values.isnot(None))
            .order_by(GameChallenge.id.desc())
        ).first()
        if row is None or not isinstance(row.emotion_values, dict):
            return {}
        updated = {}
        for st_id, ev in row.emotion_values.items():
            if not isinstance(ev, dict):
                continue
            delta = deltas.get(st_id, 0.0)
            updated[st_id] = {
                dim: max(0.0, min(1.0, round(val + delta, 3))) if isinstance(val, (int, float)) else val
                for dim, val in ev.items()
            }
        row.emotion_values = updated
        db.commit()
        return updated
