import asyncio

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.runnables.fallbacks import RunnableWithFallbacks

from mlops_serious_game.application import llm, llm_alerts
from mlops_serious_game.config import settings


class _Down(FakeListChatModel):
    def _call(self, *args, **kwargs):
        raise RuntimeError("429 rate limited")


def _fake_builders(monkeypatch, down=()):
    def builder(name):
        def build(model_name, temperature, cache):
            cls = _Down if name in down else FakeListChatModel
            return cls(responses=[f"answer from {name}"], cache=cache)
        return build

    monkeypatch.setattr(llm, "_PROVIDER_BUILDERS", {n: builder(n) for n in ("mistral", "westai", "groq")})


def _keys(monkeypatch, **keys):
    for name in ("MISTRAL", "WESTAI", "GROQ"):
        monkeypatch.setattr(settings, f"{name}_API_KEY", keys.get(name.lower()))


@pytest.fixture(autouse=True)
def _no_override(monkeypatch):
    monkeypatch.setattr(llm_alerts, "_last_alert", {})
    monkeypatch.setattr(llm_alerts, "_send_alert", _no_send)  # never email from a test
    llm.bind_llm_provider(None)
    yield
    llm.bind_llm_provider(None)


def test_one_configured_provider_is_returned_as_is(monkeypatch):
    _keys(monkeypatch, mistral="k")
    _fake_builders(monkeypatch)

    assert not isinstance(llm.get_chat_model(), RunnableWithFallbacks)


def test_the_other_keyed_providers_back_up_the_primary_in_priority_order(monkeypatch):
    _keys(monkeypatch, mistral="k", groq="k", westai="k")
    _fake_builders(monkeypatch)

    model = llm.get_chat_model()

    assert isinstance(model, RunnableWithFallbacks)
    assert model.invoke("hi").content == "answer from mistral"
    assert len(model.fallbacks) == 2


def test_a_campaign_override_stays_primary_and_the_rest_back_it_up(monkeypatch):
    _keys(monkeypatch, mistral="k", groq="k")
    _fake_builders(monkeypatch, down=("groq",))
    llm.bind_llm_provider("groq")

    assert llm.get_chat_model().invoke("hi").content == "answer from mistral"


def test_a_failing_primary_hands_the_call_to_the_next_provider(monkeypatch):
    _keys(monkeypatch, mistral="k", westai="k", groq="k")
    _fake_builders(monkeypatch, down=("mistral",))

    assert llm.get_chat_model().invoke("hi").content == "answer from westai"


def test_every_provider_down_still_raises_so_callers_use_their_scripted_text(monkeypatch):
    _keys(monkeypatch, mistral="k", groq="k")
    _fake_builders(monkeypatch, down=("mistral", "groq"))

    with pytest.raises(RuntimeError):
        llm.get_chat_model().invoke("hi")


def test_the_cache_attribute_reaches_the_primary(monkeypatch):
    _keys(monkeypatch, mistral="k", groq="k")
    _fake_builders(monkeypatch)

    assert llm.get_chat_model().cache is False


_sent: list[tuple] = []


async def _no_send(provider, campaign_key, fallbacks, error):
    _sent.append((provider, campaign_key, tuple(fallbacks)))


def test_one_alert_per_provider_per_cooldown(monkeypatch):
    _sent.clear()

    async def fail_three_times():
        handler = llm_alerts.ProviderFailureHandler("mistral", "camp", ["groq"])
        for _ in range(3):
            await handler.on_llm_error(RuntimeError("boom"))
        await handler_other.on_llm_error(RuntimeError("boom"))
        await asyncio.gather(*list(llm_alerts._pending))

    handler_other = llm_alerts.ProviderFailureHandler("groq", "camp", [])
    asyncio.run(fail_three_times())

    assert _sent == [("mistral", "camp", ("groq",)), ("groq", "camp", ())]


def test_cancellation_is_not_a_provider_failure(monkeypatch):
    _sent.clear()

    asyncio.run(llm_alerts.ProviderFailureHandler("mistral", "", []).on_llm_error(asyncio.CancelledError()))

    assert _sent == []
