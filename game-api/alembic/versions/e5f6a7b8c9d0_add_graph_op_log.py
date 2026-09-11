"""Add the append-only MLOps graph op log

Each row is one batch of graph ops for one player. The player's graph state is the fold of
their rows in `seq` order, so nothing else about the graph is stored.

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-11 10:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_GRAPH_OP_LOG_TABLE", "graph_op_log")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            seq INTEGER NOT NULL,
            phase_index INTEGER NOT NULL,
            challenge_template VARCHAR(255) NOT NULL,
            challenge_loop_index INTEGER NOT NULL DEFAULT 0,
            source_kind VARCHAR(32) NOT NULL,
            source_id VARCHAR(255),
            ops JSON NOT NULL DEFAULT '[]'::json,
            time_stamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
            CONSTRAINT uq_{TABLE}_user_seq UNIQUE (user_name, seq)
        );
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_name ON {TABLE} (user_name);")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
