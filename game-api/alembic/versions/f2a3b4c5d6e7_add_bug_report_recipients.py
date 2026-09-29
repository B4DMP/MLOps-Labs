"""Add the bug_report_recipients table

Single-row (id=1) table holding who gets emailed on a new bug report, admin-editable. Seeded
with the two default addresses so notifications work before an admin ever touches the setting.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-29 00:10:00.000000

"""
import json
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_BUG_REPORT_RECIPIENTS_TABLE", "bug_report_recipients")
DEFAULT_RECIPIENTS = ["bela.veltrup@rwth-aachen.de", "slupczynski@dbis.rwth-aachen.de"]


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id INTEGER PRIMARY KEY,
            recipients JSON NOT NULL DEFAULT '[]'::json,
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );
        """
    )
    op.execute(
        f"""
        INSERT INTO {TABLE} (id, recipients)
        VALUES (1, '{json.dumps(DEFAULT_RECIPIENTS)}'::json)
        ON CONFLICT (id) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
