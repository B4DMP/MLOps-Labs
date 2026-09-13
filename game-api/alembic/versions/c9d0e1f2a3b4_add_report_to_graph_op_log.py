"""Add report column to graph_op_log

Fixes run_simulation's idempotency (D-question 1, code review): a repeat `simulation:run` for the
same challenge/loop-index used to recompute `simulate()` from the already-updated graph, so the
report shown on a replay could be wrong even though nothing was re-applied. Persisting the report
that was actually applied - and returning that stored copy verbatim on a repeat call, never
recomputing - means the second call can never show a different answer than the first.

Existing batches have no report (null); only future simulation batches populate it.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-13 10:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_GRAPH_OP_LOG_TABLE", "graph_op_log")


def upgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS report JSON;")


def downgrade() -> None:
    op.execute(f"ALTER TABLE {TABLE} DROP COLUMN IF EXISTS report;")
