"""Add teacher_data and teacher_campaign_data tables

Backs the teacher role: a monitoring-only account, distinct from the admin bootstrap login and
from player `User` rows, that can only view the campaigns explicitly assigned to it via
teacher_campaign_data - see application/services/teacher_service.py. Guarded DDL, same idiom as
b8c9d0e1f2a3: a no-op on a database that already has these tables, a real create on a fresh one.

Revision ID: a2b3c4d5e6f7
Revises: d3e4f5a6b7c8
Create Date: 2026-09-28 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TEACHER_TABLE = os.getenv("POSTGRES_TEACHER_DATA_TABLE", "teacher_data")
TEACHER_CAMPAIGN_TABLE = os.getenv("POSTGRES_TEACHER_CAMPAIGN_TABLE", "teacher_campaign_data")
CAMPAIGN_TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TEACHER_TABLE} (
            id SERIAL PRIMARY KEY,
            user_name VARCHAR(255) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{TEACHER_TABLE}_user_name "
        f"ON {TEACHER_TABLE} (user_name);"
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TEACHER_CAMPAIGN_TABLE} (
            id SERIAL PRIMARY KEY,
            teacher_id INTEGER NOT NULL REFERENCES {TEACHER_TABLE}(id) ON DELETE CASCADE,
            campaign_id INTEGER NOT NULL REFERENCES {CAMPAIGN_TABLE}(id) ON DELETE CASCADE
        );
        """
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS ix_{TEACHER_CAMPAIGN_TABLE}_teacher_id "
        f"ON {TEACHER_CAMPAIGN_TABLE} (teacher_id);"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS ix_{TEACHER_CAMPAIGN_TABLE}_campaign_id "
        f"ON {TEACHER_CAMPAIGN_TABLE} (campaign_id);"
    )
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS ux_{TEACHER_CAMPAIGN_TABLE}_teacher_campaign "
        f"ON {TEACHER_CAMPAIGN_TABLE} (teacher_id, campaign_id);"
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TEACHER_CAMPAIGN_TABLE};")
    op.execute(f"DROP TABLE IF EXISTS {TEACHER_TABLE};")
