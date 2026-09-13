"""The model the harness talks to. Same providers as the game (settings), structured output only."""

import json
from typing import Any, Callable, NamedTuple, Optional, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

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
    """Content-gen LLM client. Both Qwen and Mistral are served from the WestAI endpoint;
    the split is which model ID to request. Pass provider='westai' to force WestAI regardless
    of MISTRAL_API_KEY (used by Makefile generation targets so Qwen is picked up via
    WESTAI_LLM_MODEL_CONTENT_GEN). Live gameplay uses WESTAI_LLM_MODEL (Mistral) via the
    game's own chain factories, not this client."""

    def __init__(self, temperature: float = 0.6, model_name: Optional[str] = None,
                 max_tokens: int = 12000, timeout_s: float = 2400,
                 provider: Optional[str] = None, reasoning: bool = False):
        from langchain_groq import ChatGroq
        from langchain_openai import ChatOpenAI

        from mlops_serious_game.config import settings

        if provider == "westai" and not settings.WESTAI_API_KEY:
            raise RuntimeError(
                "content_gen was run with --provider westai but WESTAI_API_KEY is not set. "
                "Refusing to silently fall back to a different provider - set WESTAI_API_KEY, "
                "or drop --provider to let it choose automatically."
            )
        if provider == "mistral" and not settings.MISTRAL_API_KEY:
            raise RuntimeError(
                "content_gen was run with --provider mistral but MISTRAL_API_KEY is not set. "
                "Refusing to silently fall back to a different provider - set MISTRAL_API_KEY, "
                "or drop --provider to let it choose automatically."
            )

        use_westai = provider == "westai" or (
            provider is None and not settings.MISTRAL_API_KEY and settings.WESTAI_API_KEY
        )
        use_mistral = provider == "mistral" or (
            provider is None and bool(settings.MISTRAL_API_KEY) and not use_westai
        )

        def thinking(model_id: str) -> Optional[dict]:
            # Qwen3 reasons before it answers unless told not to. For short structured writing that
            # costs about a minute an item and buys nothing, so it stays off unless asked for.
            if reasoning or "qwen" not in model_id.lower():
                return None
            return {"chat_template_kwargs": {"enable_thinking": False}}

        if use_westai and settings.WESTAI_API_KEY:
            self.model_id = model_name or settings.WESTAI_LLM_MODEL_CONTENT_GEN
            self.chat = ChatOpenAI(api_key=settings.WESTAI_API_KEY, base_url=settings.WESTAI_API_BASE,
                                   model_name=self.model_id, temperature=temperature,
                                   max_tokens=max_tokens, timeout=timeout_s, max_retries=0,
                                   extra_body=thinking(self.model_id))
        elif use_mistral and settings.MISTRAL_API_KEY:
            self.model_id = model_name or settings.MISTRAL_LLM_MODEL
            self.chat = ChatOpenAI(api_key=settings.MISTRAL_API_KEY, base_url=settings.MISTRAL_API_BASE,
                                   model_name=self.model_id, temperature=temperature,
                                   max_tokens=max_tokens, timeout=timeout_s, max_retries=0)
        elif settings.WESTAI_API_KEY:
            self.model_id = model_name or settings.WESTAI_LLM_MODEL_CONTENT_GEN
            self.chat = ChatOpenAI(api_key=settings.WESTAI_API_KEY, base_url=settings.WESTAI_API_BASE,
                                   model_name=self.model_id, temperature=temperature,
                                   max_tokens=max_tokens, timeout=timeout_s, max_retries=0,
                                   extra_body=thinking(self.model_id))
        else:
            self.model_id = model_name or settings.GROQ_LLM_MODEL
            self.chat = ChatGroq(api_key=settings.GROQ_API_KEY, model_name=self.model_id, temperature=temperature,
                                 max_tokens=max_tokens, timeout=timeout_s, max_retries=0)

    def _callbacks(self, tags: Optional[dict]) -> list:
        try:
            from opik.integrations.langchain import OpikTracer

            return [OpikTracer(project_name="MLOps serious game - Content Gen", metadata=tags or {})]
        except Exception:
            return []

    async def structured(self, schema: type[T], system: str, user: str, tags: Optional[dict] = None) -> tuple[T, Usage]:
        # JSON mode with the schema in the prompt. Function calling with large nested schemas makes
        # the server's guided decoding crawl or run to the length limit; this is fast and the
        # pydantic validation below is just as strict. Parse errors surface as retries.
        system = (
            f"{system}\n\nReply with exactly one JSON object and nothing else. It must match this "
            f"JSON schema:\n{json.dumps(schema.model_json_schema())}"
        )
        message = await self.chat.bind(response_format={"type": "json_object"}).ainvoke(
            [("system", system), ("human", user)],
            config={"callbacks": self._callbacks(tags), "metadata": tags or {}},
        )
        text = message.content if isinstance(message.content, str) else str(message.content)
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end < start:
            raise ValueError(f"model returned no JSON object for {schema.__name__}")
        try:
            parsed = schema.model_validate_json(text[start : end + 1])
        except ValidationError as e:
            raise ValueError(f"model JSON does not match {schema.__name__}: {e}") from None
        return parsed, _usage_from(message)


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
