"""Persistence for the graph op log. The only module in graph_service that touches the database."""

from typing import Optional

from sqlalchemy import delete, func, select

from mlops_serious_game.application.graph_service.apply import Replay, replay, seed_ops
from mlops_serious_game.domain.graph import GraphOp, LoggedOp, SourceKind
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import GraphOpLog
from mlops_serious_game.infrastructure.database.run_scope import current_run_index, run_chain
from mlops_serious_game.infrastructure.database.user_lookup import get_user_id

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
    report: Optional[dict] = None,
) -> int:
    """Appends one batch and returns its batch seq. `report` is the DeltaReport this batch
    produced (JSON-able dict), when there is one - see `load_report`."""
    if len(ops) >= SEQ_STRIDE:
        raise ValueError(f"batch of {len(ops)} ops exceeds SEQ_STRIDE")
    with get_session() as session:
        user_id = get_user_id(session, username)
        # Max over every run, not just this one: a spiral run continues an existing log, and its
        # ops have to sort after the ones it inherited or the fold replays out of order.
        last = session.scalar(select(func.max(GraphOpLog.seq)).where(GraphOpLog.user_id == user_id))
        seq = (last or 0) + 1
        session.add(
            GraphOpLog(
                user_name=username,
                user_id=user_id,
                run_index=current_run_index(session, user_id),
                seq=seq,
                phase_index=phase_index,
                challenge_template=challenge_template,
                challenge_loop_index=challenge_loop_index,
                source_kind=source_kind,
                source_id=source_id,
                ops=[op.model_dump(mode="json", exclude_none=True) for op in ops],
                report=report,
            )
        )
    return seq


def _rows(username: str, run_index: Optional[int] = None) -> list[GraphOpLog]:
    """Every op row this run can see, in `seq` order.

    The one chokepoint for reading the log: `load_log`, `load_state`, `snapshot_at` and
    `has_graph` all sit on it, so scoping it to the run chain is what makes "fresh start" start
    clean and "next iteration" carry the system forward (docs/plans/results-screen.md, D11).
    """
    with get_session() as session:
        user_id = get_user_id(session, username)
        rows = session.scalars(
            select(GraphOpLog)
            .where(
                GraphOpLog.user_id == user_id,
                GraphOpLog.run_index.in_(run_chain(session, user_id, run_index)),
            )
            .order_by(GraphOpLog.seq)
        ).all()
        session.expunge_all()
        return list(rows)


def _flatten(rows: list[GraphOpLog]) -> list[LoggedOp]:
    return [
        LoggedOp(seq=row.seq * SEQ_STRIDE + i, op=GraphOp.model_validate(raw))
        for row in rows
        for i, raw in enumerate(row.ops or [])
    ]


def load_log(username: str, run_index: Optional[int] = None) -> list[LoggedOp]:
    return _flatten(_rows(username, run_index))


def load_state(username: str, run_index: Optional[int] = None) -> Replay:
    """Ground truth plus player knowledge, for the current run or a named finished one.

    `run_index` is what lets the results screen read a run the player has already left, and what
    lets it fold a spiral run's *parent* to get the baseline that run inherited.
    """
    return replay(GraphFactory.get_graph(), load_log(username, run_index))


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
    """Whether this run already has a graph. A spiral run does, inherited, so `seed_if_empty`
    is a no-op for it and the carried system is not overwritten by a fresh seed."""
    with get_session() as session:
        user_id = get_user_id(session, username)
        return session.scalar(
            select(func.count(GraphOpLog.id)).where(
                GraphOpLog.user_id == user_id,
                GraphOpLog.run_index.in_(run_chain(session, user_id)),
            )
        ) > 0


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
    """Deletes a player's whole op log, across every run.

    **Not** how a new game starts. A fresh start opens a new run and leaves earlier runs intact,
    because the results screen and the admin aggregates read that history
    (docs/plans/results-screen.md). This exists for tests and for wiping an account outright.
    """
    with get_session() as session:
        session.execute(delete(GraphOpLog).where(GraphOpLog.user_id == get_user_id(session, username)))


def has_batch(username: str, source_id: str) -> bool:
    """Idempotency guard, scoped to the run chain.

    Without the chain a fresh start would see the previous run's `enter:<template>` batch and
    silently skip that challenge's `on_enter_ops`, so the new run would begin from a world the
    challenge never set up.
    """
    with get_session() as session:
        user_id = get_user_id(session, username)
        found = session.scalar(
            select(func.count(GraphOpLog.id)).where(
                GraphOpLog.user_id == user_id,
                GraphOpLog.run_index.in_(run_chain(session, user_id)),
                GraphOpLog.source_id == source_id,
            )
        )
        return found > 0


def load_report(username: str, source_id: str) -> Optional[dict]:
    """The DeltaReport a past batch produced, if any - the idempotent-replay counterpart to
    `has_batch`: when a batch was already persisted, its stored report is the correct answer for
    a repeat call, never a freshly recomputed one (D-question 1, code review)."""
    with get_session() as session:
        user_id = get_user_id(session, username)
        row = session.scalar(
            select(GraphOpLog)
            .where(
                GraphOpLog.user_id == user_id,
                GraphOpLog.run_index.in_(run_chain(session, user_id)),
                GraphOpLog.source_id == source_id,
            )
            .order_by(GraphOpLog.seq.desc())
        )
        return row.report if row else None


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
