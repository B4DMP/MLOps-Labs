"""Merge the llm-cache, drop-username, and teacher-role/campaign-flag merge branches.

A duplicate revision id (`a3b4c5d6e7f8`) shared by the intro-phase-flag and drop-username
migrations was resolved by renaming the drop-username one to `a9b8c7d6e5f4`, which left three
unmerged heads: `a4b5c6d7e8f9` (llm cache), `a9b8c7d6e5f4` (drop username), and `c6d7e8f9a0b1`
(the earlier teacher-role/campaign-flag merge).

Revision ID: f1e2d3c4b5a6
Revises: a4b5c6d7e8f9, a9b8c7d6e5f4, c6d7e8f9a0b1
Create Date: 2026-10-01 00:00:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'f1e2d3c4b5a6'
down_revision: Union[str, Sequence[str], None] = ('a4b5c6d7e8f9', 'a9b8c7d6e5f4', 'c6d7e8f9a0b1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
