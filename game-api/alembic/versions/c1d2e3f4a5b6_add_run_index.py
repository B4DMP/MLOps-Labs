"""Scope every per-player table to a run (docs/plans/results-screen.md, D1/D11)

A player can finish the game and start another one. Everything they do belongs to a run, so
every per-player table gains `run_index`, and the live game reads only the current run's rows.
Existing rows are run 1.

`game_progression_data.seeded_from_run` is what separates the two new-game modes (D11): null
means a fresh start, otherwise it names the run this one continues, and the graph/intel/event
reads resolve the whole chain rather than a single run. That one nullable column is the entire
difference between "clean slate" and "next iteration of the same system".

Nothing here deletes anything: a new game inserts a new run, it never resets an old one, because
the results screen and the admin aggregates read history that only exists if it is kept.

Revision ID: c1d2e3f4a5b6
Revises: f7a8b9c0d1e2
Create Date: 2026-09-21 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROGRESSION_TABLE = os.getenv("POSTGRES_PROGRESSION_DATA_TABLE", "game_progression_data")
CHALLENGE_TABLE = os.getenv("POSTGRES_GAME_CHALLENGE_DATA_TABLE", "game_challenge_data")
SESSION_TABLE = os.getenv("POSTGRES_GAME_SESSION_DATA_TABLE", "game_session_data")
INTEL_TABLE = os.getenv("POSTGRES_INTEL_DATA_TABLE", "intel_data")
GRAPH_OP_LOG_TABLE = os.getenv("POSTGRES_GRAPH_OP_LOG_TABLE", "graph_op_log")
GAME_EVENT_TABLE = os.getenv("POSTGRES_GAME_EVENT_TABLE", "game_event")
CAMPAIGN_TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")

RUN_SCOPED_TABLES = (
    PROGRESSION_TABLE,
    CHALLENGE_TABLE,
    SESSION_TABLE,
    INTEL_TABLE,
    GRAPH_OP_LOG_TABLE,
    GAME_EVENT_TABLE,
)


def upgrade() -> None:
    for table in RUN_SCOPED_TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS run_index INTEGER NOT NULL DEFAULT 1;"
        )
        op.execute(
            f"CREATE INDEX IF NOT EXISTS ix_{table}_user_run ON {table} (user_id, run_index);"
        )

    # Null means a fresh start; otherwise the run this one continues (the spiral chain).
    op.execute(
        f"ALTER TABLE {PROGRESSION_TABLE} ADD COLUMN IF NOT EXISTS seeded_from_run INTEGER;"
    )

    # Replay is off unless a campaign opts in, so research campaigns keep one run per player.
    op.execute(
        f"ALTER TABLE {CAMPAIGN_TABLE} "
        f"ADD COLUMN IF NOT EXISTS allow_replay BOOLEAN NOT NULL DEFAULT FALSE;"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {CAMPAIGN_TABLE} DROP COLUMN IF EXISTS allow_replay;")
    op.execute(f"ALTER TABLE {PROGRESSION_TABLE} DROP COLUMN IF EXISTS seeded_from_run;")
    for table in RUN_SCOPED_TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_user_run;")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS run_index;")
