"""Add per-player stakeholder personas to the game session

Each player is dealt one persona (name plus look) per stakeholder when their
session is created. The draw is stored here as {stakeholder_id: persona_key} so
it stays fixed for the whole game.

Existing sessions get an empty map and are filled in on their next load, which
gives players already mid-game the canonical cast until they are re-dealt.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-10 09:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_GAME_SESSION_DATA_TABLE", "game_session_data")


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ADD COLUMN IF NOT EXISTS stakeholder_personas JSON NOT NULL DEFAULT '{{}}'::json;
        """
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS stakeholder_personas;")
