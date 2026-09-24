"""Add the player_voice_gender column to user_settings (docs/plans/player-settings-and-tts.md)

Which of the two server-side player voices (tts_service.PLAYER_VOICES) narrates the player's
own lines, chosen at registration and editable later in settings. Defaults to "male", matching
tts_service.DEFAULT_PLAYER_VOICE_GENDER.

Revision ID: 20eaf27c54bb
Revises: 3d76e426e70b
Create Date: 2026-09-24 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '20eaf27c54bb'
down_revision: Union[str, None] = '3d76e426e70b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_USER_SETTINGS_TABLE", "user_settings")


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ADD COLUMN IF NOT EXISTS player_voice_gender VARCHAR(16) NOT NULL DEFAULT 'male';
        """
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS player_voice_gender;")
