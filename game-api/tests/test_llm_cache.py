"""The per-chain LLM caches: which models get one, what survives a restart, and the counters
behind the admin panel. The cache lives in Postgres, so most tests run on a migrated throwaway DB."""

import asyncio

import pytest
from langchain_core.language_models import FakeListChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration
from sqlalchemy import select

from mlops_serious_game.application import llm_cache
from mlops_serious_game.application.llm import get_chat_model
from mlops_serious_game.config import settings
from test_run_scope import migrated_db  # noqa: F401  (fixture used by name)


@pytest.fixture(autouse=True)
def fresh_caches(monkeypatch):
    monkeypatch.setattr(llm_cache, "_caches", {})
    monkeypatch.setattr(settings, "MISTRAL_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "BUILD_VERSION", "build-1")


def _row(name):
    return next(r for r in llm_cache.cache_stats()["caches"] if r["name"] == name)


def _ask(cache, *prompts):
    model = FakeListChatModel(responses=[f"answer {i}" for i in range(len(prompts))], cache=cache)
    return [asyncio.run(model.ainvoke(p)).content for p in prompts]


def _generation(text="x"):
    return [ChatGeneration(message=AIMessage(content=text))]


# -- which models are cached ------------------------------------------------

def test_a_named_model_gets_its_own_cache():
    model = get_chat_model(cache_name="veto")

    assert model.cache is llm_cache.get_cache("veto")
    assert model.cache is not llm_cache.get_cache("action_card")


def test_a_model_without_a_name_is_never_cached():
    assert get_chat_model().cache is False


def test_switching_the_cache_off_leaves_named_models_uncached(monkeypatch):
    monkeypatch.setattr(settings, "LLM_CACHE_ENABLED", False)

    assert get_chat_model(cache_name="veto").cache is False


def test_an_unknown_cache_name_is_rejected():
    with pytest.raises(ValueError):
        get_chat_model(cache_name="typo")


def test_content_generation_chains_are_not_cached():
    from mlops_serious_game.application.pitch_debate_service import chains

    for build in (chains.get_intel_artifact_chain, chains.get_wrong_intel_chain):
        assert build().middle[0].cache is False


def test_gameplay_chains_use_their_own_cache():
    from mlops_serious_game.application.action_card_pitch_service import chains as pitch
    from mlops_serious_game.application.action_card_veto_service.chains import get_action_card_veto_chain

    assert pitch.get_player_pitch_chain().middle[0].cache is llm_cache.get_cache("pitch_player")
    assert pitch.get_stakeholder_pitch_chain().middle[0].cache is llm_cache.get_cache("pitch_stakeholder")
    assert get_action_card_veto_chain().middle[0].cache is llm_cache.get_cache("veto")


# -- caching and counting ---------------------------------------------------

def test_hits_and_misses_are_counted_per_cache(migrated_db):
    first, again, other = _ask(llm_cache.get_cache("veto"), "same prompt", "same prompt", "another prompt")

    assert (first, again) == ("answer 0", "answer 0")
    assert other == "answer 1"  # the hit consumed no answer
    row = _row("veto")
    assert (row["entries"], row["hits"], row["misses"]) == (2, 1, 2)
    assert row["hit_rate"] == pytest.approx(1 / 3)
    assert _row("action_card")["hit_rate"] is None


def test_totals_add_up_across_caches(migrated_db):
    _ask(llm_cache.get_cache("veto"), "a", "a")
    _ask(llm_cache.get_cache("action_card"), "b")

    stats = llm_cache.cache_stats()
    assert (stats["total_entries"], stats["total_hits"], stats["total_requests"]) == (2, 1, 3)
    assert stats["version"] == "build-1"


def test_a_tool_calling_answer_survives_the_round_trip(migrated_db):
    cache = llm_cache.get_cache("debate_stakeholder_response")
    call = {"name": "search", "args": {"query": "budget"}, "id": "call_1"}

    cache.update("prompt", "llm", [ChatGeneration(message=AIMessage(content="", tool_calls=[call]))])
    found = cache.lookup("prompt", "llm")

    assert found[0].message.tool_calls[0]["args"] == {"query": "budget"}


def test_the_model_settings_are_part_of_the_key(migrated_db):
    cache = llm_cache.get_cache("veto")
    cache.update("prompt", "temperature=0.7", _generation())

    assert cache.lookup("prompt", "temperature=0.9") is None


# -- surviving restarts, dying with a new build -----------------------------

def test_answers_and_counters_survive_a_restart(migrated_db, monkeypatch):
    _ask(llm_cache.get_cache("veto"), "same prompt")
    monkeypatch.setattr(llm_cache, "_caches", {})  # a new process starts with no objects

    (again,) = _ask(llm_cache.get_cache("veto"), "same prompt")

    assert again == "answer 0"
    row = _row("veto")
    assert (row["entries"], row["hits"], row["misses"]) == (1, 1, 1)


def test_a_new_build_starts_with_an_empty_cache(migrated_db, monkeypatch):
    cache = llm_cache.get_cache("veto")
    cache.update("same prompt", "llm", _generation())

    monkeypatch.setattr(settings, "BUILD_VERSION", "build-2")

    assert cache.lookup("same prompt", "llm") is None
    assert _row("veto")["entries"] == 0


def test_purging_removes_only_other_builds(migrated_db, monkeypatch):
    from mlops_serious_game.infrastructure.database import get_session
    from mlops_serious_game.infrastructure.database.models import LlmCacheEntry, LlmCacheStat

    _ask(llm_cache.get_cache("veto"), "old prompt")
    monkeypatch.setattr(settings, "BUILD_VERSION", "build-2")
    _ask(llm_cache.get_cache("veto"), "new prompt")

    removed = llm_cache.purge_stale()

    assert removed == 1
    with get_session() as session:
        assert {v for (v,) in session.execute(select(LlmCacheEntry.version))} == {"build-2"}
        assert {v for (v,) in session.execute(select(LlmCacheStat.version))} == {"build-2"}


def test_the_least_recently_used_prompt_is_dropped_past_the_size_limit(migrated_db, monkeypatch):
    monkeypatch.setattr(settings, "LLM_CACHE_MAXSIZE", 2)
    cache = llm_cache.get_cache("veto")
    cache.update("a", "llm", _generation())
    cache.update("b", "llm", _generation())
    assert cache.lookup("a", "llm") is not None  # a is now more recent than b

    cache.update("c", "llm", _generation())

    assert cache.lookup("b", "llm") is None
    assert cache.lookup("a", "llm") is not None
    assert cache.lookup("c", "llm") is not None


def test_a_database_error_is_a_miss_not_a_crash(monkeypatch):
    def broken():
        raise RuntimeError("db down")

    monkeypatch.setattr(llm_cache, "get_session", broken)
    cache = llm_cache.get_cache("veto")

    assert cache.lookup("p", "l") is None
    cache.update("p", "l", _generation())


# -- admin panel ------------------------------------------------------------

def test_admin_route_needs_the_admin_cookie_and_lists_every_cache(migrated_db):
    from fastapi.testclient import TestClient

    from mlops_serious_game.infrastructure.api import app
    from mlops_serious_game.infrastructure.routes.admin_routes import check_admin_token

    client = TestClient(app)
    assert client.get("/api/admin/llm-cache").status_code == 401

    app.dependency_overrides[check_admin_token] = lambda: "admin"
    try:
        body = client.get("/api/admin/llm-cache").json()
    finally:
        app.dependency_overrides.pop(check_admin_token, None)

    assert [row["name"] for row in body["caches"]] == list(llm_cache.CACHE_LABELS)
    assert body["version"] == "build-1"
