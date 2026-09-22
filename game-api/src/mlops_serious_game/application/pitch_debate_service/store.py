"""Where the pitch keeps its state between messages (plan 06).

The pitch itself lives on the challenge row, inside `action_card` under the `pitch` key, so a
reconnect mid-objection resumes exactly where the player was. Escalation Points and grudges live
on the session row: they outlive the challenge (D15, plan 07).
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.application.pitch_debate_service.scoring import shift_emotions
from mlops_serious_game.application.pitch_debate_service.session import PitchState
from mlops_serious_game.infrastructure.database import GameChallenge, GameSession, get_session, get_user_id
from mlops_serious_game.infrastructure.database.run_scope import current_run_index

PITCH_KEY = "pitch"
DEFAULT_ESCALATION_POINTS = 3


def _latest_challenge_row(session, username: str, phase_id: int, challenge_id: int):
    stmt = (
        select(GameChallenge)
        .where(
            GameChallenge.user_id == get_user_id(session, username),
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


METRIC_CHANGES_KEY = "metric_changes"


def set_metric_changes(username: str, phase_id: int, challenge_id: int, metric_changes: dict[str, int]) -> None:
    """Records what the simulation actually did to the metrics, on the challenge's own row.

    `handle_state_update_request`'s "proceed to next milestone" step is the only place metric
    values are actually advanced, and it does so from `action_card["metric_changes"]" - but the
    client that calls it never sends that key (see the note in `ac_simulation.tsx`), so without
    this call the graph-driven `DeltaReport.metric_deltas` computed here is shown on screen and
    then silently dropped. Writing it onto the row is what lets that step pick it up later,
    whatever the client's own payload does or doesn't carry.

    Idempotent, matching `run_simulation`'s own idempotency: a repeat call for an already-simulated
    challenge is handed back the same stored report and so writes the same dict here.
    """
    if not metric_changes:
        return
    with get_session() as db:
        row = _latest_challenge_row(db, username, phase_id, challenge_id)
        if row is None:
            return
        card = dict(row.action_card) if isinstance(row.action_card, dict) else {}
        card[METRIC_CHANGES_KEY] = dict(metric_changes)
        row.action_card = card
        db.commit()


def _session_row(db, username: str) -> Optional[GameSession]:
    """This run's session row: escalation points and grudges belong to one playthrough, so a
    new game must not read the last one's (docs/plans/results-screen.md, D1)."""
    user_id = get_user_id(db, username)
    return db.scalars(
        select(GameSession)
        .where(GameSession.user_id == user_id, GameSession.run_index == current_run_index(db, user_id))
        .order_by(GameSession.id.desc())
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


def replace_grudges(username: str, entries: list[dict[str, Any]]) -> None:
    """The simulation rewrites the list: spent grudges drop out, new ones come in."""
    with get_session() as db:
        row = _session_row(db, username)
        if row is None:
            return
        row.grudges = list(entries)
        db.commit()


def load_grudges(username: str) -> list[dict[str, Any]]:
    with get_session() as db:
        row = _session_row(db, username)
        return list(row.grudges or []) if row is not None else []


def _emotion_row(db, username: str):
    """The newest challenge row that actually carries emotion values.

    Rows are created with an empty `emotion_values` dict before anyone has spoken, and an empty
    dict is not NULL, so filtering on NULL alone hands back nothing and every stakeholder reads
    as neutral. Walk back until a row has something in it.
    """
    ev_user_id = get_user_id(db, username)
    rows = db.scalars(
        select(GameChallenge)
        .where(
            GameChallenge.user_id == ev_user_id,
            # This run only: a new game starts the room on neutral, never on how the last one left it.
            GameChallenge.run_index == current_run_index(db, ev_user_id),
            GameChallenge.emotion_values.isnot(None),
        )
        .order_by(GameChallenge.id.desc())
    ).all()
    for row in rows:
        if isinstance(row.emotion_values, dict) and any(
            isinstance(ev, dict) and ev for ev in row.emotion_values.values()
        ):
            return row
    return None


def _defaults(st_ids: list[str]) -> dict[str, dict[str, float]]:
    from mlops_serious_game.domain.emotion_factory import EmotionFactory

    return {st_id: dict(EmotionFactory.create_default_emotion_values()) for st_id in st_ids}


def emotion_values(username: str, st_ids: Optional[list[str]] = None) -> dict[str, dict[str, float]]:
    """The last emotion values written for this player, per stakeholder.

    Falls back to the configured neutral defaults for anyone the history does not cover, so a
    pitch before the first conversation scores against real numbers instead of an empty dict.
    """
    with get_session() as db:
        row = _emotion_row(db, username)
        stored = (
            {st_id: dict(ev) for st_id, ev in row.emotion_values.items() if isinstance(ev, dict) and ev}
            if row is not None
            else {}
        )
    if not st_ids:
        return stored
    return {**_defaults(st_ids), **stored}


def apply_emotion_deltas(
    username: str,
    deltas: dict[str, float],
    st_ids: Optional[list[str]] = None,
) -> dict[str, dict[str, float]]:
    """Moves every dimension of a stakeholder by the same amount, clamped to [0, 1].

    One number per stakeholder is what the pitch produces: how the answer landed with them. The
    per dimension detail belongs to the conversation model, not to the deterministic scoring.
    """
    if not deltas:
        return emotion_values(username, st_ids)
    with get_session() as db:
        row = _emotion_row(db, username)
        base = (
            {st_id: dict(ev) for st_id, ev in row.emotion_values.items() if isinstance(ev, dict) and ev}
            if row is not None
            else {}
        )
        # Nobody has spoken yet, or only empty rows exist: start the affected stakeholders at the
        # configured neutral so the pitch's own deltas are not written into a void.
        for st_id in list(deltas) + list(st_ids or []):
            base.setdefault(st_id, dict(_defaults([st_id])[st_id]))
        target = row
        if target is None:
            fallback_user_id = get_user_id(db, username)
            target = db.scalars(
                select(GameChallenge)
                .where(
                    GameChallenge.user_id == fallback_user_id,
                    GameChallenge.run_index == current_run_index(db, fallback_user_id),
                )
                .order_by(GameChallenge.id.desc())
            ).first()
        if target is None or not base:
            return base
        updated = shift_emotions(base, deltas)
        target.emotion_values = updated
        flag_modified(target, "emotion_values")
        db.commit()
        return updated
