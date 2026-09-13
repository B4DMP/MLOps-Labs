"""Add is_active and use_questionnaire attributes to campaigns

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-09-11 16:10:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
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
