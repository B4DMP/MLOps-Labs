"""Add the case board table (docs/plans/case-board.md, D7)

One row per player, run and challenge: the threads found, the hinted pairs and the guesses left.

Revision ID: d1e2f3a4b5c7
Revises: c7d8e9f0a1b3
Create Date: 2026-10-09 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c7'
down_revision: Union[str, None] = 'c7d8e9f0a1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_CASE_BOARD_TABLE", "case_board")
USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES {USER_TABLE}(id) ON DELETE CASCADE,
            run_index INTEGER NOT NULL DEFAULT 1,
            phase_index INTEGER NOT NULL,
            challenge_index INTEGER NOT NULL,
            found JSON NOT NULL DEFAULT '[]'::json,
            hints JSON NOT NULL DEFAULT '[]'::json,
            attempts_left INTEGER NOT NULL,
            CONSTRAINT uq_case_board_challenge UNIQUE (user_id, run_index, phase_index, challenge_index)
        );
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_id ON {TABLE} (user_id);")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
