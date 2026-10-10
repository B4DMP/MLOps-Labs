"""Postgres side of the case board. The only module here that touches the database."""

from sqlalchemy import select

from mlops_serious_game.application.case_board_service.state import BoardKey, BoardState
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import CaseBoardRow


def _where(key: BoardKey):
    return (
        CaseBoardRow.user_id == key.user_id,
        CaseBoardRow.run_index == key.run_index,
        CaseBoardRow.phase_index == key.phase_index,
        CaseBoardRow.challenge_index == key.challenge_index,
    )


class DbBoardStore:
    def load(self, key: BoardKey) -> BoardState | None:
        with get_session() as session:
            row = session.scalar(select(CaseBoardRow).where(*_where(key)))
            if row is None:
                return None
            return BoardState(found=row.found or [], hints=row.hints or [],
                              attempts_left=row.attempts_left, penciled=row.penciled or [])

    def save(self, key: BoardKey, state: BoardState) -> None:
        with get_session() as session:
            row = session.scalar(select(CaseBoardRow).where(*_where(key)))
            if row is None:
                row = CaseBoardRow(user_id=key.user_id, run_index=key.run_index,
                                   phase_index=key.phase_index, challenge_index=key.challenge_index)
                session.add(row)
            row.found, row.hints = list(state.found), [list(p) for p in state.hints]
            row.attempts_left = state.attempts_left
            row.penciled = list(state.penciled)
