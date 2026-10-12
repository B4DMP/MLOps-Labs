"""20 players on the WestAI provider, playing at the same time.

application/llm.py pins each player's provider and campaign via ContextVars set once per
websocket connection (infrastructure/websocket/router.py) and inherited by every task that
connection spawns per chat message (`asyncio.create_task(handle_chat_message(...))`). This is
exactly the kind of state that looks fine single-player and leaks under concurrency if a future
change swaps a ContextVar for a plain module global. application/llm_usage.py's `record_usage`
is the other half of the same risk: it upserts with a SQL-side increment specifically so
"concurrent players ... never overwrite each other's counts" (its own docstring).

This test reproduces that shape without a real WestAI key or network call: 20 players, each its
own campaign, each bound to "westai", each firing several concurrent "messages" as sibling
tasks off one connection task - then checks that every player's own campaign ended up with
exactly its own call/token counts, never another player's.
"""

import asyncio
import random
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from test_run_scope import migrated_db  # noqa: F401  (fixture used by name)

NUM_PLAYERS = 20
MESSAGES_PER_PLAYER = 3


def _seed_player(index: int) -> tuple[int, str]:
    """A player alone in their own campaign, pinned to westai. Returns (user_id, campaign_key)."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign, User

    campaign_key = f"camp-westai-{index}"
    with get_session() as session:
        campaign = Campaign(
            campaign_name=campaign_key, campaign_key=campaign_key, llm_provider="westai"
        )
        session.add(campaign)
        session.flush()
        user = User(
            campaign_key=campaign_key,
            campaign_id=campaign.id,
            email=f"player{index}@example.test",
            password_hash="$2b$12$test.hash.not.a.real.bcrypt.digest..............",
            users_on_machine=1,
            is_verified=True,
        )
        session.add(user)
        session.flush()
        return user.id, campaign_key


async def _play_one_message(user_id: int, seen_models: list) -> None:
    """One chat turn: resolve the bound model, record who built it, and fabricate a completed
    LLM response through the real TokenUsageHandler so record_usage runs for real."""
    from mlops_serious_game.application.llm import get_chat_model

    await asyncio.sleep(random.uniform(0, 0.01))  # encourage interleaving across players

    model = get_chat_model()
    seen_models.append(model)
    handler = model.callbacks[0]

    run_id = uuid4()
    handler.on_chat_model_start({}, [[AIMessage(content="hello")]], run_id=run_id)
    await asyncio.sleep(random.uniform(0, 0.01))
    result = LLMResult(generations=[[ChatGeneration(
        message=AIMessage(
            content="reply",
            usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        )
    )]])
    handler.on_llm_end(result, run_id=run_id)


async def _play_one_connection(user_id: int, seen_models: list) -> None:
    """Mirrors router.py: bind once per connection, then let each message run as its own
    sibling task, the way `chat:send_message` spawns `handle_chat_message` concurrently."""
    from mlops_serious_game.application.llm import bind_llm_campaign, bind_llm_provider
    from mlops_serious_game.application.services.auth_service import (
        get_player_campaign_key,
        get_player_llm_provider,
    )

    bind_llm_provider(get_player_llm_provider(user_id))
    bind_llm_campaign(get_player_campaign_key(user_id))

    message_tasks = [
        asyncio.create_task(_play_one_message(user_id, seen_models))
        for _ in range(MESSAGES_PER_PLAYER)
    ]
    await asyncio.gather(*message_tasks)


@pytest.mark.db
def test_twenty_players_on_westai_play_concurrently_without_cross_talk(migrated_db, monkeypatch):
    from mlops_serious_game.config import settings

    monkeypatch.setattr(settings, "WESTAI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "WESTAI_API_BASE", "https://westai.test/v1")

    players = [_seed_player(i) for i in range(NUM_PLAYERS)]
    seen_models: list = []

    async def _play_everyone():
        await asyncio.gather(*(
            _play_one_connection(user_id, seen_models) for user_id, _ in players
        ))

    asyncio.run(_play_everyone())

    # Every player's model really came from the westai builder, not some other provider.
    assert len(seen_models) == NUM_PLAYERS * MESSAGES_PER_PLAYER
    for model in seen_models:
        assert model.openai_api_base == "https://westai.test/v1"
        assert model.model_name == settings.WESTAI_LLM_MODEL

    # Each player's own campaign got exactly its own usage - none of the 60 concurrent
    # message tasks recorded against the wrong campaign.
    from sqlalchemy import select

    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import LlmTokenUsage

    with get_session() as session:
        for _, campaign_key in players:
            row = session.scalar(
                select(LlmTokenUsage).where(LlmTokenUsage.campaign_key == campaign_key)
            )
            assert row is not None, f"no usage recorded for {campaign_key}"
            assert row.calls == MESSAGES_PER_PLAYER
            assert row.prompt_tokens == MESSAGES_PER_PLAYER * 10
            assert row.completion_tokens == MESSAGES_PER_PLAYER * 5
