"""The model the harness talks to. Same providers as the game (settings), structured output only."""

from typing import Any, Callable, NamedTuple, Optional, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class Usage(NamedTuple):
    tokens_in: int = 0
    tokens_out: int = 0


class LLM(Protocol):
    model_id: str

    async def structured(self, schema: type[T], system: str, user: str, tags: Optional[dict] = None) -> tuple[T, Usage]:
        ...


def _usage_from(raw: Any) -> Usage:
    meta = getattr(raw, "usage_metadata", None) or {}
    if meta:
        return Usage(int(meta.get("input_tokens", 0)), int(meta.get("output_tokens", 0)))
    token_usage = (getattr(raw, "response_metadata", None) or {}).get("token_usage") or {}
    return Usage(int(token_usage.get("prompt_tokens", 0)), int(token_usage.get("completion_tokens", 0)))


class LangchainLLM:
    """Uses the provider the game is configured for: Mistral, WestAI, else Groq."""

    def __init__(self, temperature: float = 0.6, model_name: Optional[str] = None):
        from langchain_groq import ChatGroq
        from langchain_openai import ChatOpenAI

        from mlops_serious_game.config import settings

        if settings.MISTRAL_API_KEY:
            self.model_id = model_name or settings.MISTRAL_LLM_MODEL
            self.chat = ChatOpenAI(api_key=settings.MISTRAL_API_KEY, base_url=settings.MISTRAL_API_BASE,
                                   model_name=self.model_id, temperature=temperature)
        elif settings.WESTAI_API_KEY:
            self.model_id = model_name or settings.WESTAI_LLM_MODEL
            self.chat = ChatOpenAI(api_key=settings.WESTAI_API_KEY, base_url=settings.WESTAI_API_BASE,
                                   model_name=self.model_id, temperature=temperature)
        else:
            self.model_id = model_name or settings.GROQ_LLM_MODEL
            self.chat = ChatGroq(api_key=settings.GROQ_API_KEY, model_name=self.model_id, temperature=temperature)

    def _callbacks(self, tags: Optional[dict]) -> list:
        try:
            from opik.integrations.langchain import OpikTracer

            return [OpikTracer(project_name="MLOps serious game - Content Gen", metadata=tags or {})]
        except Exception:
            return []

    async def structured(self, schema: type[T], system: str, user: str, tags: Optional[dict] = None) -> tuple[T, Usage]:
        runnable = self.chat.with_structured_output(schema, include_raw=True)
        result = await runnable.ainvoke(
            [("system", system), ("human", user)],
            config={"callbacks": self._callbacks(tags), "metadata": tags or {}},
        )
        parsed = result.get("parsed")
        if parsed is None:
            raise ValueError(f"model returned no parseable {schema.__name__}: {result.get('parsing_error')}")
        return parsed, _usage_from(result.get("raw"))


class FakeLLM:
    """For tests: `respond(schema, system, user)` returns the object to hand back."""

    def __init__(self, respond: Callable[[type, str, str], Any], model_id: str = "fake"):
        self.respond = respond
        self.model_id = model_id
        self.calls: list[tuple[str, str]] = []

    async def structured(self, schema, system, user, tags=None):
        self.calls.append((schema.__name__, user))
        out = self.respond(schema, system, user)
        if isinstance(out, Exception):
            raise out
        return (out if isinstance(out, schema) else schema.model_validate(out)), Usage(100, 50)
