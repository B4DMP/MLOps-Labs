"""Tests for the admin Results page (docs/plans/results-screen.md, section 5, D6/D10).

Real throwaway Postgres, reusing test_run_scope.py's fixture and row builders.

What is pinned:

- A playtest-tainted account leaves **every** aggregate by default, not just this page, because the
  exclusion sits in the one `get_valid_players_set` chokepoint (D10).
- Only each player's first run counts by default; replays are opt-in.
- The pre-existing admin aggregates keep describing the first run, so a replay cannot double-count
  a player or show someone mid-way through game two as "Completed".
- One unreadable run must not take the page down.
"""

from unittest.mock import patch

import pytest
from sqlalchemy import select

from test_run_scope import (  # noqa: F401  (migrated_db is a fixture, used by name)
    _add_challenge,
    _seed_user,
    _start_run,
    migrated_db,
)
from test_new_run import PLAYED_CHALLENGE, PLAYED_PHASE, _add_session, _allow_replay, _finish_run


def _finished(username: str, campaign_key: str, *, tainted: bool = False, runs: int = 1) -> int:
    """A player who has finished `runs` games, each with one played challenge."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import User

    user_id = _seed_user(username, campaign_key)
    for run in range(1, runs + 1):
        _start_run(user_id, run, None, username)
        _add_challenge(
            user_id, run, PLAYED_PHASE, PLAYED_CHALLENGE,
            [10 * run, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.6}}, username,
        )
        _add_session(user_id, run, escalation=3, grudges=[], username=username)
        _finish_run(user_id, run, username)
    if tainted:
        with get_session() as session:
            session.get(User, user_id).playtest_tainted = True
    return user_id


def _valid(**kwargs):
    from mlops_serious_game.application.services.admin_service import get_valid_players_set

    return get_valid_players_set(**kwargs)


# ── The playtest exclusion (D10) ─────────────────────────────────────────────


def test_a_tainted_account_is_left_out_of_the_valid_players_by_default(migrated_db):
    _finished("alice", "camp-1")
    _finished("bob", "camp-2", tainted=True)

    assert _valid() == {"alice"}
    assert _valid(include_playtest=True) == {"alice", "bob"}


def test_the_exclusion_reaches_the_pre_existing_aggregates_not_just_this_page(migrated_db):
    """One clause in the chokepoint, so everything built on it drops the account at once."""
    from mlops_serious_game.application.services.admin_service import (
        calculate_finished_players,
        calculate_total_players,
    )

    _finished("alice", "camp-1")
    _finished("bob", "camp-2", tainted=True)

    assert calculate_total_players() == 1
    assert calculate_finished_players() == 1


def test_the_dashboard_reports_how_many_accounts_it_left_out(migrated_db):
    """A smaller n with no explanation is worse than a smaller n with one."""
    from mlops_serious_game.application.services.admin_results import get_results_dashboard

    _finished("alice", "camp-1")
    _finished("bob", "camp-2", tainted=True)

    default = get_results_dashboard()
    assert default["aggregates"]["runs"] == 1
    assert default["excluded_playtest_accounts"] == 1
    assert [p["name"] for p in default["players"]] == ["alice"]

    included = get_results_dashboard(include_playtest=True)
    assert included["aggregates"]["runs"] == 2
    assert included["excluded_playtest_accounts"] == 0
    assert {p["name"]: p["playtest_tainted"] for p in included["players"]} == {"alice": False, "bob": True}


# ── First run, or all runs ───────────────────────────────────────────────────


def test_only_the_first_run_counts_by_default(migrated_db):
    """A second run has been told the answers by the first, so it is not the study's measurement."""
    from mlops_serious_game.application.services.admin_results import get_results_dashboard

    _finished("alice", "camp-1", runs=2)

    assert get_results_dashboard()["aggregates"]["runs"] == 1
    assert get_results_dashboard(runs="all")["aggregates"]["runs"] == 2


def test_the_player_list_shows_every_finished_run_whichever_mode_is_picked(migrated_db):
    """The drill-down needs to reach a replay even when the aggregate ignores it."""
    from mlops_serious_game.application.services.admin_results import get_results_dashboard

    _finished("alice", "camp-1", runs=2)

    players = get_results_dashboard(runs="first")["players"]
    assert [r["run_index"] for r in players[0]["runs"]] == [1, 2]


def test_a_player_who_never_finished_is_not_listed(migrated_db):
    from mlops_serious_game.application.services.admin_results import get_results_dashboard

    user_id = _seed_user("carol", "camp-3")
    _start_run(user_id, 1, None, "carol")  # in progress, never index 4

    dashboard = get_results_dashboard()
    assert dashboard["players"] == []
    assert dashboard["aggregates"]["runs"] == 0


def test_an_empty_campaign_still_returns_something_renderable(migrated_db):
    from mlops_serious_game.application.services.admin_results import get_results_dashboard

    dashboard = get_results_dashboard()
    assert dashboard["aggregates"]["runs"] == 0
    assert dashboard["players"] == []
    assert dashboard["intel_items"] == {"most_gathered": [], "least_gathered": []}


def test_the_campaign_filter_narrows_to_that_campaign(migrated_db):
    from mlops_serious_game.application.services.admin_results import get_results_dashboard

    _finished("alice", "camp-1")
    _finished("dan", "camp-2")

    assert [p["name"] for p in get_results_dashboard("camp-2")["players"]] == ["dan"]
    assert len(get_results_dashboard("all")["players"]) == 2


