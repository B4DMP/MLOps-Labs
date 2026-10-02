"""Drop the username: players are identified by their email (and, internally, `user_id`).

Removes `user_data.user_name` and every legacy `user_name`/`player` string column on the per-player
tables. All of them were write-only debt behind the `user_id` FK. The two logs that had a
`(user_name, seq)` unique constraint get `(user_id, seq)` instead. Teachers keep their `user_name`.

Revision ID: a9b8c7d6e5f4
Revises: a2b3c4d5e6f7
Create Date: 2026-09-29 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a9b8c7d6e5f4'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")

# (table, legacy string column)
CHILD_TABLES = [
    (os.getenv("POSTGRES_PROGRESSION_DATA_TABLE", "game_progression_data"), "user_name"),
    (os.getenv("POSTGRES_GAME_CHALLENGE_DATA_TABLE", "game_challenge_data"), "user_name"),
    (os.getenv("POSTGRES_GAME_SESSION_DATA_TABLE", "game_session_data"), "player"),
    (os.getenv("POSTGRES_INTEL_DATA_TABLE", "intel_data"), "user_name"),
    (os.getenv("POSTGRES_GRAPH_OP_LOG_TABLE", "graph_op_log"), "user_name"),
    (os.getenv("POSTGRES_GAME_EVENT_TABLE", "game_event"), "user_name"),
    (os.getenv("POSTGRES_USER_SETTINGS_TABLE", "user_settings"), "user_name"),
    (os.getenv("POSTGRES_GAME_RESULT_TABLE", "game_result"), "user_name"),
    (os.getenv("POSTGRES_BUG_REPORT_TABLE", "bug_report"), "user_name"),
]
SEQ_TABLES = [
    os.getenv("POSTGRES_GRAPH_OP_LOG_TABLE", "graph_op_log"),
    os.getenv("POSTGRES_GAME_EVENT_TABLE", "game_event"),
]


def upgrade() -> None:
    for table in SEQ_TABLES:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS uq_{table}_user_seq")
    for table, column in CHILD_TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS user_name")
    for table in SEQ_TABLES:
        op.execute(f"ALTER TABLE {table} ADD CONSTRAINT uq_{table}_user_seq UNIQUE (user_id, seq)")


def downgrade() -> None:
    for table in SEQ_TABLES:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS uq_{table}_user_seq")

    # Names can't be recovered, so each account gets a unique placeholder.
    op.execute(f"ALTER TABLE {USER_TABLE} ADD COLUMN user_name VARCHAR(255)")
    op.execute(f"UPDATE {USER_TABLE} SET user_name = 'user_' || id")
    op.execute(f"ALTER TABLE {USER_TABLE} ALTER COLUMN user_name SET NOT NULL")
    op.execute(f"CREATE UNIQUE INDEX ix_{USER_TABLE}_user_name ON {USER_TABLE} (user_name)")

    for table, column in CHILD_TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR(255)")
        op.execute(
            f"UPDATE {table} SET {column} = {USER_TABLE}.user_name "
            f"FROM {USER_TABLE} WHERE {USER_TABLE}.id = {table}.user_id"
        )
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET NOT NULL")
        op.execute(f"CREATE INDEX ix_{table}_{column} ON {table} ({column})")

    for table in SEQ_TABLES:
        op.execute(f"ALTER TABLE {table} ADD CONSTRAINT uq_{table}_user_seq UNIQUE (user_name, seq)")
