"""drop the now-unused stakeholder_archetypes column from game_session_data

The model dropped this column when archetypes were folded into
stakeholder_personas, but the column stayed behind. On databases whose schema
came from `Base.metadata.create_all` it is NOT NULL with no server default
(`default=dict` is applied by SQLAlchemy, not by Postgres), so every INSERT that
no longer mentions the column fails with a NotNullViolation.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-09-19 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_session_data') THEN
                ALTER TABLE game_session_data DROP COLUMN IF EXISTS stakeholder_archetypes;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'game_session_data') THEN
                ALTER TABLE game_session_data
                    ADD COLUMN IF NOT EXISTS stakeholder_archetypes JSON NOT NULL DEFAULT '{}'::json;
            END IF;
        END $$;
        """
    )
