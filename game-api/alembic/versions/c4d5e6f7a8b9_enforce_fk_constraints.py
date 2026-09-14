"""Enforce the numeric FK columns added in add_numeric_fk_columns: re-run the backfill
(idempotent - catches rows written by old, string-only app code during rollout), assert no
orphans, then make the columns NOT NULL and add real FKs with ON DELETE CASCADE plus indexes
(docs/plans/pk-migration.md).

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-09-14 00:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kept in sync with b3c4d5e6f7a8_add_numeric_fk_columns.CHILD_TABLES - duplicated rather than
# imported since alembic version modules aren't meant to import one another.
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
            "enforce_fk_constraints: orphaned rows found after backfill (data bug - investigate "
            "by hand, do not silently drop):\n" + "\n".join(orphans)
        )


def upgrade() -> None:
    _backfill()
    _assert_no_orphans()

    op.alter_column("user_data", "campaign_id", nullable=False)
    op.create_foreign_key(
        "fk_user_data_campaign_id_campaign_data",
        "user_data",
        "campaign_data",
        ["campaign_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(op.f("ix_user_data_campaign_id"), "user_data", ["campaign_id"], unique=False)

    for table, fk_col, _legacy_col, ref_table, _ref_col in CHILD_TABLES:
        op.alter_column(table, fk_col, nullable=False)
        op.create_foreign_key(
            f"fk_{table}_{fk_col}_{ref_table}",
            table,
            ref_table,
            [fk_col],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(op.f(f"ix_{table}_{fk_col}"), table, [fk_col], unique=False)


def downgrade() -> None:
    for table, fk_col, _legacy_col, ref_table, _ref_col in reversed(CHILD_TABLES):
        op.drop_index(op.f(f"ix_{table}_{fk_col}"), table_name=table)
        op.drop_constraint(f"fk_{table}_{fk_col}_{ref_table}", table, type_="foreignkey")
        op.alter_column(table, fk_col, nullable=True)

    op.drop_index(op.f("ix_user_data_campaign_id"), table_name="user_data")
    op.drop_constraint("fk_user_data_campaign_id_campaign_data", "user_data", type_="foreignkey")
    op.alter_column("user_data", "campaign_id", nullable=True)
