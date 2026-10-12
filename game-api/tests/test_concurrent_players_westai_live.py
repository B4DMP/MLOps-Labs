"""20 players on the real WestAI endpoint, playing at the same time.

Companion to test_concurrent_players_westai.py, which proves the ContextVar/usage-recording
plumbing is safe under concurrency using a fabricated LLM response. This test exercises the
same 20-players-in-parallel shape but makes real network calls to WestAI
(settings.WESTAI_API_BASE / WESTAI_API_KEY) through the real get_chat_model() -> ChatOpenAI ->
TokenUsageHandler -> record_usage pipeline, so it also catches things the mocked test can't:
real latency/timeouts under concurrent load, the provider's actual response shape, and whether
its real usage_metadata survives the trip into Postgres.

Opt-in only: it spends real WestAI quota and needs network + a real WESTAI_API_KEY, so it must
never run as part of the default `pytest tests -q` / CI invocation. Run it explicitly with:

    docker compose exec -e RUN_LIVE_WESTAI_TESTS=1 api \\
        python -m pytest tests/test_concurrent_players_westai_live.py -q
"""

import asyncio
import os

import pytest
from langchain_core.messages import HumanMessage

from mlops_serious_game.config import settings
from test_run_scope import migrated_db  # noqa: F401  (fixture used by name)

NUM_PLAYERS = 20
CALL_TIMEOUT_SECONDS = 60

pytestmark = [
    pytest.mark.db,
    pytest.mark.live_llm,
    pytest.mark.skipif(
        os.environ.get("RUN_LIVE_WESTAI_TESTS") != "1",
        reason="opt-in only: spends real WestAI quota - set RUN_LIVE_WESTAI_TESTS=1 to run",
    ),
    pytest.mark.skipif(
        not settings.WESTAI_API_KEY,
        reason="WESTAI_API_KEY is not configured",
    ),
]


def _seed_player(index: int) -> tuple[int, str]:
    """A player alone in their own campaign, pinned to westai. Returns (user_id, campaign_key)."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign, User

    campaign_key = f"camp-westai-live-{index}"
    with get_session() as session:
        campaign = Campaign(
            campaign_name=campaign_key, campaign_key=campaign_key, llm_provider="westai"
        )
        session.add(campaign)
        session.flush()
        user = User(
            campaign_key=campaign_key,
            campaign_id=campaign.id,
            email=f"liveplayer{index}@example.test",
            password_hash="$2b$12$test.hash.not.a.real.bcrypt.digest..............",
            users_on_machine=1,
            is_verified=True,
        )
        session.add(user)
        session.flush()
        return user.id, campaign_key


async def _play_one_connection(index: int, user_id: int, campaign_key: str, responses: dict) -> None:
    """Mirrors router.py: bind this player's provider/campaign for the life of the connection,
    then make one real chat call - exactly what `chat:send_message` does per message."""
    from mlops_serious_game.application.llm import bind_llm_campaign, bind_llm_provider

    bind_llm_provider("westai")
    bind_llm_campaign(campaign_key)

    model = get_chat_model_for_live_call()
    response = await asyncio.wait_for(
        model.ainvoke([HumanMessage(
            content=f"You are player {index} of {NUM_PLAYERS} playing a game at the same time. "
                    "Reply with exactly one short sentence confirming you're ready to play."
        )]),
        timeout=CALL_TIMEOUT_SECONDS,
    )
    responses[user_id] = response


def get_chat_model_for_live_call():
    from mlops_serious_game.application.llm import get_chat_model

    # Keep each call cheap and fast: this test cares about concurrent plumbing, not long replies.
    return get_chat_model(temperature=0.7, model_name=None).bind(max_tokens=40)


def test_twenty_players_on_westai_play_concurrently_with_real_llm_calls(migrated_db):
    players = [_seed_player(i) for i in range(NUM_PLAYERS)]
    responses: dict = {}

    async def _play_everyone():
        await asyncio.gather(*(
            _play_one_connection(i, user_id, campaign_key, responses)
            for i, (user_id, campaign_key) in enumerate(players)
        ))

    asyncio.run(_play_everyone())

    # Every player got a real, non-empty reply from the real endpoint.
    assert len(responses) == NUM_PLAYERS
    for user_id, _ in players:
        content = responses[user_id].content
        assert isinstance(content, str) and content.strip()

    # Each player's own campaign got exactly its own usage - no cross-talk between the 20
    # concurrent real calls, and real (not fabricated) token counts came back from WestAI.
    from sqlalchemy import select

    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import LlmTokenUsage

    with get_session() as session:
        for _, campaign_key in players:
            row = session.scalar(
                select(LlmTokenUsage).where(LlmTokenUsage.campaign_key == campaign_key)
            )
            assert row is not None, f"no usage recorded for {campaign_key}"
            assert row.calls == 1
            assert row.prompt_tokens > 0
            assert row.completion_tokens > 0
