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
        UPDATE intel_items
        SET intel_item_data = jsonb_set(intel_item_data::jsonb, '{intel_type}', '"verified"')::json
        WHERE intel_item_data->>'intel_type' = 'inferred';
        """
    )


def downgrade() -> None:
    pass
