"""replace messages column with pitch_debate_messages and online_intel_gathering_messages

Revision ID: 0003_replace_messages_column
Revises: 0002_add_attention_tokens
Create Date: 2026-08-27 13:35:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0003_replace_messages_column'
down_revision: Union[str, None] = '0002_add_attention_tokens'
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
                ALTER TABLE game_data
                    ADD COLUMN IF NOT EXISTS pitch_debate_messages JSON NOT NULL DEFAULT '[]',
                    ADD COLUMN IF NOT EXISTS online_intel_gathering_messages JSON NOT NULL DEFAULT '[]';

                IF EXISTS (
                    SELECT FROM information_schema.columns
                    WHERE table_name = 'game_data' AND column_name = 'messages'
                ) THEN
                    UPDATE game_data SET pitch_debate_messages = messages WHERE messages IS NOT NULL;
                    ALTER TABLE game_data DROP COLUMN messages;
                END IF;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_data') THEN
                ALTER TABLE game_data ADD COLUMN IF NOT EXISTS messages JSON NOT NULL DEFAULT '[]';
                UPDATE game_data SET messages = pitch_debate_messages WHERE pitch_debate_messages IS NOT NULL;
                ALTER TABLE game_data
                    DROP COLUMN IF EXISTS pitch_debate_messages,
                    DROP COLUMN IF EXISTS online_intel_gathering_messages;
            END IF;
        END $$;
        """
    )
