"""Merge the teacher-role and campaign-flag migration branches.

Both branched off f2a3b4c5d6e7 and were merged without a common descendant, leaving two heads.

Revision ID: c6d7e8f9a0b1
Revises: a2b3c4d5e6f7, b4c5d6e7f8a9
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'c6d7e8f9a0b1'
down_revision: Union[str, Sequence[str], None] = ('a2b3c4d5e6f7', 'b4c5d6e7f8a9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
