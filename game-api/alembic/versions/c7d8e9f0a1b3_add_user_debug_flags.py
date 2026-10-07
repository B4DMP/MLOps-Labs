"""Per-account debug flags, managed from the admin panel

`user_data.debug_flags` holds e.g. {"graph": true, "dossier": true}. A flag is on for an account
when it is on here or in the global settings, so a deployment can keep the global switches off
and still open the graph debug view or the answer key for one account.

Revision ID: c7d8e9f0a1b3
Revises: f1e2d3c4b5a6
Create Date: 2026-10-07 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b3'
down_revision: Union[str, None] = 'f1e2d3c4b5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {USER_TABLE} "
        f"ADD COLUMN IF NOT EXISTS debug_flags JSON NOT NULL DEFAULT '{{}}'::json;"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS debug_flags;")
