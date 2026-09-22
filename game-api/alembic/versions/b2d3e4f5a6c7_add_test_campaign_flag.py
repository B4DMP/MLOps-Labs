"""Add an is_test_campaign flag to campaigns (docs/plans/password-auth.md follow-up).

A campaign flagged as a test campaign lets its players register without an email and skips
email verification entirely - registration logs them straight into the game. Existing campaigns
are explicitly backfilled to false so this rollout never silently opts one in.

Revision ID: b2d3e4f5a6c7
Revises: a1c2e3f4b5d6
Create Date: 2026-09-22 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b2d3e4f5a6c7'
down_revision: Union[str, None] = 'a1c2e3f4b5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPAIGN_TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {CAMPAIGN_TABLE} ADD COLUMN IF NOT EXISTS is_test_campaign "
        f"BOOLEAN NOT NULL DEFAULT FALSE;"
    )
    # Explicit, not just relying on the column default: every campaign that existed before this
    # revision must come back as a real (non-test) campaign.
    op.execute(f"UPDATE {CAMPAIGN_TABLE} SET is_test_campaign = FALSE;")


def downgrade() -> None:
    op.execute(f"ALTER TABLE {CAMPAIGN_TABLE} DROP COLUMN IF EXISTS is_test_campaign;")
