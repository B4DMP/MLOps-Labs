"""Add the per-campaign LLM token usage table

Revision ID: f3a4b5c6d7e9
Revises: e2f3a4b5c6d8
Create Date: 2026-10-12 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f3a4b5c6d7e9'
down_revision: Union[str, None] = 'e2f3a4b5c6d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_LLM_TOKEN_USAGE_TABLE", "llm_token_usage")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            campaign_key VARCHAR(255) PRIMARY KEY,
            calls BIGINT NOT NULL DEFAULT 0,
            prompt_tokens BIGINT NOT NULL DEFAULT 0,
            completion_tokens BIGINT NOT NULL DEFAULT 0
        );
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
