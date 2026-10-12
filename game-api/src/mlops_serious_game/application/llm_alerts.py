import asyncio
import time

from langchain_core.callbacks import AsyncCallbackHandler
from loguru import logger

from mlops_serious_game.application.services.bug_report_settings_service import get_recipients
from mlops_serious_game.application.services.email_service import send_email

# One email per provider per window: a throttled provider fails on every call.
ALERT_COOLDOWN_SECONDS = 15 * 60

_last_alert: dict[str, float] = {}
_pending: set[asyncio.Task] = set()


def _claim_alert(provider: str) -> bool:
    """True if this provider has not been reported within the cooldown (and marks it reported)."""
    now = time.monotonic()
    last = _last_alert.get(provider)
    if last is not None and now - last < ALERT_COOLDOWN_SECONDS:
        return False
    _last_alert[provider] = now
    return True


async def _send_alert(provider: str, campaign_key: str, fallbacks: list[str], error: BaseException) -> None:
    subject = f"[MLOps Labs] LLM provider failing: {provider}"
    served_by = f"falling back to {', '.join(fallbacks)}" if fallbacks else "no fallback provider, players get scripted text"
    body = (
        f"A call to {provider} failed ({served_by}).\n\n"
        f"Campaign: {campaign_key or 'n/a'}\n"
        f"Error: {type(error).__name__}: {str(error)[:500]}\n\n"
        f"Further failures from {provider} are not emailed for {ALERT_COOLDOWN_SECONDS // 60} minutes."
    )
    try:
        for recipient in get_recipients():
            try:
                await send_email(recipient, subject, body)
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"Could not email LLM failure alert to {recipient}: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not send LLM failure alert: {exc}")


class ProviderFailureHandler(AsyncCallbackHandler):
    """Logs every failed model call and emails the bug-report recipients about the first one.
    Sends in a background task so a slow SMTP server never delays the fallback."""

    def __init__(self, provider: str, campaign_key: str | None, fallbacks: list[str]) -> None:
        self.provider = provider
        self.campaign_key = campaign_key or ""
        self.fallbacks = fallbacks

    async def on_llm_error(self, error: BaseException, **kwargs) -> None:
        if not isinstance(error, Exception):  # cancellation, not a provider fault
            return
        logger.warning(f"LLM provider {self.provider} failed: {type(error).__name__}: {error}")
        if not _claim_alert(self.provider):
            return
        task = asyncio.create_task(_send_alert(self.provider, self.campaign_key, self.fallbacks, error))
        _pending.add(task)
        task.add_done_callback(_pending.discard)
