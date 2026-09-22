"""Persistence for the event log (plan 11, D51). The only module in event_log_service that
touches the database - everything else builds `GameEvent`s pinned to nothing but its own inputs.
"""

from sqlalchemy import func, select

from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import GameEventRow
from mlops_serious_game.infrastructure.database.run_scope import current_run_index, run_chain
from mlops_serious_game.infrastructure.database.user_lookup import get_user_id


def append_events(username: str, events: list[GameEvent]) -> list[GameEvent]:
    """Assigns each event the next per-user `seq` and persists it. Returns the stamped events,
    in the same order, ready to send straight back over `log:events`."""
    if not events:
        return []
    with get_session() as session:
        user_id = get_user_id(session, username)
        run_index = current_run_index(session, user_id)
        # Max over every run: `seq` stays monotonic per player so a spiral run's events sort
        # after the ones it inherited, and the client's `since_seq` never goes backwards.
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
                run_index=run_index,
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


def load_events(username: str, since_seq: int = 0, run_index: int | None = None) -> list[GameEvent]:
    """Every event this run can see, in order. `since_seq` narrows to what came after it, for a
    client that already has the earlier history.

    Scoped to the run chain, so a fresh start shows an empty log while a spiral run keeps the
    history that explains the system it inherited. Pass `run_index` to read a finished run, which
    is what the results screen does.
    """
    with get_session() as session:
        user_id = get_user_id(session, username)
        rows = session.scalars(
            select(GameEventRow)
            .where(
                GameEventRow.user_id == user_id,
                GameEventRow.run_index.in_(run_chain(session, user_id, run_index)),
                GameEventRow.seq > since_seq,
            )
            .order_by(GameEventRow.seq)
        ).all()
        return [_from_row(row) for row in rows]
