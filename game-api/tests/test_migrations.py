"""Smoke tests for the alembic migration chain (code-review finding: no migration test harness
existed anywhere in the repo).

Runs `alembic upgrade head` then `alembic downgrade base` against a throwaway, uniquely-named
database created and dropped just for this test - never the shared dev database
(`settings.POSTGRES_DB_NAME`). If no postgres is reachable at all (e.g. a bare CI runner with no
`postgres` service), these tests skip rather than fail, so they never turn the otherwise DB-free
backend suite into one that requires infrastructure to run at all.
"""

import uuid
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import create_engine, inspect, text

from mlops_serious_game.config import settings

ALEMBIC_DIR = Path(__file__).resolve().parents[1] / "alembic"
ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def _admin_engine():
    """A connection to the same postgres server's default database, for CREATE/DROP DATABASE
    (which cannot run inside a transaction, hence AUTOCOMMIT)."""
    admin_url = sqlalchemy.engine.make_url(settings.POSTGRES_URI).set(database="postgres")
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _postgres_reachable() -> bool:
    try:
        with _admin_engine().connect():
            return True
    except Exception:
        return False


@pytest.fixture
def throwaway_db(monkeypatch):
    """Creates `test_migrations_<uuid>` on the same postgres server, points `settings.POSTGRES_URI`
    at it for the duration of the test (alembic/env.py reads that setting directly), and drops it
    afterwards - success or failure."""
    if not _postgres_reachable():
        pytest.skip("no postgres reachable - see docker compose up postgres")

    db_name = f"test_migrations_{uuid.uuid4().hex[:12]}"
    admin = _admin_engine()
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    try:
        test_url = sqlalchemy.engine.make_url(settings.POSTGRES_URI).set(database=db_name)
        # str(url) masks the password ("***") by design - must render it explicitly here, or
        # alembic's engine_from_config(...) picks up the literal masked string and every
        # connection attempt fails with a genuine (and misleading) auth error.
        monkeypatch.setattr(settings, "POSTGRES_URI", test_url.render_as_string(hide_password=False))
        yield db_name
    finally:
        with admin.connect() as conn:
            # Terminate anything still connected (a leaked engine from a failed test) before DROP.
            conn.execute(text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :name AND pid <> pg_backend_pid()"
            ), {"name": db_name})
            conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))


def _alembic_config() -> "AlembicConfig":
    from alembic.config import Config as AlembicConfig

    cfg = AlembicConfig(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    return cfg


def test_upgrade_head_then_downgrade_base_round_trips_cleanly(throwaway_db):
    """The whole chain applies forward and back without error against a fresh database - the
    single most valuable migration test: it would have caught a broken down_revision link, a
    syntax error, or a downgrade that doesn't actually undo its upgrade."""
    from alembic import command

    cfg = _alembic_config()
    command.upgrade(cfg, "head")

    engine = create_engine(settings.POSTGRES_URI)
    with engine.connect() as conn:
        tables = set(
            conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
            .scalars()
        )
    assert "graph_op_log" in tables  # e5f6a7b8c9d0 - spot check the chain actually ran to head
    assert "alembic_version" in tables
    engine.dispose()

    command.downgrade(cfg, "base")

    engine = create_engine(settings.POSTGRES_URI)
    with engine.connect() as conn:
        tables = set(
            conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
            .scalars()
        )
    # A full downgrade to base must leave no application tables behind at all (D34: dev data is
    # disposable, downgrades are allowed to be destructive, but must be complete). `intel_data` is
    # now alembic-managed too (b8c9d0e1f2a3), closing the gap this test originally found.
    leftover = tables - {"alembic_version"}
    assert not leftover, f"tables left behind after downgrade to base: {leftover}"
    engine.dispose()


def test_upgrade_head_is_idempotent(throwaway_db):
    """Running `upgrade head` twice in a row (nothing pending the second time) must be a no-op,
    not an error - this is what a redeployed API with AUTO_MIGRATE=True does on every restart."""
    from alembic import command

    cfg = _alembic_config()
    command.upgrade(cfg, "head")
    command.upgrade(cfg, "head")  # must not raise


def test_fk_constraints_exist_at_head(throwaway_db):
    """docs/plans/pk-migration.md: after `enforce_fk_constraints`, every user_id/campaign_id
    column must be NOT NULL, have a real FK with ON DELETE CASCADE, and be indexed."""
    from alembic import command

    cfg = _alembic_config()
    command.upgrade(cfg, "head")

    engine = create_engine(settings.POSTGRES_URI)
    with engine.connect() as conn:
        insp = inspect(conn)

        campaign_cols = {c["name"]: c for c in insp.get_columns("user_data")}
        assert campaign_cols["campaign_id"]["nullable"] is False
        campaign_fks = insp.get_foreign_keys("user_data")
        campaign_fk = next(fk for fk in campaign_fks if fk["constrained_columns"] == ["campaign_id"])
        assert campaign_fk["referred_table"] == "campaign_data"
        assert campaign_fk["options"].get("ondelete", "").upper() == "CASCADE"
        assert any("campaign_id" in ix["column_names"] for ix in insp.get_indexes("user_data"))

        child_tables = [
            "game_progression_data",
            "game_challenge_data",
            "game_session_data",
            "intel_data",
            "graph_op_log",
            "game_event",
        ]
        for table in child_tables:
            cols = {c["name"]: c for c in insp.get_columns(table)}
            assert cols["user_id"]["nullable"] is False, table
            fks = insp.get_foreign_keys(table)
            fk = next(fk for fk in fks if fk["constrained_columns"] == ["user_id"])
            assert fk["referred_table"] == "user_data", table
            assert fk["options"].get("ondelete", "").upper() == "CASCADE", table
            assert any("user_id" in ix["column_names"] for ix in insp.get_indexes(table)), table
    engine.dispose()


def test_orphaned_row_aborts_enforce_fk_constraints(throwaway_db):
    """A row whose legacy string column matches no user must abort the migration rather than be
    silently dropped or left NULL (docs/plans/pk-migration.md: `_assert_no_orphans`)."""
    from alembic import command

    cfg = _alembic_config()
    command.upgrade(cfg, "b3c4d5e6f7a8")

    engine = create_engine(settings.POSTGRES_URI)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO campaign_data (campaign_name, campaign_key) VALUES ('Camp', 'camp-key')"
        ))
        conn.execute(text(
            "INSERT INTO user_data (user_name, campaign_key) VALUES ('valid_user', 'camp-key')"
        ))
        # A valid row: its user_name matches an existing user and must backfill cleanly.
        conn.execute(text(
            "INSERT INTO game_progression_data (user_name, game_progress_index, time_stamp, additional_data) "
            "VALUES ('valid_user', 1, now(), '[]')"
        ))
        # An orphaned row: no user_data row has this user_name.
        conn.execute(text(
            "INSERT INTO game_progression_data (user_name, game_progress_index, time_stamp, additional_data) "
            "VALUES ('ghost_user', 1, now(), '[]')"
        ))
    engine.dispose()

    with pytest.raises(RuntimeError, match="orphaned rows"):
        command.upgrade(cfg, "head")


