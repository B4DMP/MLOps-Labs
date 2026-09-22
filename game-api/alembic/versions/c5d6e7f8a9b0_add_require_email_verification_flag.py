"""Add a require_email_verification flag to campaigns (docs/plans/password-auth.md follow-up).

A campaign with this off still requires an email at registration, but skips the code-verification
step - the account is auto-verified straight away. A lighter opt-out than is_test_campaign, which
also drops the email requirement and the password-length policy. Existing campaigns are explicitly
backfilled to true (the previous, only behaviour) so this rollout never silently opts one out.

Revision ID: c5d6e7f8a9b0
Revises: b2d3e4f5a6c7
Create Date: 2026-09-23 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, None] = 'b2d3e4f5a6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPAIGN_TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {CAMPAIGN_TABLE} ADD COLUMN IF NOT EXISTS require_email_verification "
        f"BOOLEAN NOT NULL DEFAULT TRUE;"
    )
    op.execute(f"UPDATE {CAMPAIGN_TABLE} SET require_email_verification = TRUE;")


def downgrade() -> None:
    op.execute(f"ALTER TABLE {CAMPAIGN_TABLE} DROP COLUMN IF EXISTS require_email_verification;")
