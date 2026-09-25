"""Add the speech_rate column to user_settings (docs/plans/player-settings-and-tts.md)

Multiplier on narration speed, applied on both TTS paths (tts_service.py's edge-tts `rate` and
window.speechSynthesis's `utterance.rate`). Defaults to 1.0 (unchanged).

Revision ID: 7f1a2b3c4d5e
Revises: 20eaf27c54bb
Create Date: 2026-09-24 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7f1a2b3c4d5e'
down_revision: Union[str, None] = '20eaf27c54bb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_USER_SETTINGS_TABLE", "user_settings")


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ADD COLUMN IF NOT EXISTS speech_rate DOUBLE PRECISION NOT NULL DEFAULT 1.0;
        """
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS speech_rate;")
