"""Per-campaign token counting for the admin panel. Needs the migrated throwaway Postgres."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest
from langchain_core.language_models import FakeListChatModel

from mlops_serious_game.application import llm_cache
from mlops_serious_game.application.llm import bind_llm_campaign, get_chat_model
from mlops_serious_game.application.llm_usage import (
    TokenUsageHandler,
    record_usage,
    token_usage_stats,
)
from mlops_serious_game.config import settings
from test_run_scope import migrated_db  # noqa: F401  (fixture used by name)

pytestmark = pytest.mark.db


def _row(key):
    return next(r for r in token_usage_stats()["campaigns"] if r["campaign_key"] == key)


def test_concurrent_calls_do_not_lose_updates(migrated_db):  # noqa: F811
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(lambda _: record_usage("race", 3, 2), range(200)))

    row = _row("race")
    assert (row["calls"], row["prompt_tokens"], row["completion_tokens"]) == (200, 600, 400)


def test_cached_replays_are_not_counted(migrated_db, monkeypatch):  # noqa: F811
    monkeypatch.setattr(llm_cache, "_caches", {})
    monkeypatch.setattr(settings, "LLM_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "BUILD_VERSION", "usage-build")
    model = FakeListChatModel(
        responses=["a reply of some length"] * 2,
        cache=llm_cache.get_cache("veto"),
        callbacks=[TokenUsageHandler("cached")],
    )

    for _ in range(2):
        asyncio.run(model.ainvoke("the same prompt"))

    assert _row("cached")["calls"] == 1


def test_get_chat_model_counts_against_the_bound_campaign(migrated_db, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "MISTRAL_API_KEY", "test-key")
    bind_llm_campaign("bound")
    try:
        model = get_chat_model()
    finally:
        bind_llm_campaign(None)

    assert model.callbacks[0].campaign_key == "bound"
