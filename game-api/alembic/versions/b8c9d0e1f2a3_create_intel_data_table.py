"""Bring intel_data under alembic management

`IntelItem` (`infrastructure/database/models.py`) has existed since before this project used
alembic at all - it has only ever been created by `connection.py`'s `Base.metadata.create_all()`
fallback, never by a migration (code-review finding, migration test harness pass). Every install
that has ever run this app already has the table via that fallback, so `CREATE TABLE IF NOT
EXISTS` makes this a no-op there and a real create on a genuinely fresh database - the same
guarded-DDL idiom already used elsewhere in this chain (e.g. a7b8c9d0e1f2).

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-13 09:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_INTEL_DATA_TABLE", "intel_data")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            intel_item_data JSON NOT NULL DEFAULT '{{}}'::json
        );
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_{TABLE}_user_name ON {TABLE} (user_name);")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
