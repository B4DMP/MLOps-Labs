"""Add the append-only game event log (plan 11, D51)

One row per `GameEvent`: everything that happens in a game, with a cause the player can read.
`seq` is monotonic per user, assigned on append by `application/event_log_service/store.py`.

Revision ID: a1b2c3d4e5f7
Revises: d0e1f2a3b4c5
Create Date: 2026-09-13 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_GAME_EVENT_TABLE", "game_event")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            seq INTEGER NOT NULL,
            phase_id INTEGER NOT NULL,
            challenge_id INTEGER NOT NULL,
            step VARCHAR(16) NOT NULL,
            kind VARCHAR(16) NOT NULL,
            subject_id VARCHAR(255),
            direction VARCHAR(8) NOT NULL,
            magnitude VARCHAR(16),
            cause VARCHAR(128) NOT NULL,
            params JSON NOT NULL DEFAULT '{{}}'::json,
            refs JSON NOT NULL DEFAULT '{{}}'::json,
            time_stamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
            CONSTRAINT uq_{TABLE}_user_seq UNIQUE (user_name, seq)
        );
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_name ON {TABLE} (user_name);")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
