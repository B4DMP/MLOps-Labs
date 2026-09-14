"""Add is_active and use_questionnaire attributes to campaigns

Came in from main with revision id e5f6a7b8c9d0, which graph-redesign already used for
add_graph_op_log. Re-numbered and moved to the end of the chain so there is one head.
Both statements are IF NOT EXISTS, so a database that already has the columns is fine.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-09-11 16:10:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS use_questionnaire BOOLEAN NOT NULL DEFAULT TRUE;
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        DROP COLUMN IF EXISTS is_active,
        DROP COLUMN IF EXISTS use_questionnaire;
        """
    )
