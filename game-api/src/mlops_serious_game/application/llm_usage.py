from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from loguru import logger
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from mlops_serious_game.infrastructure.database import get_session
from mlops_serious_game.infrastructure.database.models import Campaign, LlmTokenUsage

# Rough rule of thumb, used only when the provider reports no usage.
_CHARS_PER_TOKEN = 4

# Calls made outside a player's connection (scripts, admin tools) land here.
UNATTRIBUTED = ""


def _estimate(chars: int) -> int:
    return (chars + _CHARS_PER_TOKEN - 1) // _CHARS_PER_TOKEN


def record_usage(campaign_key: str, prompt_tokens: int, completion_tokens: int) -> None:
    """Adds one call to the campaign's totals. A single upsert that increments in SQL, so
    concurrent players and API replicas never overwrite each other's counts."""
    stmt = insert(LlmTokenUsage).values(
        campaign_key=campaign_key, calls=1,
        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
    )
    with get_session() as session:
        session.execute(stmt.on_conflict_do_update(
            index_elements=["campaign_key"],
            set_={
                "calls": LlmTokenUsage.calls + 1,
                "prompt_tokens": LlmTokenUsage.prompt_tokens + prompt_tokens,
                "completion_tokens": LlmTokenUsage.completion_tokens + completion_tokens,
            },
        ))


class TokenUsageHandler(BaseCallbackHandler):
    """Counts the tokens of every real model call for one campaign. Answers replayed from the
    LLM cache cost nothing and are skipped. Never raises: counting must not break a game."""

    def __init__(self, campaign_key: str | None) -> None:
        self.campaign_key = campaign_key or UNATTRIBUTED
        self._input_chars: dict[UUID, int] = {}

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs) -> None:
        self._input_chars[run_id] = sum(len(str(m.content)) for batch in messages for m in batch)

    def on_llm_error(self, error, *, run_id, **kwargs) -> None:
        self._input_chars.pop(run_id, None)

    def on_llm_end(self, response: LLMResult, *, run_id, **kwargs) -> None:
        input_chars = self._input_chars.pop(run_id, 0)
        try:
            generations = [g for batch in response.generations for g in batch]
            if generations and all((g.generation_info or {}).get("cache_hit") for g in generations):
                return
            prompt = completion = 0
            for g in generations:
                usage = getattr(getattr(g, "message", None), "usage_metadata", None)
                if usage:
                    prompt += usage.get("input_tokens", 0)
                    completion += usage.get("output_tokens", 0)
                else:
                    completion += _estimate(len(g.text))
            if not prompt:
                prompt = _estimate(input_chars)
            record_usage(self.campaign_key, prompt, completion)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Could not record LLM token usage: {exc}")


def token_usage_stats() -> dict:
    """Calls and tokens per campaign, every campaign listed even if it made none."""
    with get_session() as session:
        names = dict(session.execute(select(Campaign.campaign_key, Campaign.campaign_name)).all())
        used = {
            key: (calls, prompt, completion)
            for key, calls, prompt, completion in session.execute(select(
                LlmTokenUsage.campaign_key, LlmTokenUsage.calls,
                LlmTokenUsage.prompt_tokens, LlmTokenUsage.completion_tokens,
            )).all()
        }

    rows = []
    for key in sorted(set(names) | set(used), key=lambda k: (names.get(k) or k).lower()):
        calls, prompt, completion = used.get(key, (0, 0, 0))
        rows.append({
            "campaign_key": key,
            "campaign_name": names.get(key) or (key or "Unattributed"),
            "calls": calls,
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
        })
    return {
        "campaigns": rows,
        "total_calls": sum(r["calls"] for r in rows),
        "total_tokens": sum(r["total_tokens"] for r in rows),
    }