def test_valid_rows_backfill_correctly(throwaway_db):
    """Rows written by old, string-only app code before `add_numeric_fk_columns` ran must end up
    with the right `user_id`/`campaign_id` once `enforce_fk_constraints` lands."""
    from alembic import command

    cfg = _alembic_config()
    command.upgrade(cfg, "b3c4d5e6f7a8")

    engine = create_engine(settings.POSTGRES_URI)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO campaign_data (campaign_name, campaign_key) VALUES ('Camp', 'camp-key')"
        ))
        conn.execute(text(
            "INSERT INTO user_data (user_name, campaign_key) VALUES ('valid_user', 'camp-key')"
        ))
        conn.execute(text(
            "INSERT INTO game_progression_data (user_name, game_progress_index, time_stamp, additional_data) "
            "VALUES ('valid_user', 1, now(), '[]')"
        ))

    # Stop at enforce_fk_constraints, the revision this test actually exercises - a later
    # revision (a1c2e3f4b5d6, password-auth) intentionally wipes user_data, which would make
    # 'valid_user' disappear before the assertions below run.
    command.upgrade(cfg, "c4d5e6f7a8b9")

    with engine.connect() as conn:
        user_id, campaign_id = conn.execute(
            text("SELECT id, campaign_id FROM user_data WHERE user_name = 'valid_user'")
        ).one()
        expected_campaign_id = conn.execute(
            text("SELECT id FROM campaign_data WHERE campaign_key = 'camp-key'")
        ).scalar_one()
        assert campaign_id == expected_campaign_id

        prog_user_id = conn.execute(
            text("SELECT user_id FROM game_progression_data WHERE user_name = 'valid_user'")
        ).scalar_one()
        assert prog_user_id == user_id
    engine.dispose()


def test_upgrade_head_from_a_database_migrated_on_main(throwaway_db):
    """main's add_campaign_attributes shipped as `e5f6a7b8c9d0`, the id graph-redesign uses for
    add_graph_op_log. A database migrated on main is stamped `e5f6a7b8c9d0` with the campaign
    columns but no graph_op_log; alembic/env.py must notice and upgrade it without a manual stamp."""
    from alembic import command
    from alembic.script import ScriptDirectory

    cfg = _alembic_config()
    command.upgrade(cfg, "d4e5f6a7b8c9")
    engine = create_engine(settings.POSTGRES_URI)
    with engine.begin() as conn:
        # What main's version of e5f6a7b8c9d0 did.
        conn.execute(text(
            "ALTER TABLE campaign_data "
            "ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE, "
            "ADD COLUMN IF NOT EXISTS use_questionnaire BOOLEAN NOT NULL DEFAULT TRUE"
        ))
        conn.execute(text("UPDATE alembic_version SET version_num = 'e5f6a7b8c9d0'"))

    command.upgrade(cfg, "head")

    with engine.connect() as conn:
        tables = set(inspect(conn).get_table_names())
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    engine.dispose()
    assert "graph_op_log" in tables
    # Read head from the script directory rather than pinning a literal: what this test is about
    # is that the upgrade runs at all from main's stamp, not which revision happens to be last.
    assert version == ScriptDirectory.from_config(cfg).get_current_head()
