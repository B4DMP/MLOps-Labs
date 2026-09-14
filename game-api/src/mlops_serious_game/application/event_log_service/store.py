"""Persistence for the event log (plan 11, D51). The only module in event_log_service that
touches the database - everything else builds `GameEvent`s pinned to nothing but its own inputs.
"""

from sqlalchemy import func, select

from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import GameEventRow
from mlops_serious_game.infrastructure.database.user_lookup import get_user_id


def append_events(username: str, events: list[GameEvent]) -> list[GameEvent]:
    """Assigns each event the next per-user `seq` and persists it. Returns the stamped events,
    in the same order, ready to send straight back over `log:events`."""
    if not events:
        return []
    with get_session() as session:
        user_id = get_user_id(session, username)
        last = session.scalar(select(func.max(GameEventRow.seq)).where(GameEventRow.user_id == user_id))
        seq = last or 0
        stamped: list[GameEvent] = []
        for event in events:
            seq += 1
            stamped_event = event.model_copy(update={"seq": seq})
            stamped.append(stamped_event)
            session.add(GameEventRow(
                user_name=username,
                user_id=user_id,
                seq=seq,
                phase_id=stamped_event.phase_id,
                challenge_id=stamped_event.challenge_id,
                step=stamped_event.step,
                kind=stamped_event.kind,
                subject_id=stamped_event.subject_id,
                direction=stamped_event.direction,
                magnitude=stamped_event.magnitude,
                cause=stamped_event.cause,
                params=stamped_event.params,
                refs=stamped_event.refs,
            ))
    return stamped


def _from_row(row: GameEventRow) -> GameEvent:
    return GameEvent(
        seq=row.seq,
        phase_id=row.phase_id,
        challenge_id=row.challenge_id,
        step=row.step,
        kind=row.kind,
        subject_id=row.subject_id,
        direction=row.direction,
        magnitude=row.magnitude,
        cause=row.cause,
        params=row.params or {},
        refs=row.refs or {},
    )


def load_events(username: str, since_seq: int = 0) -> list[GameEvent]:
    """Every event for this player, in order. `since_seq` narrows to what came after it, for a
    client that already has the earlier history."""
    with get_session() as session:
        rows = session.scalars(
            select(GameEventRow)
            .where(GameEventRow.user_id == get_user_id(session, username), GameEventRow.seq > since_seq)
            .order_by(GameEventRow.seq)
        ).all()
        return [_from_row(row) for row in rows]
