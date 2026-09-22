"""Mark accounts that used the playtest tools (docs/plans/results-screen.md, D9/D10)

`user_data.playtest_tainted` is account-level on purpose. Contamination does not stay inside the
challenge that caused it: graph state, emotions and grudges carry forward within a run, the
played-challenge set carries across runs, and the knowledge-delta series spans runs. So once a
player has used a tool that fabricates progress, nothing downstream of it is research data.

`game_challenge_data.auto_played` is only a breadcrumb for "which challenge did I skip" while
debugging. Nothing filters on it.

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-09-21 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")
CHALLENGE_TABLE = os.getenv("POSTGRES_GAME_CHALLENGE_DATA_TABLE", "game_challenge_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {USER_TABLE} "
        f"ADD COLUMN IF NOT EXISTS playtest_tainted BOOLEAN NOT NULL DEFAULT FALSE;"
    )
    op.execute(
        f"ALTER TABLE {CHALLENGE_TABLE} "
        f"ADD COLUMN IF NOT EXISTS auto_played BOOLEAN NOT NULL DEFAULT FALSE;"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {CHALLENGE_TABLE} DROP COLUMN IF EXISTS auto_played;")
    op.execute(f"ALTER TABLE {USER_TABLE} DROP COLUMN IF EXISTS playtest_tainted;")
