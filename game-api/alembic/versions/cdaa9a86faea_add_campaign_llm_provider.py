"""Add an llm_provider override to campaigns.

Lets an admin pin a campaign to one of "mistral"/"westai"/"groq" instead of the server-wide
Mistral -> WestAI -> Groq priority (application/llm.py). NULL (the default for every existing
row) keeps that global order, so this rollout changes no campaign's behavior on its own.

Revision ID: cdaa9a86faea
Revises: f1e2d3c4b5a6
Create Date: 2026-10-05 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'cdaa9a86faea'
down_revision: Union[str, None] = 'f1e2d3c4b5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPAIGN_TABLE = os.getenv("POSTGRES_CAMPAIGN_DATA_TABLE", "campaign_data")


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {CAMPAIGN_TABLE} ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(32);"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {CAMPAIGN_TABLE} DROP COLUMN IF EXISTS llm_provider;")
