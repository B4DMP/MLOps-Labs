"""Case board: the notes a player has penciled in

Revision ID: e2f3a4b5c6d8
Revises: d1e2f3a4b5c7
Create Date: 2026-10-09 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e2f3a4b5c6d8'
down_revision: Union[str, None] = 'd1e2f3a4b5c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_CASE_BOARD_TABLE", "case_board")


def upgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS penciled JSON NOT NULL DEFAULT '[]'::json;")


def downgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS penciled;")
