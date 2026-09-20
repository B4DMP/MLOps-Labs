"""Integration tests for admin_service.py's player/campaign deletion paths, against a real
throwaway Postgres database migrated to head (docs/plans/pk-migration.md).

`remove_campaign` used to hand-maintain a list of per-table deletes and had a real gap: it never
touched GraphOpLog, GameEventRow, or the checkpoint tables, unlike remove_player. Once the schema
has real `user_id` FKs with ON DELETE CASCADE, `_cleanup_and_delete_user` collapses all three
delete paths through the same cascade, so this gap structurally can't recur. These tests assert
zero rows remain in every child table (including checkpoints) after each delete path.
"""

import uuid

import pytest
import sqlalchemy
from sqlalchemy import create_engine, text

from mlops_serious_game.config import settings

ALEMBIC_DIR_NAME = "alembic"

CHECKPOINT_TABLES = ("checkpoints", "checkpoint_writes", "checkpoint_blobs")


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
    """Creates a throwaway DB, migrates it to head, and creates minimal stand-in checkpoint
    tables (the real ones are set up by LangGraph's checkpointer at startup, not by alembic -
    see connection.py:init_checkpointer).

    `connection.engine`/`connection.SessionLocal` (what `get_session()` - and so every
    application-code call site under test - actually uses) are created once at import time and
    never re-read `settings.POSTGRES_URI` afterwards, so monkeypatching the setting alone would
    leave `get_session()` pointed at whatever database was live at import time. Rebinding
    `connection.engine`/`connection.SessionLocal` directly (like `admin_engine`/`engine` below,
    just via monkeypatch instead of a fresh module) is what actually redirects it.
    """
    if not _postgres_reachable():
        pytest.skip("no postgres reachable - see docker compose up postgres")

    from pathlib import Path
    from alembic import command
    from alembic.config import Config as AlembicConfig
    from sqlalchemy.orm import sessionmaker
    from mlops_serious_game.infrastructure.database import connection as db_connection

    db_name = f"test_admin_service_{uuid.uuid4().hex[:12]}"
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
        with engine.begin() as conn:
            for table in CHECKPOINT_TABLES:
                conn.execute(text(f"CREATE TABLE {table} (thread_id TEXT NOT NULL)"))

        monkeypatch.setattr(db_connection, "engine", engine)
        monkeypatch.setattr(db_connection, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))

        yield db_name
        engine.dispose()
    finally:
        with admin.connect() as conn:
            conn.execute(text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :name AND pid <> pg_backend_pid()"
            ), {"name": db_name})
            conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))


def _seed_player(session, *, username: str, campaign_key: str) -> "User":
    from mlops_serious_game.infrastructure.database.models import (
        Campaign, User, GameProgression, GameChallenge, GameSession, IntelItem,
        GraphOpLog, GameEventRow, UserSettings,
    )
    import datetime

    campaign = session.scalar(sqlalchemy.select(Campaign).where(Campaign.campaign_key == campaign_key))
    if campaign is None:
        campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key)
        session.add(campaign)
        session.flush()

    user = User(user_name=username, campaign_key=campaign_key, campaign_id=campaign.id)
    session.add(user)
    session.flush()

    session.add(GameProgression(
        user_name=username, user_id=user.id, game_progress_index=1,
        time_stamp=datetime.datetime.utcnow(), additional_data=[],
    ))
    session.add(GameChallenge(
        user_name=username, user_id=user.id, phase_index=0, challenge_index=0,
        challenge_loop_index=0, action_card={}, metric_values=[],
        time_stamp=datetime.datetime.utcnow(), messages=[],
        attention_tokens=20, emotion_values={},
    ))
    session.add(GameSession(player=username, user_id=user.id, stakeholder_personas={}))
    session.add(IntelItem(user_name=username, user_id=user.id, intel_item_data={}))
    session.add(GraphOpLog(
        user_name=username, user_id=user.id, seq=1, phase_index=0,
        challenge_template="t", source_kind="challenge_seed", ops=[],
    ))
    session.add(GameEventRow(
        user_name=username, user_id=user.id, seq=1, phase_id=0, challenge_id=0,
        step="offline", kind="intel", direction="none", cause="intel.artifact_filed",
    ))
    session.add(UserSettings(user_name=username, user_id=user.id, mute_tts=True))
    for thread_id in (f"MLOps_Convo_{username}", f"Online_Intel_{username}"):
        session.execute(
            sqlalchemy.text("INSERT INTO checkpoints (thread_id) VALUES (:t)"), {"t": thread_id}
        )
        session.execute(
            sqlalchemy.text("INSERT INTO checkpoint_writes (thread_id) VALUES (:t)"), {"t": thread_id}
        )
        session.execute(
            sqlalchemy.text("INSERT INTO checkpoint_blobs (thread_id) VALUES (:t)"), {"t": thread_id}
        )
    session.flush()
    return user


