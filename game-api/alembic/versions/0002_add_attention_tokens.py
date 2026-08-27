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
    op.add_column('game_data', sa.Column('attention_tokens', sa.Integer(), server_default='5', nullable=True))


def downgrade() -> None:
    op.drop_column('game_data', 'attention_tokens')
