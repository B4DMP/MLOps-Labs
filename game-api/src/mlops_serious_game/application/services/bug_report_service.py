"""Storing "Report a Bug" submissions from the cheat sheet (see CheatSheetModal.tsx) and emailing
the configured recipients (bug_report_settings_service) about them."""

from typing import Any

from loguru import logger

from mlops_serious_game.application.services.bug_report_settings_service import get_recipients
from mlops_serious_game.application.services.email_service import send_email
from mlops_serious_game.infrastructure.database import get_session, get_user_id
from mlops_serious_game.infrastructure.database.models import BugReportRow


def _build_notification_email(
    user_name: str, message: str, page_url: str | None, debug_info: dict[str, Any]
) -> tuple[str, str]:
    subject = f"[MLOps Labs] Bug report from {user_name}"
    debug_lines = "\n".join(f"  {key}: {value}" for key, value in debug_info.items()) or "  (none)"
    body = (
        f"Player: {user_name}\n"
        f"Page: {page_url or 'n/a'}\n\n"
        f"Message:\n{message}\n\n"
        f"Debug info:\n{debug_lines}"
    )
    return subject, body


async def submit_bug_report(
    user_name: str,
    message: str,
    debug_info: dict[str, Any],
    page_url: str | None = None,
    user_agent: str | None = None,
) -> dict[str, Any]:
    """Stores one bug report and emails it to the configured recipients. Raises ValueError if
    `user_name` doesn't resolve to a real user - the FK needs a real `User.id`, and this only
    ever runs behind `get_current_player`. A notification email failure is logged, not raised:
    the report is already saved by the time we try to send it."""
    with get_session() as session:
        user_id = get_user_id(session, user_name)
        if user_id is None:
            raise ValueError(f"Unknown user: {user_name}")

        row = BugReportRow(
            user_name=user_name,
            user_id=user_id,
            message=message,
            page_url=page_url,
            user_agent=user_agent,
            debug_info=debug_info,
        )
        session.add(row)
        session.flush()
        result = {"id": row.id, "time_stamp": row.time_stamp.isoformat()}

    subject, body = _build_notification_email(user_name, message, page_url, debug_info)
    for recipient in get_recipients():
        try:
            await send_email(recipient, subject, body)
        except Exception as e:
            logger.warning(f"Could not email bug report notification to {recipient}: {e}")

    return result
