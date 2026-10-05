"""The server-wide default LLM provider - admin-editable, seeded as NULL (see alembic revision
a1d2e3f4b5c6). NULL means "no explicit default": get_chat_model falls back to the hardcoded
Mistral -> WestAI -> Groq env-key priority in application/llm.py."""

from mlops_serious_game.infrastructure.database import get_session
from mlops_serious_game.infrastructure.database.models import DefaultLlmProviderRow

SETTINGS_ROW_ID = 1


def get_default_llm_provider() -> str | None:
    with get_session() as session:
        row = session.get(DefaultLlmProviderRow, SETTINGS_ROW_ID)
        return row.provider if row else None


def update_default_llm_provider(provider: str | None) -> str | None:
    with get_session() as session:
        row = session.get(DefaultLlmProviderRow, SETTINGS_ROW_ID)
        if row is None:
            row = DefaultLlmProviderRow(id=SETTINGS_ROW_ID, provider=provider)
            session.add(row)
        else:
            row.provider = provider
        session.flush()
        return row.provider
