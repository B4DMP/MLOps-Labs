"""Add the bug_report table

One row per "Report a Bug" submission: the player's message plus a client-supplied debug
snapshot (current phase/challenge, page URL, user agent). No docker/container logs involved.

Revision ID: e1f2a3b4c5d6
Revises: d3e4f5a6b7c8
Create Date: 2026-09-29 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_BUG_REPORT_TABLE", "bug_report")
USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            user_id INTEGER NOT NULL REFERENCES {USER_TABLE} (id) ON DELETE CASCADE,
            message VARCHAR(4000) NOT NULL,
            page_url VARCHAR(2048),
            user_agent VARCHAR(512),
            debug_info JSON NOT NULL DEFAULT '{{}}'::json,
            time_stamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_name ON {TABLE} (user_name);")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_id ON {TABLE} (user_id);")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
