from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from mlops_serious_game.application.llm_cache import get_cache
from mlops_serious_game.config import settings


def get_chat_model(
    temperature: float = 0.7,
    model_name: str | None = None,
    cache_name: str | None = None,
) -> ChatOpenAI | ChatGroq:
    """The configured chat model. Cached only when `cache_name` names one of the llm_cache caches."""
    # False, not None: None would fall back to a global cache if someone ever sets one.
    cache = get_cache(cache_name) if cache_name else None
    cache = cache if cache is not None else False

    if settings.MISTRAL_API_KEY:
        return ChatOpenAI(
            api_key=settings.MISTRAL_API_KEY,
            base_url=settings.MISTRAL_API_BASE,
            model_name=model_name or settings.MISTRAL_LLM_MODEL,
            temperature=temperature,
            cache=cache,
        )
    elif settings.WESTAI_API_KEY:
        return ChatOpenAI(
            api_key=settings.WESTAI_API_KEY,
            base_url=settings.WESTAI_API_BASE,
            model_name=model_name or settings.WESTAI_LLM_MODEL,
            temperature=temperature,
            cache=cache,
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=model_name or settings.GROQ_LLM_MODEL,
            temperature=temperature,
            cache=cache,
        )
