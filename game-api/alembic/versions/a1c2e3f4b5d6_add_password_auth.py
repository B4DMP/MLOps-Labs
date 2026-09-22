"""Migrate player auth from shared campaign-key login to per-user password + email
verification (docs/plans/password-auth.md).

Existing accounts have no email or password, so they are wiped rather than migrated - players
re-register. This only runs once (the first time this revision is applied), so it never wipes
accounts created after the migration.

Revision ID: a1c2e3f4b5d6
Revises: e3f4a5b6c7d8
Create Date: 2026-09-22 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1c2e3f4b5d6'
down_revision: Union[str, None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")


def upgrade() -> None:
    # No email/password on existing rows - can't migrate them, so start clean. Cascades to every
    # dependent per-player table via their existing ON DELETE CASCADE FKs.
    op.execute(f"DELETE FROM {USER_TABLE};")

    op.execute(f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS email VARCHAR(255);")
    op.execute(f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);")
    op.execute(f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS users_on_machine INTEGER;")
    op.execute(
        f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;"
    )
    op.execute(f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS verification_code VARCHAR(6);")
    op.execute(
        f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS verification_code_expires_at "
        f"TIMESTAMP WITHOUT TIME ZONE;"
    )
    op.execute(f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS password_reset_code VARCHAR(6);")
    op.execute(
        f"ALTER TABLE {USER_TABLE} ADD COLUMN IF NOT EXISTS password_reset_code_expires_at "
        f"TIMESTAMP WITHOUT TIME ZONE;"
    )

    # Safe: the table is empty after the DELETE above.
    op.execute(f"ALTER TABLE {USER_TABLE} ALTER COLUMN email SET NOT NULL;")
    op.execute(f"ALTER TABLE {USER_TABLE} ALTER COLUMN password_hash SET NOT NULL;")
    op.execute(f"ALTER TABLE {USER_TABLE} ALTER COLUMN users_on_machine SET NOT NULL;")

    op.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{USER_TABLE}_email ON {USER_TABLE} (email);")


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS ix_{USER_TABLE}_email;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS password_reset_code_expires_at;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS password_reset_code;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS verification_code_expires_at;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS verification_code;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS is_verified;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS users_on_machine;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS password_hash;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS email;")
