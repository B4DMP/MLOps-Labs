"""Tests for the per-player settings profile (docs/plans/player-settings-and-tts.md).

Runs against a real throwaway Postgres database migrated to head, the same way
test_admin_service.py does: the FK to `user_data` and its ON DELETE CASCADE are half the design
here, and neither exists on a SQLite stand-in built from the models.
"""

import uuid

import pytest
import sqlalchemy
from sqlalchemy import create_engine, text

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
    """A throwaway database migrated to head, with `get_session()` redirected at it.

    `connection.engine` / `connection.SessionLocal` are bound at import time, so rebinding them
    is what actually redirects application code - see the longer note in test_admin_service.py.
    """
    if not _postgres_reachable():
        pytest.skip("no postgres reachable - see docker compose up postgres")

    from pathlib import Path
    from alembic import command
    from alembic.config import Config as AlembicConfig
    from sqlalchemy.orm import sessionmaker
    from mlops_serious_game.infrastructure.database import connection as db_connection

    db_name = f"test_user_settings_{uuid.uuid4().hex[:12]}"
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


def _seed_user(username: str = "alice", campaign_key: str = "camp-1") -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign, User

    with get_session() as session:
        campaign = session.scalar(
            sqlalchemy.select(Campaign).where(Campaign.campaign_key == campaign_key)
        )
        if campaign is None:
            campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key)
            session.add(campaign)
            session.flush()
        session.add(User(user_name=username, campaign_key=campaign_key, campaign_id=campaign.id))


def _row_count(username: str) -> int:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import UserSettings

    with get_session() as session:
        return session.scalar(
            sqlalchemy.select(sqlalchemy.func.count())
            .select_from(UserSettings)
            .where(UserSettings.user_name == username)
        )


# ---------- reads ----------

def test_get_settings_returns_defaults_and_writes_nothing(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()

    assert svc.get_settings("alice") == svc.DEFAULT_SETTINGS
    # A player who never opened the panel must not get a row just for being asked about.
    assert _row_count("alice") == 0


def test_get_settings_for_an_unknown_user_returns_defaults(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    assert svc.get_settings("nobody") == svc.DEFAULT_SETTINGS


# ---------- writes ----------

def test_update_creates_the_row_and_round_trips(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()

    result = svc.update_settings("alice", {"mute_tts": True, "voice_female": "Microsoft Zira"})

    assert result["mute_tts"] is True
    assert result["voice_female"] == "Microsoft Zira"
    assert _row_count("alice") == 1
    assert svc.get_settings("alice") == result


def test_partial_update_leaves_other_fields_alone(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()
    svc.update_settings(
        "alice",
        {"mute_tts": True, "auto_skip_conversations": True, "voice_male": "Microsoft David"},
    )

    result = svc.update_settings("alice", {"mute_tts": False})

    assert result["mute_tts"] is False
    assert result["auto_skip_conversations"] is True
    assert result["voice_male"] == "Microsoft David"


def test_update_for_an_unknown_user_is_a_no_op(migrated_db):
    """The FK needs a real user. A frame naming a deleted or reset account should not raise on
    what is only a preference."""
    from mlops_serious_game.application.services import user_settings_service as svc

    assert svc.update_settings("nobody", {"mute_tts": True}) == svc.DEFAULT_SETTINGS
    assert _row_count("nobody") == 0


def test_all_four_voice_slots_persist(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()

    result = svc.update_settings(
        "alice",
        {
            "voice_male": "Microsoft David",
            "voice_female": "Samantha",
            "voice_narrator": "Microsoft Guy",
            "voice_player": "Alex",
        },
    )

    assert result["voice_male"] == "Microsoft David"
    assert result["voice_female"] == "Samantha"
    assert result["voice_narrator"] == "Microsoft Guy"
    assert result["voice_player"] == "Alex"


def test_a_null_voice_clears_the_stored_choice(migrated_db):
    """Explicit null is how the client says "go back to matching a voice automatically"."""
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()
    svc.update_settings("alice", {"voice_male": "Microsoft David"})

    assert svc.update_settings("alice", {"voice_male": None})["voice_male"] is None


# ---------- payload sanitation ----------

def test_unknown_and_wrongly_typed_fields_are_dropped(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()
    svc.update_settings("alice", {"mute_tts": True})

    result = svc.update_settings(
        "alice",
        {
            "is_admin": True,                 # not ours to set
            "user_id": 99,                    # not ours to set
            "mute_tts": "yes",                # a string is not a bool
            "voice_male": 42,                 # a voice name is a string
            "voice_female": "  Samantha  ",   # trimmed, not rejected
        },
    )

    assert result["mute_tts"] is True         # unchanged, the string was dropped
    assert result["voice_male"] is None
    assert result["voice_female"] == "Samantha"
    assert "is_admin" not in result and "user_id" not in result


def test_an_overlong_voice_name_is_dropped(migrated_db):
    """The column is VARCHAR(255). Refusing here beats a database error on insert."""
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()

    result = svc.update_settings("alice", {"voice_narrator": "x" * 256})

    assert result["voice_narrator"] is None


def test_sanitize_settings_needs_no_database():
    from mlops_serious_game.application.services import user_settings_service as svc

    assert svc.sanitize_settings({"mute_tts": True, "nope": 1}) == {"mute_tts": True}
    assert svc.sanitize_settings({"voice_male": ""}) == {}
    assert svc.sanitize_settings({}) == {}


# ---------- deletion ----------

def test_delete_settings_removes_the_row(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()
    svc.update_settings("alice", {"mute_tts": True})

    svc.delete_settings("alice")

    assert _row_count("alice") == 0
    assert svc.get_settings("alice") == svc.DEFAULT_SETTINGS


def test_delete_settings_for_a_player_without_a_row_is_a_no_op(migrated_db):
    from mlops_serious_game.application.services import user_settings_service as svc

    _seed_user()
    svc.delete_settings("alice")  # must not raise


def test_settings_go_with_the_user_on_delete(migrated_db):
    """The cascade the account reset in step 4 relies on: settings are not a survivor."""
    from mlops_serious_game.application.services import user_settings_service as svc
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import User

    _seed_user()
    svc.update_settings("alice", {"mute_tts": True})

    with get_session() as session:
        session.delete(session.scalar(sqlalchemy.select(User).where(User.user_name == "alice")))

    assert _row_count("alice") == 0
