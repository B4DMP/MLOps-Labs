"""Persistence for the graph op log. The only module in graph_service that touches the database."""

from typing import Optional

from sqlalchemy import delete, func, select

from mlops_serious_game.application.graph_service.apply import Replay, replay, seed_ops
from mlops_serious_game.domain.graph import GraphOp, LoggedOp, SourceKind
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import GraphOpLog

# Ops inside a batch get seq = batch_seq * SEQ_STRIDE + index, so order survives within a batch.
SEQ_STRIDE = 10_000


def append_ops(
    username: str,
    ops: list[GraphOp],
    *,
    phase_index: int,
    challenge_template: str,
    challenge_loop_index: int = 0,
    source_kind: SourceKind,
    source_id: Optional[str] = None,
) -> int:
    """Appends one batch and returns its batch seq."""
    if len(ops) >= SEQ_STRIDE:
        raise ValueError(f"batch of {len(ops)} ops exceeds SEQ_STRIDE")
    with get_session() as session:
        last = session.scalar(select(func.max(GraphOpLog.seq)).where(GraphOpLog.user_name == username))
        seq = (last or 0) + 1
        session.add(
            GraphOpLog(
                user_name=username,
                seq=seq,
                phase_index=phase_index,
                challenge_template=challenge_template,
                challenge_loop_index=challenge_loop_index,
                source_kind=source_kind,
                source_id=source_id,
                ops=[op.model_dump(mode="json", exclude_none=True) for op in ops],
            )
        )
    return seq


def _rows(username: str) -> list[GraphOpLog]:
    with get_session() as session:
        rows = session.scalars(
            select(GraphOpLog).where(GraphOpLog.user_name == username).order_by(GraphOpLog.seq)
        ).all()
        session.expunge_all()
        return list(rows)


def _flatten(rows: list[GraphOpLog]) -> list[LoggedOp]:
    return [
        LoggedOp(seq=row.seq * SEQ_STRIDE + i, op=GraphOp.model_validate(raw))
        for row in rows
        for i, raw in enumerate(row.ops or [])
    ]


def load_log(username: str) -> list[LoggedOp]:
    return _flatten(_rows(username))


def load_state(username: str) -> Replay:
    """Ground truth plus player knowledge."""
    return replay(GraphFactory.get_graph(), load_log(username))


def snapshot_at(username: str, phase_index: int, challenge_template: str) -> Optional[Replay]:
    """State right after the last batch logged for this phase and challenge, or None."""
    rows = _rows(username)
    last = max(
        (i for i, r in enumerate(rows) if r.phase_index == phase_index and r.challenge_template == challenge_template),
        default=None,
    )
    if last is None:
        return None
    return replay(GraphFactory.get_graph(), _flatten(rows[: last + 1]))


def has_graph(username: str) -> bool:
    with get_session() as session:
        return session.scalar(select(func.count(GraphOpLog.id)).where(GraphOpLog.user_name == username)) > 0


def seed_if_empty(username: str, *, phase_index: int, challenge_template: str) -> bool:
    """Writes the starting graph for a new player. Returns True when it seeded."""
    if has_graph(username):
        return False
    append_ops(
        username,
        seed_ops(GraphFactory.get_graph()),
        phase_index=phase_index,
        challenge_template=challenge_template,
        source_kind="challenge_seed",
    )
    return True


def clear_graph(username: str) -> None:
    with get_session() as session:
        session.execute(delete(GraphOpLog).where(GraphOpLog.user_name == username))


def has_batch(username: str, source_id: str) -> bool:
    with get_session() as session:
        found = session.scalar(
            select(func.count(GraphOpLog.id)).where(GraphOpLog.user_name == username, GraphOpLog.source_id == source_id)
        )
        return found > 0


def enter_challenge(username: str, challenge) -> bool:
    """Seeds the graph if needed and fires the challenge's `on_enter_ops` once.
    Returns True when world events were logged."""
    seed_if_empty(username, phase_index=challenge.phase_id, challenge_template=challenge.template_id)
    source_id = f"enter:{challenge.template_id}"
    if not challenge.on_enter_ops or has_batch(username, source_id):
        return False
    ops = [
        GraphOp.model_validate({**raw, "source_kind": "world_event", "source_id": source_id})
        for raw in challenge.on_enter_ops
    ]
    append_ops(
        username,
        ops,
        phase_index=challenge.phase_id,
        challenge_template=challenge.template_id,
        source_kind="world_event",
        source_id=source_id,
    )
    return True
