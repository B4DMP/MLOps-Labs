"""The admin panel's bug report list: filters and ordering."""

import datetime

from test_run_scope import _seed_user, migrated_db  # noqa: F401  (fixture used by name)


def _report(user_id: int, message: str, when: datetime.datetime, phase: int | None = None, url: str | None = None):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import BugReportRow

    debug = {} if phase is None else {"currentPhase": phase, "currentChallenge": 1}
    with get_session() as session:
        session.add(BugReportRow(user_id=user_id, message=message, page_url=url, debug_info=debug, time_stamp=when))


def _seed(migrated):
    alice = _seed_user("alice", "camp-1")
    bob = _seed_user("bob", "camp-2")
    day = datetime.datetime(2026, 1, 1)
    _report(alice, "Button broken", day, phase=2, url="/game")
    _report(bob, "Typo in intro", day + datetime.timedelta(days=1), phase=0)
    _report(alice, "Crash on save", day + datetime.timedelta(days=2))


def _ids_messages(result):
    return [r["message"] for r in result["reports"]]


def test_newest_first_by_default_with_reporter_details(migrated_db):
    from mlops_serious_game.application.services.bug_report_service import list_bug_reports

    _seed(migrated_db)
    result = list_bug_reports()

    assert result["total"] == 3
    assert _ids_messages(result) == ["Crash on save", "Typo in intro", "Button broken"]
    assert result["reports"][0]["email"] == "alice@example.test"
    assert result["reports"][0]["campaign_key"] == "camp-1"


def test_filters_narrow_the_list(migrated_db):
    from mlops_serious_game.application.services.bug_report_service import list_bug_reports

    _seed(migrated_db)
    assert _ids_messages(list_bug_reports(email="BOB")) == ["Typo in intro"]
    assert set(_ids_messages(list_bug_reports(campaign_key="camp-1"))) == {"Button broken", "Crash on save"}
    assert _ids_messages(list_bug_reports(search="/game")) == ["Button broken"]
    assert _ids_messages(list_bug_reports(search="typo")) == ["Typo in intro"]
    since = datetime.datetime(2026, 1, 2)
    assert set(_ids_messages(list_bug_reports(since=since))) == {"Typo in intro", "Crash on save"}
    assert _ids_messages(list_bug_reports(until=datetime.datetime(2026, 1, 1, 12))) == ["Button broken"]


def test_ordering_by_attribute_and_direction(migrated_db):
    from mlops_serious_game.application.services.bug_report_service import list_bug_reports

    _seed(migrated_db)
    assert _ids_messages(list_bug_reports(sort="time_stamp", descending=False))[0] == "Button broken"
    assert _ids_messages(list_bug_reports(sort="email", descending=False))[-1] == "Typo in intro"
    assert _ids_messages(list_bug_reports(sort="phase", descending=True))[0] == "Button broken"
    assert _ids_messages(list_bug_reports(sort="message", descending=False))[0] == "Button broken"


def test_delete_removes_only_that_report(migrated_db):
    from mlops_serious_game.application.services.bug_report_service import delete_bug_report, list_bug_reports

    _seed(migrated_db)
    target = next(r for r in list_bug_reports()["reports"] if r["message"] == "Typo in intro")

    assert delete_bug_report(target["id"]) is True
    assert set(_ids_messages(list_bug_reports())) == {"Button broken", "Crash on save"}
    assert delete_bug_report(target["id"]) is False
