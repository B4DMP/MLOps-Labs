"""Storing "Report a Bug" submissions from the cheat sheet (see CheatSheetModal.tsx) and emailing
the configured recipients (bug_report_settings_service) about them."""

import datetime
from typing import Any, Literal

from loguru import logger
from sqlalchemy import or_, select

from mlops_serious_game.application.services.bug_report_settings_service import get_recipients
from mlops_serious_game.application.services.email_service import send_email
from mlops_serious_game.infrastructure.database import User, get_session
from mlops_serious_game.infrastructure.database.models import BugReportRow


def _build_notification_email(
    email: str, message: str, page_url: str | None, debug_info: dict[str, Any]
) -> tuple[str, str]:
    subject = f"[MLOps Labs] Bug report from {email}"
    debug_lines = "\n".join(f"  {key}: {value}" for key, value in debug_info.items()) or "  (none)"
    body = (
        f"Player: {email}\n"
        f"Page: {page_url or 'n/a'}\n\n"
        f"Message:\n{message}\n\n"
        f"Debug info:\n{debug_lines}"
    )
    return subject, body


async def submit_bug_report(
    user_id: int,
    message: str,
    debug_info: dict[str, Any],
    page_url: str | None = None,
    user_agent: str | None = None,
) -> dict[str, Any]:
    """Stores one bug report and emails it to the configured recipients. Raises ValueError if
    `user_id` doesn't resolve to a real user - the FK needs a real `User.id`, and this only
    ever runs behind `get_current_player`. A notification email failure is logged, not raised:
    the report is already saved by the time we try to send it."""
    with get_session() as session:
        email = session.scalar(select(User.email).where(User.id == user_id))
        if email is None:
            raise ValueError(f"Unknown user: {user_id}")

        row = BugReportRow(
            user_id=user_id,
            message=message,
            page_url=page_url,
            user_agent=user_agent,
            debug_info=debug_info,
        )
        session.add(row)
        session.flush()
        result = {"id": row.id, "time_stamp": row.time_stamp.isoformat()}

    subject, body = _build_notification_email(email, message, page_url, debug_info)
    for recipient in get_recipients():
        try:
            await send_email(recipient, subject, body)
        except Exception as e:
            logger.warning(f"Could not email bug report notification to {recipient}: {e}")

    return result


BugReportSort = Literal["time_stamp", "email", "campaign_key", "phase", "message"]


def _phase_key(debug_info: dict[str, Any]) -> tuple[int, int]:
    """Where in the game the report was filed; reports without a position sort first."""
    phase, challenge = debug_info.get("currentPhase"), debug_info.get("currentChallenge")
    return (phase if isinstance(phase, int) else -1, challenge if isinstance(challenge, int) else -1)


def list_bug_reports(
    *,
    search: str | None = None,
    email: str | None = None,
    campaign_key: str | None = None,
    since: datetime.datetime | None = None,
    until: datetime.datetime | None = None,
    sort: BugReportSort = "time_stamp",
    descending: bool = True,
    limit: int = 500,
) -> dict[str, Any]:
    """Stored bug reports for the admin panel, filtered and ordered. `search` matches the message,
    page URL and reporter's email; `email` is a substring match on the reporter."""
    stmt = (
        select(BugReportRow, User.email, User.campaign_key)
        .join(User, User.id == BugReportRow.user_id)
    )
    if search and search.strip():
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                BugReportRow.message.ilike(like),
                BugReportRow.page_url.ilike(like),
                User.email.ilike(like),
            )
        )
    if email and email.strip():
        stmt = stmt.where(User.email.ilike(f"%{email.strip()}%"))
    if campaign_key:
        stmt = stmt.where(User.campaign_key == campaign_key)
    if since:
        stmt = stmt.where(BugReportRow.time_stamp >= since)
    if until:
        stmt = stmt.where(BugReportRow.time_stamp <= until)

    with get_session() as session:
        rows = [
            {
                "id": report.id,
                "time_stamp": report.time_stamp.isoformat(),
                "email": user_email,
                "campaign_key": user_campaign,
                "message": report.message,
                "page_url": report.page_url,
                "user_agent": report.user_agent,
                "debug_info": report.debug_info or {},
            }
            for report, user_email, user_campaign in session.execute(stmt).all()
        ]

    keys = {
        "time_stamp": lambda r: r["time_stamp"],
        "email": lambda r: r["email"].lower(),
        "campaign_key": lambda r: r["campaign_key"].lower(),
        "phase": lambda r: _phase_key(r["debug_info"]),
        "message": lambda r: r["message"].lower(),
    }
    rows.sort(key=lambda r: (keys[sort](r), r["id"]), reverse=descending)
    return {"total": len(rows), "reports": rows[:limit]}


def delete_bug_report(report_id: int) -> bool:
    """Removes one stored report. Returns False if it does not exist (already deleted)."""
    with get_session() as session:
        row = session.get(BugReportRow, report_id)
        if row is None:
            return False
        session.delete(row)
        return True
