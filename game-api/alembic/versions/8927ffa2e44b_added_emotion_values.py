"""Added emotion_values

Revision ID: 8927ffa2e44b
Revises: 0003_replace_messages_column
Create Date: 2026-08-28 17:23:00.656978

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8927ffa2e44b'
down_revision: Union[str, None] = '0003_replace_messages_column'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Guarded so the chain can be replayed from base against a database that is
    # already past this point: `game_data` was renamed to `game_challenge_data`
    # in b2c3d4e5f6a7, and a database created fresh from the models never had it.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_data') THEN
                ALTER TABLE game_data ADD COLUMN IF NOT EXISTS emotion_values JSON NOT NULL
                DEFAULT '{"trust": 0.5, "interest": 0.5, "stress": 0.5, "confidence": 0.5, "perceived_risk": 0.5, "sense_of_control": 0.5, "fairness": 0.5}';
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE IF EXISTS game_data DROP COLUMN IF EXISTS emotion_values;")

