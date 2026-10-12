from contextvars import ContextVar
from typing import Literal, Optional

from langchain_core.runnables.fallbacks import RunnableWithFallbacks
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from mlops_serious_game.application.llm_alerts import ProviderFailureHandler
from mlops_serious_game.application.llm_cache import get_cache
from mlops_serious_game.application.llm_usage import TokenUsageHandler
from mlops_serious_game.config import settings

LLMProvider = Literal["mistral", "westai", "groq"]

_current_llm_provider: ContextVar[Optional[LLMProvider]] = ContextVar(
    "current_llm_provider", default=None
)
_current_campaign_key: ContextVar[Optional[str]] = ContextVar("current_campaign_key", default=None)


def bind_llm_provider(provider: Optional[LLMProvider]) -> None:
    """Binds the LLM provider the current player's campaign picked, for the rest of this
    asyncio task - same mechanism as domain.persona_resolver.bind_personas, set once per
    websocket connection (infrastructure.websocket.router) and inherited by every handler and
    task it spawns. None means the campaign has no override, so get_chat_model falls back to the
    server-wide Mistral -> WestAI -> Groq priority.
    """
    _current_llm_provider.set(provider)


def bind_llm_campaign(campaign_key: Optional[str]) -> None:
    """Binds the campaign whose token usage get_chat_model's models are counted against."""
    _current_campaign_key.set(campaign_key)


def _build_mistral(model_name: str | None, temperature: float, cache) -> ChatOpenAI:
    if not settings.MISTRAL_API_KEY:
        raise RuntimeError(
            "This campaign is configured to use Mistral, but MISTRAL_API_KEY is not set."
        )
    return ChatOpenAI(
        api_key=settings.MISTRAL_API_KEY,
        base_url=settings.MISTRAL_API_BASE,
        timeout=settings.LLM_REQUEST_TIMEOUT_SECONDS,
        model_name=model_name or settings.MISTRAL_LLM_MODEL,
        temperature=temperature,
        max_retries=settings.LLM_MAX_RETRIES,
        cache=cache,
    )


def _build_westai(model_name: str | None, temperature: float, cache) -> ChatOpenAI:
    if not settings.WESTAI_API_KEY:
        raise RuntimeError(
            "This campaign is configured to use WestAI, but WESTAI_API_KEY is not set."
        )
    return ChatOpenAI(
        api_key=settings.WESTAI_API_KEY,
        base_url=settings.WESTAI_API_BASE,
        timeout=settings.LLM_REQUEST_TIMEOUT_SECONDS,
        model_name=model_name or settings.WESTAI_LLM_MODEL,
        temperature=temperature,
        max_retries=settings.LLM_MAX_RETRIES,
        cache=cache,
    )


def _build_groq(model_name: str | None, temperature: float, cache) -> ChatGroq:
    if not settings.GROQ_API_KEY:
        raise RuntimeError(
            "This campaign is configured to use Groq, but GROQ_API_KEY is not set."
        )
    return ChatGroq(
        api_key=settings.GROQ_API_KEY,
        request_timeout=settings.LLM_REQUEST_TIMEOUT_SECONDS,
        model_name=model_name or settings.GROQ_LLM_MODEL,
        temperature=temperature,
        max_retries=settings.LLM_MAX_RETRIES,
        cache=cache,
    )


_PROVIDER_BUILDERS = {
    "mistral": _build_mistral,
    "westai": _build_westai,
    "groq": _build_groq,
}


_PRIORITY: tuple[LLMProvider, ...] = ("mistral", "westai", "groq")


def _has_key(provider: LLMProvider) -> bool:
    return bool(getattr(settings, f"{provider.upper()}_API_KEY"))


def _build(provider: LLMProvider, model_name, temperature, cache, fallbacks: list[str]):
    model = _PROVIDER_BUILDERS[provider](model_name, temperature, cache)
    campaign = _current_campaign_key.get()
    model.callbacks = [TokenUsageHandler(campaign), ProviderFailureHandler(provider, campaign, fallbacks)]
    return model


def get_chat_model(
    temperature: float = 0.7,
    model_name: str | None = None,
    cache_name: str | None = None,
) -> ChatOpenAI | ChatGroq | RunnableWithFallbacks:
    """The configured chat model. Cached only when `cache_name` names one of the llm_cache caches.

    Honors the current player's campaign override (see bind_llm_provider) when one is bound,
    raising loudly if that provider's API key isn't configured rather than silently using a
    different one. With no override bound, picks the first Mistral -> WestAI -> Groq provider
    with an API key. If that provider errors (rate limit, outage, timeout) the call moves on to
    the other providers that have a key, in the same order.
    """
    # False, not None: None would fall back to a global cache if someone ever sets one.
    cache = get_cache(cache_name) if cache_name else None
    cache = cache if cache is not None else False

    primary = _current_llm_provider.get() or next((p for p in _PRIORITY if _has_key(p)), "groq")
    backups = [p for p in _PRIORITY if p != primary and _has_key(p)]

    model = _build(primary, model_name, temperature, cache, backups)
    if not backups:
        return model
    # model_name belongs to the primary provider; the backups use their own default model.
    return model.with_fallbacks(
        [_build(p, None, temperature, cache, backups[i + 1:]) for i, p in enumerate(backups)]
    )
