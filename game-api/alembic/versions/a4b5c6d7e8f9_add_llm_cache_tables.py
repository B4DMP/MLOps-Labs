"""Add the LLM cache tables

Cached LLM answers and their hit/miss counters, keyed by cache name and build version so a new
build starts with an empty cache while the old rows are purged at start-up.

Revision ID: a4b5c6d7e8f9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-30 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a4b5c6d7e8f9'
down_revision: Union[str, None] = 'a3b4c5d6e7f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENTRY = os.getenv("POSTGRES_LLM_CACHE_TABLE", "llm_cache_entry")
STAT = os.getenv("POSTGRES_LLM_CACHE_STAT_TABLE", "llm_cache_stat")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {ENTRY} (
            id SERIAL PRIMARY KEY,
            cache_name VARCHAR(64) NOT NULL,
            version VARCHAR(128) NOT NULL,
            key_hash VARCHAR(64) NOT NULL,
            response TEXT NOT NULL,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
            last_used_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
            CONSTRAINT uq_llm_cache_key UNIQUE (cache_name, version, key_hash)
        );
        """
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS ix_llm_cache_lru ON {ENTRY} (cache_name, version, last_used_at);"
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {STAT} (
            cache_name VARCHAR(64) NOT NULL,
            version VARCHAR(128) NOT NULL,
            hits BIGINT NOT NULL DEFAULT 0,
            misses BIGINT NOT NULL DEFAULT 0,
            PRIMARY KEY (cache_name, version)
        );
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {STAT};")
    op.execute(f"DROP TABLE IF EXISTS {ENTRY};")
