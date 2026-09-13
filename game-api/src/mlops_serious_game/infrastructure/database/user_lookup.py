from sqlalchemy import select
from sqlalchemy.orm import Session

from mlops_serious_game.infrastructure.database.models import User


def get_user_id(session: Session, username: str) -> int | None:
    """Resolves a `User.id` from a username, for call sites that only have the username in
    scope. Prefer reusing an already-fetched `User.id` when one is already in scope instead of
    calling this (see docs/plans/pk-migration.md)."""
    return session.scalar(select(User.id).where(User.user_name == username))
