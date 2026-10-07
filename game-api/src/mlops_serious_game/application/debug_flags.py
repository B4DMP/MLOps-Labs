"""Debug flags that are on globally (settings) or for one account (`User.debug_flags`)."""
from typing import Optional

from mlops_serious_game.config import settings

# Flag name -> the global setting it overrides per account.
GLOBAL_SETTINGS = {
    "graph": "ENABLE_GRAPH_DEBUG",
    "dossier": "ENABLE_DOSSIER_DEBUG",
    "playtest": "ENABLE_PLAYTEST_TOOLS",
}


def is_enabled(flag: str, user_id: Optional[int] = None) -> bool:
    if getattr(settings, GLOBAL_SETTINGS[flag]):
        return True
    if user_id is None:
        return False
    from mlops_serious_game.infrastructure.database import User, get_session

    with get_session() as session:
        user = session.get(User, user_id)
        return bool(user and (user.debug_flags or {}).get(flag))


def set_flags(email: str, updates: dict[str, bool]) -> bool:
    """Returns False when no such account exists."""
    unknown = set(updates) - set(GLOBAL_SETTINGS)
    if unknown:
        raise ValueError(f"Unknown debug flag(s): {', '.join(sorted(unknown))}")
    from sqlalchemy import select

    from mlops_serious_game.infrastructure.database import User, get_session

    with get_session() as session:
        user = session.scalar(select(User).where(User.email == email))
        if user is None:
            return False
        # Reassign instead of mutating: a plain JSON column does not track in-place changes.
        user.debug_flags = {**(user.debug_flags or {}), **updates}
        return True
