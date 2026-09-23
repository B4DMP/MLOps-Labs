"""Add pending-email-change columns to user_data
(docs/plans/session-persistence-and-url-routing.md, Profile management).

Mirrors the existing password_reset_code / password_reset_code_expires_at pair: a separate
pending_email + code, so a request never touches the live `email` column until the new address is
confirmed, and a change-password or forgot-password flow in flight at the same time can't collide
with it.

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-09-23 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e8f9a0b1c2d3'
down_revision: Union[str, None] = 'd7e8f9a0b1c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {USER_TABLE} "
        f"ADD COLUMN IF NOT EXISTS pending_email VARCHAR(255), "
        f"ADD COLUMN IF NOT EXISTS email_change_code VARCHAR(6), "
        f"ADD COLUMN IF NOT EXISTS email_change_code_expires_at TIMESTAMP;"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE {USER_TABLE} "
        f"DROP COLUMN IF EXISTS pending_email, "
        f"DROP COLUMN IF EXISTS email_change_code, "
        f"DROP COLUMN IF EXISTS email_change_code_expires_at;"
    )
