"""add attention_tokens to game_data

Revision ID: 0002_add_attention_tokens
Revises: 0001_initial_schema
Create Date: 2026-08-27 12:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002_add_attention_tokens'
down_revision: Union[str, None] = '0001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Guarded so the chain can be replayed against a database that is already
    # past this point: `game_data` was renamed to `game_challenge_data` in
    # b2c3d4e5f6a7, and a database built from the models never had it.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_data') THEN
                ALTER TABLE game_data ADD COLUMN IF NOT EXISTS attention_tokens INTEGER DEFAULT 5;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS game_data DROP COLUMN IF EXISTS attention_tokens;")
