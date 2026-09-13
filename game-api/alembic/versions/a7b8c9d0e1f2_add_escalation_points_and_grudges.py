"""Add escalation points and grudges to the game session

Escalation Points are 3 per game and never regenerate (D15). They are spent on a Veto Breaker or
an Emergency Addendum in the merged pitch phase. Grudges are what neglected stakeholders remember
after a soft pass or an override, fired later in the simulation phase.

Existing sessions start with the full three points and no grudges.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-09-12 09:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_GAME_SESSION_DATA_TABLE", "game_session_data")


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ADD COLUMN IF NOT EXISTS escalation_points INTEGER NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS grudges JSON NOT NULL DEFAULT '[]'::json;
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        DROP COLUMN IF EXISTS escalation_points,
        DROP COLUMN IF EXISTS grudges;
        """
    )
