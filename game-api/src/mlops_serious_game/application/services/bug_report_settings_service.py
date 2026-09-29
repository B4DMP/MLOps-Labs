"""Who gets emailed when a player submits a bug report - admin-editable, seeded from
`settings.BUG_REPORT_DEFAULT_RECIPIENTS` (see alembic revision f2a3b4c5d6e7)."""

from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.database import get_session
from mlops_serious_game.infrastructure.database.models import BugReportRecipientsRow

SETTINGS_ROW_ID = 1


def get_recipients() -> list[str]:
    with get_session() as session:
        row = session.get(BugReportRecipientsRow, SETTINGS_ROW_ID)
        if row is None or not row.recipients:
            return list(settings.BUG_REPORT_DEFAULT_RECIPIENTS)
        return list(row.recipients)


def update_recipients(recipients: list[str]) -> list[str]:
    clean = [r.strip() for r in recipients if isinstance(r, str) and "@" in r.strip()]
    with get_session() as session:
        row = session.get(BugReportRecipientsRow, SETTINGS_ROW_ID)
        if row is None:
            row = BugReportRecipientsRow(id=SETTINGS_ROW_ID, recipients=clean)
            session.add(row)
        else:
            row.recipients = clean
        session.flush()
        return list(row.recipients)
