"""Add an intro_phase_enabled flag to campaigns.

Off by default: phase 0 ("Introduction") is currently skipped entirely and every campaign
starts at phase 1. Existing campaigns are explicitly backfilled to false so this rollout
never silently turns the intro phase on for a campaign already in flight.

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-29 00:20:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPAIGN_TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {CAMPAIGN_TABLE} ADD COLUMN IF NOT EXISTS intro_phase_enabled "
        f"BOOLEAN NOT NULL DEFAULT FALSE;"
    )
    op.execute(f"UPDATE {CAMPAIGN_TABLE} SET intro_phase_enabled = FALSE;")


def downgrade() -> None:
    op.execute(f"ALTER TABLE {CAMPAIGN_TABLE} DROP COLUMN IF EXISTS intro_phase_enabled;")
