"""Migrate inferred intel items to verified

Revision ID: a1b2c3d4e5f6
Revises: 8927ffa2e44b
Create Date: 2026-09-01 17:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '8927ffa2e44b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS intel_data (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            intel_item_data JSON NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_intel_data_user_name ON intel_data (user_name);

        UPDATE intel_data
        SET intel_item_data = jsonb_set(intel_item_data::jsonb, '{intel_type}', '"verified"')::json
        WHERE intel_item_data->>'intel_type' = 'inferred';
        """
    )


def downgrade() -> None:
    pass
