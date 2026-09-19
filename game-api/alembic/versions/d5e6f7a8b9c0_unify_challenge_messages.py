"""unify pitch_debate_messages and online_intel_gathering_messages into messages

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-09-17 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            has_old_cols BOOLEAN;
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_challenge_data') THEN
                ALTER TABLE game_challenge_data ADD COLUMN IF NOT EXISTS messages JSON NOT NULL DEFAULT '[]';

                SELECT EXISTS (
                    SELECT FROM information_schema.columns
                    WHERE table_name = 'game_challenge_data' AND column_name = 'pitch_debate_messages'
                ) INTO has_old_cols;

                IF has_old_cols THEN
                    UPDATE game_challenge_data
                    SET messages = (
                        SELECT COALESCE(
                            json_agg(
                                jsonb_set(
                                    msg.value::jsonb,
                                    '{conversation_id}',
                                    to_jsonb(COALESCE(msg.value->>'conversation_id', 'conv_legacy'))
                                )
                            ),
                            '[]'::json
                        )
                        FROM (
                            SELECT value FROM json_array_elements(COALESCE(NULLIF(online_intel_gathering_messages::text, '')::json, '[]'::json))
                            UNION ALL
                            SELECT value FROM json_array_elements(COALESCE(NULLIF(pitch_debate_messages::text, '')::json, '[]'::json))
                        ) msg
                    )
                    WHERE (messages IS NULL OR messages::text = '[]')
                      AND (
                          (online_intel_gathering_messages IS NOT NULL AND online_intel_gathering_messages::text <> '[]')
                          OR
                          (pitch_debate_messages IS NOT NULL AND pitch_debate_messages::text <> '[]')
                      );

                    ALTER TABLE game_challenge_data
                        DROP COLUMN IF EXISTS pitch_debate_messages,
                        DROP COLUMN IF EXISTS online_intel_gathering_messages;
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
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_challenge_data') THEN
                ALTER TABLE game_challenge_data
                    ADD COLUMN IF NOT EXISTS pitch_debate_messages JSON NOT NULL DEFAULT '[]',
                    ADD COLUMN IF NOT EXISTS online_intel_gathering_messages JSON NOT NULL DEFAULT '[]';

                UPDATE game_challenge_data
                SET pitch_debate_messages = messages
                WHERE messages IS NOT NULL;

                ALTER TABLE game_challenge_data DROP COLUMN IF EXISTS messages;
            END IF;
        END $$;
        """
    )
