"""Tests for run scoping and the two new-game modes (docs/plans/results-screen.md, D1/D11).

Runs against a real throwaway Postgres migrated to head, like test_user_settings.py: the point of
these tests is the actual `run_index` columns and the chain resolved over them, neither of which
exists on a SQLite stand-in built from the models.

What matters here, in one line each:

- A **fresh start** sees none of the previous run's graph ops, intel or events.
- A **next iteration** sees all of them, which is what carries the built system forward.
- A fresh start *after* a spiral stops the chain, so it starts clean rather than inheriting two runs.
- Nothing is ever deleted: every run's rows survive both modes.
"""

import uuid

import pytest
import sqlalchemy
from sqlalchemy import create_engine, select, text

from mlops_serious_game.config import settings


def _admin_engine():
    admin_url = sqlalchemy.engine.make_url(settings.POSTGRES_URI).set(database="postgres")
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _postgres_reachable() -> bool:
    try:
        with _admin_engine().connect():
            return True
    except Exception:
        return False


@pytest.fixture
def migrated_db(monkeypatch):
    """A throwaway database migrated to head, with `get_session()` redirected at it."""
    if not _postgres_reachable():
        pytest.skip("no postgres reachable - see docker compose up postgres")

    from pathlib import Path
    from alembic import command
    from alembic.config import Config as AlembicConfig
    from sqlalchemy.orm import sessionmaker
    from mlops_serious_game.infrastructure.database import connection as db_connection

    db_name = f"test_run_scope_{uuid.uuid4().hex[:12]}"
    admin = _admin_engine()
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    try:
        test_url = sqlalchemy.engine.make_url(settings.POSTGRES_URI).set(database=db_name)
        test_uri = test_url.render_as_string(hide_password=False)
        monkeypatch.setattr(settings, "POSTGRES_URI", test_uri)

        alembic_dir = Path(__file__).resolve().parents[1] / "alembic"
        alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
        cfg = AlembicConfig(str(alembic_ini))
        cfg.set_main_option("script_location", str(alembic_dir))
        command.upgrade(cfg, "head")

        engine = create_engine(test_uri)
        monkeypatch.setattr(db_connection, "engine", engine)
        monkeypatch.setattr(
            db_connection,
            "SessionLocal",
            sessionmaker(autocommit=False, autoflush=False, bind=engine),
        )

        yield db_name
        engine.dispose()
    finally:
        with admin.connect() as conn:
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": db_name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))


def _seed_user(username: str = "alice", campaign_key: str = "camp-1") -> int:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign, User

    with get_session() as session:
        campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key)
        session.add(campaign)
        session.flush()
        user = User(
            user_name=username,
            campaign_key=campaign_key,
            campaign_id=campaign.id,
            email=f"{username}@example.test",
            password_hash="$2b$12$test.hash.not.a.real.bcrypt.digest..............",
            users_on_machine=1,
            is_verified=True,
        )
        session.add(user)
        session.flush()
        return user.id


def _start_run(user_id: int, run_index: int, seeded_from_run: int | None, username: str = "alice") -> None:
    """Writes the progression row that opens a run. `seeded_from_run` is the whole difference
    between a fresh start (None) and a next iteration (the run it continues)."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression

    with get_session() as session:
        session.add(
            GameProgression(
                user_name=username,
                user_id=user_id,
                run_index=run_index,
                seeded_from_run=seeded_from_run,
                game_progress_index=2,
                additional_data=[],
            )
        )


def _add_event(user_id: int, run_index: int, seq: int, username: str = "alice") -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameEventRow

    with get_session() as session:
        session.add(
            GameEventRow(
                user_name=username,
                user_id=user_id,
                run_index=run_index,
                seq=seq,
                phase_id=1,
                challenge_id=1,
                step="offline",
                kind="intel",
                direction="none",
                cause="test.event",
                params={},
                refs={},
            )
        )


# ── The chain ────────────────────────────────────────────────────────────────


def test_first_run_is_a_chain_of_one(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.run_scope import current_run_index, run_chain

    user_id = _seed_user()
    _start_run(user_id, 1, None)

    with get_session() as session:
        assert current_run_index(session, user_id) == 1
        assert run_chain(session, user_id) == [1]


def test_a_player_with_no_progression_is_on_run_one(migrated_db):
    """Never-played accounts must not blow up the chain resolution: their rows default to run 1."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.run_scope import current_run_index, run_chain

    user_id = _seed_user()

    with get_session() as session:
        assert current_run_index(session, user_id) == 1
        assert run_chain(session, user_id) == [1]


