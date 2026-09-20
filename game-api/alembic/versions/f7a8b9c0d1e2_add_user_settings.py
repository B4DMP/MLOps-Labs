"""Add the per-player settings profile (docs/plans/player-settings-and-tts.md)

One row per player, created lazily on the first write from the settings panel: auto-skip,
mute, and the four voice slots (male, female, narrator, player).

The `user_id` FK cascades like every other per-player table, so the account reset, which
deletes and recreates the `User` row, takes these with it and the player comes back on
defaults.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-09-20 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_USER_SETTINGS_TABLE", "user_settings")
USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL UNIQUE,
            user_id INTEGER NOT NULL UNIQUE
                REFERENCES {USER_TABLE} (id) ON DELETE CASCADE,
            auto_skip_conversations BOOLEAN NOT NULL DEFAULT FALSE,
            mute_tts BOOLEAN NOT NULL DEFAULT FALSE,
            voice_male VARCHAR(255),
            voice_female VARCHAR(255),
            voice_narrator VARCHAR(255),
            voice_player VARCHAR(255),
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
                DEFAULT (now() AT TIME ZONE 'utc')
        );
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_name ON {TABLE} (user_name);")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_id ON {TABLE} (user_id);")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