def _row_counts(session, username: str) -> dict[str, int]:
    from mlops_serious_game.infrastructure.database.models import (
        GameProgression, GameChallenge, GameSession, IntelItem, GraphOpLog, GameEventRow,
        UserSettings,
    )

    counts = {
        "GameProgression": session.scalar(
            sqlalchemy.select(sqlalchemy.func.count()).select_from(GameProgression)
            .where(GameProgression.user_name == username)
        ),
        "GameChallenge": session.scalar(
            sqlalchemy.select(sqlalchemy.func.count()).select_from(GameChallenge)
            .where(GameChallenge.user_name == username)
        ),
        "GameSession": session.scalar(
            sqlalchemy.select(sqlalchemy.func.count()).select_from(GameSession)
            .where(GameSession.player == username)
        ),
        "IntelItem": session.scalar(
            sqlalchemy.select(sqlalchemy.func.count()).select_from(IntelItem)
            .where(IntelItem.user_name == username)
        ),
        "GraphOpLog": session.scalar(
            sqlalchemy.select(sqlalchemy.func.count()).select_from(GraphOpLog)
            .where(GraphOpLog.user_name == username)
        ),
        "GameEventRow": session.scalar(
            sqlalchemy.select(sqlalchemy.func.count()).select_from(GameEventRow)
            .where(GameEventRow.user_name == username)
        ),
        "UserSettings": session.scalar(
            sqlalchemy.select(sqlalchemy.func.count()).select_from(UserSettings)
            .where(UserSettings.user_name == username)
        ),
    }
    for table in CHECKPOINT_TABLES:
        for thread_id in (f"MLOps_Convo_{username}", f"Online_Intel_{username}"):
            key = f"{table}:{thread_id}"
            counts[key] = session.execute(
                sqlalchemy.text(f"SELECT count(*) FROM {table} WHERE thread_id = :t"), {"t": thread_id}
            ).scalar()
    return counts


