"""Add an is_bot_campaign flag to campaigns.

Distinct from is_test_campaign (which changes registration behavior for human dev/debugging):
this flags campaigns created by automated suites (pytest, load/bot runs) so the admin panel can
hide them by default without touching registration rules. Existing campaigns are explicitly
backfilled to false so this rollout never silently hides a real campaign.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-29 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b4c5d6e7f8a9'
down_revision: Union[str, None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPAIGN_TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {CAMPAIGN_TABLE} ADD COLUMN IF NOT EXISTS is_bot_campaign "
        f"BOOLEAN NOT NULL DEFAULT FALSE;"
    )
    op.execute(f"UPDATE {CAMPAIGN_TABLE} SET is_bot_campaign = FALSE;")


def downgrade() -> None:
    op.execute(f"ALTER TABLE {CAMPAIGN_TABLE} DROP COLUMN IF EXISTS is_bot_campaign;")