# ── Robustness ───────────────────────────────────────────────────────────────


def test_one_unreadable_run_does_not_take_the_page_down(migrated_db):
    from mlops_serious_game.application.results_service import service
    from mlops_serious_game.application.services.admin_results import get_results_dashboard

    _finished("alice", "camp-1")
    _finished("dan", "camp-2")
    real = service.results_for

    def flaky(username, run_index=None, **kwargs):
        if username == "alice":
            raise RuntimeError("corrupt row")
        return real(username, run_index, **kwargs)

    with patch.object(service, "results_for", flaky):
        dashboard = get_results_dashboard()

    assert dashboard["unreadable_runs"] == 1
    assert dashboard["aggregates"]["runs"] == 1
    assert [p["name"] for p in dashboard["players"]] == ["dan"]


# ── Per-item intel rates ─────────────────────────────────────────────────────


def test_intel_items_are_rated_against_the_runs_that_actually_dealt_their_challenge(migrated_db):
    from mlops_serious_game.application.services.admin_results import get_results_dashboard
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import IntelItem

    user_id = _finished("alice", "camp-1")
    found = RequirementFactory.get_requirements_for_challenge(PLAYED_CHALLENGE)[0]
    with get_session() as session:
        session.add(IntelItem(user_name="alice", user_id=user_id, run_index=1, intel_item_data={"id": found.id}))

    items = get_results_dashboard()["intel_items"]

    top = items["most_gathered"][0]
    assert (top["id"], top["gathered"], top["dealt"], top["rate"]) == (found.id, 1, 1, 1.0)
    # Everything else in that challenge was dealt but not found.
    assert items["least_gathered"][0]["rate"] == 0.0
    # An item from a challenge nobody played is not listed as missed.
    other = next(r for r in RequirementFactory.requirements if r.challenge_id != PLAYED_CHALLENGE)
    assert other.id not in {i["id"] for i in items["least_gathered"] + items["most_gathered"]}


# ── The existing aggregates stay about the first run ─────────────────────────


def test_a_replay_does_not_move_a_players_recorded_progress(migrated_db):
    """Someone mid-way through game two must not read as "Completed", nor a completed one as
    in progress, and the run count says a replay happened."""
    from mlops_serious_game.application.services.admin_service import get_player_data
    from mlops_serious_game.infrastructure.database.connection import get_session  # noqa: F401

    user_id = _finished("alice", "camp-1")
    _start_run(user_id, 2, None, "alice")  # second game begun, not finished

    alice = get_player_data()["alice"]
    assert alice["maxProgressIndex"] == 4
    assert alice["runs"] == 2


def test_a_replay_is_not_counted_as_a_second_finished_player(migrated_db):
    from mlops_serious_game.application.services.admin_service import calculate_finished_players

    _finished("alice", "camp-1", runs=2)
    assert calculate_finished_players() == 1


def test_the_player_list_flags_a_tainted_account(migrated_db):
    from mlops_serious_game.application.services.admin_service import get_admin_dashboard_data

    _finished("bob", "camp-2", tainted=True)
    row = next(p for p in get_admin_dashboard_data()["players"] if p["name"] == "bob")
    assert row["playtestTainted"] is True
    assert row["runs"] == 1


# ── The drill-down ───────────────────────────────────────────────────────────


def test_the_drill_down_defaults_to_the_first_finished_run(migrated_db):
    from mlops_serious_game.application.services.admin_results import get_player_results

    _finished("alice", "camp-1", runs=2)
    result = get_player_results("alice")

    assert result["run_index"] == 1
    assert result["runs"] == [1, 2]
    assert result["results"]["run_index"] == 1
    assert result["playtest_tainted"] is False


def test_the_drill_down_can_open_a_replay(migrated_db):
    from mlops_serious_game.application.services.admin_results import get_player_results

    _finished("alice", "camp-1", runs=2)
    assert get_player_results("alice", 2)["results"]["run_index"] == 2


@pytest.mark.parametrize(
    "player, run",
    [("nobody", None), ("carol", None), ("alice", 3)],
    ids=["unknown player", "never finished", "run not finished"],
)
def test_the_drill_down_refuses_what_has_no_verdict(migrated_db, player, run):
    """A half-played run has no grade to show, and an unknown name is not an empty result."""
    from mlops_serious_game.application.services.admin_results import get_player_results

    _finished("alice", "camp-1")
    carol = _seed_user("carol", "camp-3")
    _start_run(carol, 1, None, "carol")

    with pytest.raises(ValueError):
        get_player_results(player, run)


# ── Campaign settings ────────────────────────────────────────────────────────


def test_allow_replay_can_be_toggled_and_is_reported(migrated_db):
    from mlops_serious_game.application.services.admin_service import get_campaigns_data, update_campaign

    _seed_user("alice", "camp-1")
    assert get_campaigns_data()[0]["allow_replay"] is False

    update_campaign("camp-1", allow_replay=True)
    assert get_campaigns_data()[0]["allow_replay"] is True


def test_a_new_campaign_does_not_allow_replay_unless_asked(migrated_db):
    """Research campaigns keep one run per player by default."""
    from mlops_serious_game.application.services.admin_service import add_campaign, get_campaigns_data

    add_campaign("A study", "study-1")
    add_campaign("A course", "course-1", allow_replay=True)

    by_key = {c["key"]: c["allow_replay"] for c in get_campaigns_data()}
    assert by_key == {"study-1": False, "course-1": True}
