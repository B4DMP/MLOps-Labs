"""Rekey LangGraph checkpoint thread_ids from username to user_id
(docs/plans/session-persistence-and-url-routing.md, D-user-id).

The checkpoint tables (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`) aren't ORM-mapped
and can't hold a real FK (docs/done/pk-migration.md scoped that out deliberately), so they were
left keyed by the one thing that, until this plan, was guaranteed never to change: the username.
Introducing a username-change feature turns that into an active bug - renaming a player would
silently orphan their conversation history under the old key. This migration renames every
existing thread_id from its username-based form to the equivalent user_id-based form, matching
the corresponding change to the six construction call sites
(chat_handler.py, router.py, game_handler.py, intel_handler.py, online_intel_service/service.py,
action_card_pitch_service/service.py, action_card_veto_service/service.py) and the two admin
cleanup helpers in admin_service.py.

Two shapes of thread_id need different handling:
- Exact form (`MLOps_Convo_{username}`, `Online_Intel_{username}`): a direct old-value ->
  new-value rename.
- Prefixed form (`Action_Card_Pitch_{username}_{phase_id}_{challenge_id}_{pitch_attempt}`,
  `Action_Card_Veto_{username}_{phase_id}_{challenge_id}_{stakeholder_id}`): only the username
  segment changes, the rest of the id must be preserved verbatim. Usernames can themselves contain
  underscores, so this can't be done safely with a wildcard LIKE/split - instead every existing
  thread_id is pulled into Python and matched by an exact `str.startswith` against a prefix built
  from each user's real username, so there is no ambiguity about where the username ends.

Idempotent: safe to run again (already-renamed rows simply won't match any old-form prefix a
second time), and skips tables that don't exist yet (checkpoint tables are created by the
LangGraph checkpointer on first use, not by earlier migrations).

Revision ID: d7e8f9a0b1c2
Revises: c5d6e7f8a9b0
Create Date: 2026-09-23 00:00:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd7e8f9a0b1c2'
down_revision: Union[str, None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USER_TABLE = os.getenv("POSTGRES_USER_DATA_TABLE", "user_data")
CHECKPOINT_TABLES = ("checkpoints", "checkpoint_writes", "checkpoint_blobs")

_EXACT_PREFIXES = ("MLOps_Convo_", "Online_Intel_")
_VARIABLE_PREFIXES = ("Action_Card_Pitch_", "Action_Card_Veto_")


def _rekey(conn, *, by_username: bool) -> None:
    """by_username=True renames username -> user_id (upgrade); False reverses it (downgrade)."""
    from sqlalchemy import text

    users = conn.execute(text(f"SELECT id, user_name FROM {USER_TABLE}")).fetchall()

    for table in CHECKPOINT_TABLES:
        if conn.execute(text(f"SELECT to_regclass('{table}')")).scalar() is None:
            continue

        existing_ids = [
            row[0] for row in conn.execute(text(f"SELECT DISTINCT thread_id FROM {table}")).fetchall()
        ]

        for user_id, username in users:
            from_key, to_key = (username, str(user_id)) if by_username else (str(user_id), username)

            for prefix in _EXACT_PREFIXES:
                old = f"{prefix}{from_key}"
                new = f"{prefix}{to_key}"
                if old in existing_ids and old != new:
                    conn.execute(
                        text(f"UPDATE {table} SET thread_id = :new WHERE thread_id = :old"),
                        {"new": new, "old": old},
                    )

            for prefix in _VARIABLE_PREFIXES:
                old_prefix = f"{prefix}{from_key}_"
                new_prefix = f"{prefix}{to_key}_"
                for thread_id in existing_ids:
                    if thread_id.startswith(old_prefix):
                        new_thread_id = new_prefix + thread_id[len(old_prefix):]
                        conn.execute(
                            text(f"UPDATE {table} SET thread_id = :new WHERE thread_id = :old"),
                            {"new": new_thread_id, "old": thread_id},
                        )


def upgrade() -> None:
    conn = op.get_bind()
    _rekey(conn, by_username=True)


def downgrade() -> None:
    conn = op.get_bind()
    _rekey(conn, by_username=False)
