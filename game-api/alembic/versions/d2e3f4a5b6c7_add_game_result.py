"""Cache one computed results payload per run (docs/plans/results-screen.md)

Building a run's results folds its whole op log and event log. The player sees the screen once
but the admin aggregates read every finished run at once, so the payload is computed on first
request and kept.

One row per (user, run). The `user_id` FK cascades like every other per-player table, so an
account reset takes a player's results with the rest of their data.

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-09-21 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_GAME_RESULT_TABLE", "game_result")
USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            user_id INTEGER NOT NULL
                REFERENCES {USER_TABLE} (id) ON DELETE CASCADE,
            run_index INTEGER NOT NULL DEFAULT 1,
            payload JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            time_stamp TIMESTAMP WITHOUT TIME ZONE NOT NULL
                DEFAULT (now() AT TIME ZONE 'utc'),
            UNIQUE (user_id, run_index)
        );
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_name ON {TABLE} (user_name);")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_run ON {TABLE} (user_id, run_index);")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
