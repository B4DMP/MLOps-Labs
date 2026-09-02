"""Restructure game challenge and session data

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-02 13:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename game_data table to game_challenge_data if game_data exists
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_data') THEN
                ALTER TABLE game_data RENAME TO game_challenge_data;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_game_data_user_name') THEN
                ALTER INDEX ix_game_data_user_name RENAME TO ix_game_challenge_data_user_name;
            END IF;
        END $$;
        """
    )

    # 2. Ensure game_challenge_data table exists with correct index
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS game_challenge_data (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            phase_index INTEGER NOT NULL,
            challenge_index INTEGER NOT NULL,
            challenge_loop_index INTEGER NOT NULL,
            action_card JSON NOT NULL,
            metric_values JSON NOT NULL,
            time_stamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            pitch_debate_messages JSON NOT NULL,
            online_intel_gathering_messages JSON NOT NULL,
            attention_tokens INTEGER DEFAULT 8,
            emotion_values JSON NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_game_challenge_data_user_name ON game_challenge_data (user_name);
        """
    )

    # 3. Create game_session_data table
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS game_session_data (
            id SERIAL PRIMARY KEY,
            player VARCHAR(255) NOT NULL,
            stakeholder_archetypes JSON NOT NULL DEFAULT '{}'::json,
            time_stamp TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS ix_game_session_data_player ON game_session_data (player);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS game_session_data;
        DO $$
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_challenge_data') THEN
                ALTER TABLE game_challenge_data RENAME TO game_data;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_game_challenge_data_user_name') THEN
                ALTER INDEX ix_game_challenge_data_user_name RENAME TO ix_game_data_user_name;
            END IF;
        END $$;
        """
    )
