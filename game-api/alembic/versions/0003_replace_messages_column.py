"""replace messages column with pitch_debate_messages and online_intel_gathering_messages

Revision ID: 0003_replace_messages_column
Revises: 0002_add_attention_tokens
Create Date: 2026-08-27 13:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0003_replace_messages_column'
down_revision: Union[str, None] = '0002_add_attention_tokens'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns
    op.add_column('game_data', sa.Column('pitch_debate_messages', sa.JSON(), server_default='[]', nullable=False))
    op.add_column('game_data', sa.Column('online_intel_gathering_messages', sa.JSON(), server_default='[]', nullable=False))
    
    # Copy existing messages to pitch_debate_messages
    op.execute("UPDATE game_data SET pitch_debate_messages = messages WHERE messages IS NOT NULL")
    
    # Drop old messages column
    op.drop_column('game_data', 'messages')


def downgrade() -> None:
    # Restore messages column
    op.add_column('game_data', sa.Column('messages', sa.JSON(), server_default='[]', nullable=False))
    
    # Copy pitch_debate_messages back
    op.execute("UPDATE game_data SET messages = pitch_debate_messages WHERE pitch_debate_messages IS NOT NULL")
    
    # Drop new columns
    op.drop_column('game_data', 'pitch_debate_messages')
    op.drop_column('game_data', 'online_intel_gathering_messages')