def test_remove_player_clears_every_table(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.application.services import admin_service

    with get_session() as session:
        _seed_player(session, username="alice", campaign_key="camp-1")

    with get_session() as session:
        before = _row_counts(session, "alice")
    assert all(v > 0 for v in before.values()), before

    admin_service.remove_player("alice")

    with get_session() as session:
        after = _row_counts(session, "alice")
    assert all(v == 0 for v in after.values()), after


def test_remove_all_players_clears_every_table(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.application.services import admin_service

    with get_session() as session:
        _seed_player(session, username="bob", campaign_key="camp-1")
        _seed_player(session, username="carol", campaign_key="camp-2")

    admin_service.remove_all_players()

    with get_session() as session:
        after_bob = _row_counts(session, "bob")
        after_carol = _row_counts(session, "carol")
    assert all(v == 0 for v in after_bob.values()), after_bob
    assert all(v == 0 for v in after_carol.values()), after_carol


def test_remove_campaign_clears_every_table_for_every_user(migrated_db):
    """The gap this migration closes: remove_campaign used to skip GraphOpLog, GameEventRow, and
    the checkpoint tables entirely."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.application.services import admin_service

    with get_session() as session:
        _seed_player(session, username="dave", campaign_key="camp-multi")
        _seed_player(session, username="erin", campaign_key="camp-multi")
        _seed_player(session, username="frank", campaign_key="camp-other")

    admin_service.remove_campaign("camp-multi")

    with get_session() as session:
        after_dave = _row_counts(session, "dave")
        after_erin = _row_counts(session, "erin")
        after_frank = _row_counts(session, "frank")

    assert all(v == 0 for v in after_dave.values()), after_dave
    assert all(v == 0 for v in after_erin.values()), after_erin
    # A different campaign's player must be untouched.
    assert all(v > 0 for v in after_frank.values()), after_frank

    from mlops_serious_game.infrastructure.database.models import Campaign
    with get_session() as session:
        assert session.scalar(
            sqlalchemy.select(Campaign).where(Campaign.campaign_key == "camp-multi")
        ) is None


@pytest.fixture
def sqlite_db(monkeypatch):
    from sqlalchemy.pool import StaticPool
    from sqlalchemy.orm import sessionmaker
    from mlops_serious_game.infrastructure.database import connection as db_connection
    from mlops_serious_game.infrastructure.database.models import Base

    sqlite_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=sqlite_engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=sqlite_engine)
    monkeypatch.setattr(db_connection, "engine", sqlite_engine)
    monkeypatch.setattr(db_connection, "SessionLocal", session_factory)
    yield
    sqlite_engine.dispose()


def test_calculate_metric_sum_per_challenge_uses_played_order(sqlite_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign, User, GameChallenge
    from mlops_serious_game.application.services import admin_service
    import datetime

    with get_session() as session:
        c1 = Campaign(campaign_name="camp-alpha", campaign_key="camp-alpha")
        c2 = Campaign(campaign_name="camp-beta", campaign_key="camp-beta")
        session.add_all([c1, c2])
        session.flush()

        u1 = User(user_name="user1", campaign_key="camp-alpha", campaign_id=c1.id)
        u2 = User(user_name="user2", campaign_key="camp-beta", campaign_id=c2.id)
        session.add_all([u1, u2])
        session.flush()

        now = datetime.datetime.utcnow()
        # Intro challenge for user1 (phase_index=0) should be ignored
        session.add(GameChallenge(
            user_name="user1", user_id=u1.id, phase_index=0, challenge_index=0,
            challenge_loop_index=0, action_card={}, metric_values=[],
            time_stamp=now, messages=[],
            attention_tokens=20, emotion_values={},
        ))

        # user1 plays challenge 100 (has an initial loop 0 record, then a loop 3 record)
        session.add(GameChallenge(
            user_name="user1", user_id=u1.id, phase_index=1, challenge_index=100,
            challenge_loop_index=0, action_card={}, metric_values=[10, 10, 10, 10, 10, 10],
            time_stamp=now, messages=[],
            attention_tokens=20, emotion_values={},
        ))
        session.add(GameChallenge(
            user_name="user1", user_id=u1.id, phase_index=1, challenge_index=100,
            challenge_loop_index=3, action_card={}, metric_values=[10, 10, 10, 10, 10, 12],
            time_stamp=now, messages=[],
            attention_tokens=20, emotion_values={},
        ))
        session.add(GameChallenge(
            user_name="user1", user_id=u1.id, phase_index=2, challenge_index=105,
            challenge_loop_index=3, action_card={}, metric_values=[11, 10, 10, 10, 10, 13],
            time_stamp=now, messages=[],
            attention_tokens=20, emotion_values={},
        ))

        # user2 plays challenge 101 first, challenge 102 second, challenge 104 third
        session.add(GameChallenge(
            user_name="user2", user_id=u2.id, phase_index=1, challenge_index=101,
            challenge_loop_index=3, action_card={}, metric_values=[10, 10, 10, 10, 10, 10],
            time_stamp=now, messages=[],
            attention_tokens=20, emotion_values={},
        ))
        session.add(GameChallenge(
            user_name="user2", user_id=u2.id, phase_index=2, challenge_index=102,
            challenge_loop_index=3, action_card={}, metric_values=[11, 10, 10, 10, 10, 11],
            time_stamp=now, messages=[],
            attention_tokens=20, emotion_values={},
        ))
        session.add(GameChallenge(
            user_name="user2", user_id=u2.id, phase_index=3, challenge_index=104,
            challenge_loop_index=3, action_card={}, metric_values=[12, 10, 10, 10, 10, 14],
            time_stamp=now, messages=[],
            attention_tokens=20, emotion_values={},
        ))
        session.commit()

    # Global aggregate
    sums = admin_service.calculate_metric_sum_per_challenge()
    assert len(sums) >= 5
    assert sums[0] == 61.0  # (62.0 + 60.0) / 2
    assert sums[1] == 63.0  # (64.0 + 62.0) / 2
    assert sums[2] == 66.0  # 66.0 / 1
    assert sums[3] == 0.0
    assert sums[4] == 0.0

    increases = admin_service.calculate_metric_sum_per_challenge_increase(sums)
    assert len(increases) == len(sums)
    assert increases[0] == 1.0  # 61.0 - 60.0
    assert increases[1] == 2.0  # 63.0 - 61.0
    assert increases[2] == 3.0  # 66.0 - 63.0
    assert increases[3] == 0.0
    assert increases[4] == 0.0

    # Filtered by campaign
    alpha_sums = admin_service.calculate_metric_sum_per_challenge(campaign_key="camp-alpha")
    assert alpha_sums[0] == 62.0
    assert alpha_sums[1] == 64.0
    assert alpha_sums[2] == 0.0

