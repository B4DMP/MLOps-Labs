"""initial_schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-07-28 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    
    op.create_table(
        'user_data',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_name', sa.String(length=255), nullable=False),
        sa.Column('campaign_key', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_data_user_name'), 'user_data', ['user_name'], unique=True)
    op.create_index(op.f('ix_user_data_campaign_key'), 'user_data', ['campaign_key'], unique=False)

    op.create_table(
        'campaign_data',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('campaign_name', sa.String(length=255), nullable=False),
        sa.Column('campaign_key', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_campaign_data_campaign_key'), 'campaign_data', ['campaign_key'], unique=True)

    op.create_table(
        'game_progression_data',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_name', sa.String(length=255), nullable=False),
        sa.Column('game_progress_index', sa.Integer(), nullable=False),
        sa.Column('time_stamp', sa.DateTime(), nullable=False),
        sa.Column('additional_data', sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_game_progression_data_user_name'), 'game_progression_data', ['user_name'], unique=False)

    op.create_table(
        'game_data',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_name', sa.String(length=255), nullable=False),
        sa.Column('phase_index', sa.Integer(), nullable=False),
        sa.Column('challenge_index', sa.Integer(), nullable=False),
        sa.Column('action_card', sa.JSON(), nullable=False),
        sa.Column('metric_values', sa.JSON(), nullable=False),
        sa.Column('time_stamp', sa.DateTime(), nullable=False),
        sa.Column('messages', sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_game_data_user_name'), 'game_data', ['user_name'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_game_data_user_name'), table_name='game_data')
    op.drop_table('game_data')
    op.drop_index(op.f('ix_game_progression_data_user_name'), table_name='game_progression_data')
    op.drop_table('game_progression_data')
    op.drop_index(op.f('ix_campaign_data_campaign_key'), table_name='campaign_data')
    op.drop_table('campaign_data')
    op.drop_index(op.f('ix_user_data_campaign_key'), table_name='user_data')
    op.drop_index(op.f('ix_user_data_user_name'), table_name='user_data')
    op.drop_table('user_data')
