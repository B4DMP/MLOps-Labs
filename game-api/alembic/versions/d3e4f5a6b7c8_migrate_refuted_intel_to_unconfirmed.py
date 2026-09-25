"""Migrate refuted intel items to unconfirmed

Revision ID: d3e4f5a6b7c8
Revises: 7f1a2b3c4d5e
Create Date: 2026-09-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = '7f1a2b3c4d5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE intel_data
        SET intel_item_data = jsonb_set(intel_item_data::jsonb, '{intel_type}', '"unconfirmed"')::json
        WHERE intel_item_data->>'intel_type' = 'refuted';
        """
    )


def downgrade() -> None:
    pass
