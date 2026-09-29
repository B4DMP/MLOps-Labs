"""Tests for the LangGraph thread-id rekey migration and the construction sites that build
those ids (docs/plans/session-persistence-and-url-routing.md, D-user-id).

Reuses test_migrations.py's `throwaway_db` fixture/pattern: never touches the shared dev
database, skips if no postgres is reachable at all.
"""

import uuid

import pytest
from sqlalchemy import create_engine, text

from mlops_serious_game.config import settings
from test_migrations import _alembic_config, throwaway_db  # noqa: F401 (fixture import)

_CHECKPOINT_TABLE_DDL = {
    "checkpoints": """
        CREATE TABLE checkpoints (
            thread_id text NOT NULL,
            checkpoint_ns text NOT NULL DEFAULT '',
            checkpoint_id text NOT NULL,
            parent_checkpoint_id text,
            type text,
            checkpoint jsonb NOT NULL,
            metadata jsonb NOT NULL DEFAULT '{}',
            PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
        )
    """,
    "checkpoint_writes": """
        CREATE TABLE checkpoint_writes (
            thread_id text NOT NULL,
            checkpoint_ns text NOT NULL DEFAULT '',
            checkpoint_id text NOT NULL,
            task_id text NOT NULL,
            idx integer NOT NULL,
            channel text NOT NULL,
            type text,
            blob bytea NOT NULL,
            task_path text NOT NULL DEFAULT '',
            PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
        )
    """,
    "checkpoint_blobs": """
        CREATE TABLE checkpoint_blobs (
            thread_id text NOT NULL,
            checkpoint_ns text NOT NULL DEFAULT '',
            channel text NOT NULL,
            version text NOT NULL,
            type text NOT NULL,
            blob bytea,
            PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
        )
    """,
}


def _seed_checkpoint_row(conn, table: str, thread_id: str, suffix: str) -> None:
    if table == "checkpoints":
        conn.execute(text(
            "INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata) "
            "VALUES (:tid, '', :cid, '{}', '{}')"
        ), {"tid": thread_id, "cid": f"cp_{suffix}"})
    elif table == "checkpoint_writes":
        conn.execute(text(
            "INSERT INTO checkpoint_writes "
            "(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, blob) "
            "VALUES (:tid, '', :cid, 'task', 0, 'chan', '\\x00')"
        ), {"tid": thread_id, "cid": f"cp_{suffix}"})
    else:
        conn.execute(text(
            "INSERT INTO checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type) "
            "VALUES (:tid, '', 'chan', '1', 'text')"
        ), {"tid": thread_id})


@pytest.fixture
def seeded_pre_rekey_db(throwaway_db):
    """Upgrades to the revision right before the rekey, inserts a real user plus checkpoint
    tables seeded with old, username-based thread_ids in all three shapes (exact, and the
    variable-suffix pitch/veto form)."""
    from alembic import command

    cfg = _alembic_config()
    command.upgrade(cfg, "c5d6e7f8a9b0")  # the rekey migration's down_revision

    engine = create_engine(settings.POSTGRES_URI)
    username = f"rekey_test_{uuid.uuid4().hex[:8]}"
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO campaign_data (campaign_name, campaign_key) VALUES ('Camp', 'camp-key')"
        ))
        conn.execute(text(
            "INSERT INTO user_data (user_name, campaign_key, campaign_id, email, password_hash, "
            "users_on_machine, is_verified) "
            "VALUES (:u, 'camp-key', (SELECT id FROM campaign_data WHERE campaign_key = 'camp-key'), "
            ":email, 'hash', 1, true)"
        ), {"u": username, "email": f"{username}@example.test"})
        user_id = conn.execute(
            text("SELECT id FROM user_data WHERE user_name = :u"), {"u": username}
        ).scalar_one()

        for table, ddl in _CHECKPOINT_TABLE_DDL.items():
            conn.execute(text(ddl))

        old_thread_ids = {
            "checkpoints": [
                f"MLOps_Convo_{username}",
                f"Online_Intel_{username}",
                f"Action_Card_Pitch_{username}_0_1_1",
                f"Action_Card_Veto_{username}_0_1_data_dave",
            ],
        }
        for table in _CHECKPOINT_TABLE_DDL:
            for i, thread_id in enumerate(old_thread_ids["checkpoints"]):
                _seed_checkpoint_row(conn, table, thread_id, str(i))

    engine.dispose()
    return username, user_id


def test_rekey_migration_renames_all_thread_shapes(seeded_pre_rekey_db):
    username, user_id = seeded_pre_rekey_db
    from alembic import command

    command.upgrade(_alembic_config(), "head")

    engine = create_engine(settings.POSTGRES_URI)
    with engine.connect() as conn:
        for table in _CHECKPOINT_TABLE_DDL:
            thread_ids = set(
                conn.execute(text(f"SELECT DISTINCT thread_id FROM {table}")).scalars()
            )
            assert thread_ids == {
                f"MLOps_Convo_{user_id}",
                f"Online_Intel_{user_id}",
                f"Action_Card_Pitch_{user_id}_0_1_1",
                f"Action_Card_Veto_{user_id}_0_1_data_dave",
            }, f"{table} not fully rekeyed: {thread_ids}"
    engine.dispose()


def test_rekey_migration_is_idempotent(seeded_pre_rekey_db):
    from alembic import command

    cfg = _alembic_config()
    command.upgrade(cfg, "head")
    command.upgrade(cfg, "head")  # already at head - must not raise or double-rename


def test_rekey_migration_downgrade_restores_usernames(seeded_pre_rekey_db):
    username, user_id = seeded_pre_rekey_db
    from alembic import command

    cfg = _alembic_config()
    # Stops at the rekey itself: a later revision drops `user_name`, so a downgrade through it
    # could not bring the real usernames back.
    command.upgrade(cfg, "d7e8f9a0b1c2")
    command.downgrade(cfg, "c5d6e7f8a9b0")

    engine = create_engine(settings.POSTGRES_URI)
    with engine.connect() as conn:
        thread_ids = set(
            conn.execute(text("SELECT DISTINCT thread_id FROM checkpoints")).scalars()
        )
        assert thread_ids == {
            f"MLOps_Convo_{username}",
            f"Online_Intel_{username}",
            f"Action_Card_Pitch_{username}_0_1_1",
            f"Action_Card_Veto_{username}_0_1_data_dave",
        }
    engine.dispose()