def test_fresh_start_does_not_see_the_previous_run(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.run_scope import run_chain

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _start_run(user_id, 2, None)  # fresh start

    with get_session() as session:
        assert run_chain(session, user_id) == [2]


def test_next_iteration_carries_the_previous_run(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.run_scope import run_chain

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _start_run(user_id, 2, seeded_from_run=1)  # the spiral

    with get_session() as session:
        assert run_chain(session, user_id) == [2, 1]


def test_fresh_start_after_a_spiral_stops_the_chain(migrated_db):
    """Runs 1 fresh, 2 spiral, 3 fresh, 4 spiral: run 4 sees 3 and 4 only, never 1 or 2."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.run_scope import run_chain

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _start_run(user_id, 2, seeded_from_run=1)
    _start_run(user_id, 3, None)
    _start_run(user_id, 4, seeded_from_run=3)

    with get_session() as session:
        assert run_chain(session, user_id) == [4, 3]
        assert run_chain(session, user_id, run_index=2) == [2, 1]


def test_a_cycle_in_the_chain_terminates(migrated_db):
    """Malformed data must degrade to a short chain, never hang the request."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression
    from mlops_serious_game.infrastructure.database.run_scope import run_chain

    user_id = _seed_user()
    _start_run(user_id, 1, seeded_from_run=2)
    _start_run(user_id, 2, seeded_from_run=1)

    with get_session() as session:
        chain = run_chain(session, user_id)
        assert sorted(chain) == [1, 2]
        assert len(chain) == len(set(chain))
        assert session.scalar(
            select(sqlalchemy.func.count(GameProgression.id)).where(GameProgression.user_id == user_id)
        ) == 2


# ── What the chain actually scopes ───────────────────────────────────────────


def test_event_log_is_scoped_to_the_chain(migrated_db):
    """The read side of the chain, on the one store where it is cheapest to check end to end."""
    from mlops_serious_game.application.event_log_service.store import load_events

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_event(user_id, run_index=1, seq=1)
    _add_event(user_id, run_index=1, seq=2)

    assert len(load_events("alice")) == 2

    # A fresh start sees none of it...
    _start_run(user_id, 2, None)
    _add_event(user_id, run_index=2, seq=3)
    assert [e.seq for e in load_events("alice")] == [3]

    # ...while a next iteration on top of run 2 keeps run 2's history.
    _start_run(user_id, 3, seeded_from_run=2)
    _add_event(user_id, run_index=3, seq=4)
    assert [e.seq for e in load_events("alice")] == [3, 4]

    # And run 1's rows were never deleted by any of it.
    assert [e.seq for e in load_events("alice", run_index=1)] == [1, 2]


def test_nothing_is_deleted_by_starting_a_new_run(migrated_db):
    """The property the results screen and every admin aggregate depend on."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameEventRow

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_event(user_id, run_index=1, seq=1)
    _start_run(user_id, 2, None)
    _add_event(user_id, run_index=2, seq=2)
    _start_run(user_id, 3, seeded_from_run=2)

    with get_session() as session:
        total = session.scalar(
            select(sqlalchemy.func.count(GameEventRow.id)).where(GameEventRow.user_id == user_id)
        )
    assert total == 2


# ── The results service end to end ───────────────────────────────────────────


def _add_challenge(user_id: int, run_index: int, phase: int, challenge: int, metrics, emotions,
                   username: str = "alice") -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    with get_session() as session:
        session.add(
            GameChallenge(
                user_name=username,
                user_id=user_id,
                run_index=run_index,
                phase_index=phase,
                challenge_index=challenge,
                challenge_loop_index=3,
                action_card={},
                metric_values=metrics,
                messages=[],
                attention_tokens=20,
                emotion_values=emotions,
            )
        )


def _add_outcome(user_id: int, run_index: int, seq: int, cause: str, username: str = "alice") -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameEventRow

    with get_session() as session:
        session.add(
            GameEventRow(
                user_name=username, user_id=user_id, run_index=run_index, seq=seq,
                phase_id=1, challenge_id=1, step="commit", kind="outcome",
                direction="none", cause=cause, params={}, refs={},
            )
        )


def test_build_results_produces_a_grade_for_a_played_run(migrated_db):
    """End to end on real rows: the wiring between the stores and the pure scoring."""
    from mlops_serious_game.application.results_service.service import build_results

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, phase=1, challenge=1, metrics=[10, 5, 0, 0, 0, 0, 0, 0],
                   emotions={"model_monica": {"trust": 0.7, "respect": 0.6}})
    _add_outcome(user_id, 1, seq=1, cause="outcome.pass")

    results = build_results("alice")

    assert results["run_index"] == 1
    assert results["is_spiral"] is False
    assert results["seeded_from_run"] is None
    assert 0.0 <= results["grade"]["overall"] <= 1.0
    assert results["grade"]["grade"] in {"S", "A", "B", "C", "D", "E"}
    assert {p["id"] for p in results["pillars"]} == {
        "pipeline_health", "stakeholder_relations", "intel_accuracy", "decision_quality"
    }
    # Decision quality saw the PASS rather than defaulting to "nothing recorded".
    decision = next(p for p in results["pillars"] if p["id"] == "decision_quality")
    assert decision["detail"]["counts"]["PASS"] == 1


def test_results_for_a_spiral_run_are_marked_relative(migrated_db):
    """A next iteration must report itself as scored against what it inherited."""
    from mlops_serious_game.application.results_service.service import build_results

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, 1, 1, [10, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.5}})
    _start_run(user_id, 2, seeded_from_run=1)
    _add_challenge(user_id, 2, 2, 2, [20, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.8}})

    results = build_results("alice")

    assert results["run_index"] == 2
    assert results["is_spiral"] is True
    assert results["seeded_from_run"] == 1
    pipeline = next(p for p in results["pillars"] if p["id"] == "pipeline_health")
    assert pipeline["relative"] is True
    # The spiral run sees both runs' challenges, so the metric series covers the chain.
    assert results["metrics"]["challenges"] == 2


def test_a_fresh_start_reports_only_its_own_run(migrated_db):
    from mlops_serious_game.application.results_service.service import build_results

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, 1, 1, [10, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.5}})
    _start_run(user_id, 2, None)
    _add_challenge(user_id, 2, 2, 2, [3, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.9}})

    results = build_results("alice")

    assert results["is_spiral"] is False
    assert results["metrics"]["challenges"] == 1
    model = next(m for m in results["metrics"]["metrics"] if m["id"] == "model")
    assert model["value"] == 3  # run 2's own figure, not run 1's 10


def test_an_earlier_run_can_still_be_read_after_a_new_game(migrated_db):
    """The property the admin drill-down depends on: history stays readable."""
    from mlops_serious_game.application.results_service.service import build_results

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, 1, 1, [42, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.5}})
    _start_run(user_id, 2, None)

    first = build_results("alice", run_index=1)
    model = next(m for m in first["metrics"]["metrics"] if m["id"] == "model")
    assert model["value"] == 42


def test_build_results_rejects_an_unknown_player(migrated_db):
    from mlops_serious_game.application.results_service.service import build_results

    with pytest.raises(ValueError):
        build_results("nobody")


# ── The results cache ────────────────────────────────────────────────────────


def test_results_are_cached_after_the_first_build(migrated_db):
    from mlops_serious_game.application.results_service import service

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, 1, 1, [10, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.5}})

    assert service.load_cached("alice", 1) is None
    first = service.results_for("alice")
    assert service.load_cached("alice", 1) is not None

    # A second read comes off the cache: new rows since then are not picked up without a refresh.
    _add_challenge(user_id, 1, 2, 2, [40, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.9}})
    cached = service.results_for("alice")
    assert cached["metrics"]["challenges"] == first["metrics"]["challenges"] == 1

    refreshed = service.results_for("alice", refresh=True)
    assert refreshed["metrics"]["challenges"] == 2


def test_refreshing_replaces_the_cached_row_rather_than_duplicating_it(migrated_db):
    """The unique (user_id, run_index) constraint means a second write must update, not insert."""
    from sqlalchemy import func
    from mlops_serious_game.application.results_service import service
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameResult

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, 1, 1, [10, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.5}})

    service.results_for("alice")
    service.results_for("alice", refresh=True)

    with get_session() as session:
        rows = session.scalar(
            select(func.count(GameResult.id)).where(GameResult.user_id == user_id)
        )
    assert rows == 1


def test_each_run_caches_its_own_results(migrated_db):
    """A new game must not overwrite the previous run's stored results."""
    from mlops_serious_game.application.results_service import service

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, 1, 1, [42, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.5}})
    service.results_for("alice")

    _start_run(user_id, 2, None)
    _add_challenge(user_id, 2, 2, 2, [7, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.5}})
    service.results_for("alice")

    run_one = service.load_cached("alice", 1)
    run_two = service.load_cached("alice", 2)
    assert next(m for m in run_one["metrics"]["metrics"] if m["id"] == "model")["value"] == 42
    assert next(m for m in run_two["metrics"]["metrics"] if m["id"] == "model")["value"] == 7
