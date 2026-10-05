"""Add the default_llm_provider_setting table

Single-row (id=1) table holding the server-wide default LLM provider, admin-editable. Seeded
with a NULL provider so nothing changes until an admin explicitly sets one: get_chat_model
keeps falling back to the hardcoded Mistral -> WestAI -> Groq env-key priority.

Revision ID: a1d2e3f4b5c6
Revises: cdaa9a86faea
Create Date: 2026-10-05 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1d2e3f4b5c6'
down_revision: Union[str, None] = 'cdaa9a86faea'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = os.getenv("POSTGRES_DEFAULT_LLM_PROVIDER_TABLE", "default_llm_provider_setting")


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            id INTEGER PRIMARY KEY,
            provider VARCHAR(32),
            updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        );
        """
    )
    op.execute(
        f"""
        INSERT INTO {TABLE} (id, provider)
        VALUES (1, NULL)
        ON CONFLICT (id) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE};")
