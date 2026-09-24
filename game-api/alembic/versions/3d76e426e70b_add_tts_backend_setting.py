"""Add the tts_backend column to user_settings (docs/plans/player-settings-and-tts.md)

"auto" (default) prefers server-side edge-tts narration and falls back to
window.speechSynthesis on a failed backend call; "webspeech" skips the backend entirely and
forces the old client-only behaviour.

Revision ID: 3d76e426e70b
Revises: e8f9a0b1c2d3
Create Date: 2026-09-24 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '3d76e426e70b'
down_revision: Union[str, None] = 'e8f9a0b1c2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_USER_SETTINGS_TABLE", "user_settings")


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ADD COLUMN IF NOT EXISTS tts_backend VARCHAR(32) NOT NULL DEFAULT 'auto';
        """
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS tts_backend;")
