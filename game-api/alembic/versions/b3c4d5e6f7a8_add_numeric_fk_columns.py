"""Add numeric user_id/campaign_id FK columns (nullable), backfilled from the legacy string
columns (docs/plans/pk-migration.md)

Every per-user table currently joins back to a user only via a bare `user_name`/`player`
string column, and `user_data.campaign_key` links to `campaign_data` the same way - no
`ForeignKey` exists anywhere. This migration adds the numeric columns and backfills them;
`enforce_fk_constraints` (next migration) makes them NOT NULL and adds the real FK/cascade once
this has had a chance to run against already-running app code that only knows the string
columns.

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f7
Create Date: 2026-09-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, new FK column, legacy string column on that table, referenced table, referenced
# table's string column to join on)
CHILD_TABLES = [
    ("game_progression_data", "user_id", "user_name", "user_data", "user_name"),
    ("game_challenge_data", "user_id", "user_name", "user_data", "user_name"),
    ("game_session_data", "user_id", "player", "user_data", "user_name"),
    ("intel_data", "user_id", "user_name", "user_data", "user_name"),
    ("graph_op_log", "user_id", "user_name", "user_data", "user_name"),
    ("game_event", "user_id", "user_name", "user_data", "user_name"),
]


def _backfill() -> None:
    op.execute(
        """
        UPDATE user_data
        SET campaign_id = campaign_data.id
        FROM campaign_data
        WHERE campaign_data.campaign_key = user_data.campaign_key
          AND user_data.campaign_id IS NULL
        """
    )
    for table, fk_col, legacy_col, ref_table, ref_col in CHILD_TABLES:
        op.execute(
            f"""
            UPDATE {table}
            SET {fk_col} = {ref_table}.id
            FROM {ref_table}
            WHERE {ref_table}.{ref_col} = {table}.{legacy_col}
              AND {table}.{fk_col} IS NULL
            """
        )


def _assert_no_orphans() -> None:
    conn = op.get_bind()
    orphans: list[str] = []

    count = conn.execute(sa.text("SELECT count(*) FROM user_data WHERE campaign_id IS NULL")).scalar()
    if count:
        orphans.append(f"user_data.campaign_id: {count} row(s) with no matching campaign_data.campaign_key")

    for table, fk_col, legacy_col, ref_table, ref_col in CHILD_TABLES:
        count = conn.execute(sa.text(f"SELECT count(*) FROM {table} WHERE {fk_col} IS NULL")).scalar()
        if count:
            orphans.append(
                f"{table}.{legacy_col}: {count} row(s) with no matching {ref_table}.{ref_col}"
            )

    if orphans:
        raise RuntimeError(
            "add_numeric_fk_columns: orphaned rows found after backfill (data bug - investigate "
            "by hand, do not silently drop):\n" + "\n".join(orphans)
        )


def upgrade() -> None:
    op.add_column("user_data", sa.Column("campaign_id", sa.Integer(), nullable=True))
    for table, fk_col, _legacy_col, _ref_table, _ref_col in CHILD_TABLES:
        op.add_column(table, sa.Column(fk_col, sa.Integer(), nullable=True))

    _backfill()
    _assert_no_orphans()


def downgrade() -> None:
    for table, fk_col, _legacy_col, _ref_table, _ref_col in reversed(CHILD_TABLES):
        op.drop_column(table, fk_col)
    op.drop_column("user_data", "campaign_id")
