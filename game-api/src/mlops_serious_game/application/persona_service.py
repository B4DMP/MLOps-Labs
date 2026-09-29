"""Deals and remembers each player's stakeholder personas.

The draw happens once, when a player's session record is created, and is stored
on that record so the same cast greets them for the rest of the game. This
module is the only place that knows both the persona config and the database;
the domain layer just reads whatever map is put into its context.
"""

from typing import Optional

from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.domain.persona_resolver import PersonaMap
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


def sync_personas(user_id: int, session_rec) -> dict[str, str]:
    """Ensures `session_rec` holds a full persona draw for `user_id`.

    Back-fills stakeholders added since the record was written without
    disturbing the personas already in play. Callers commit the surrounding
    session; the flag_modified is what makes the JSON column notice the change.
    """
    existing = dict(session_rec.stakeholder_personas or {})
    chosen = StakeholderFactory.choose_personas(user_id, existing)
    if chosen != existing:
        session_rec.stakeholder_personas = chosen
        flag_modified(session_rec, "stakeholder_personas")
    return chosen


def load_personas_for_player(user_id: int) -> PersonaMap:
    """The persona map to serve `user_id` with, creating their session if needed."""
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import (
        get_or_create_game_session,
    )
    from mlops_serious_game.infrastructure.database import get_session

    with get_session() as db_session:
        session_rec = get_or_create_game_session(user_id, db_session)
        chosen = sync_personas(user_id, session_rec)
        db_session.commit()

    return StakeholderFactory.resolve_personas(chosen)


def personas_or_default(user_id: int | None) -> PersonaMap:
    """Same as `load_personas_for_player`, but never raises.

    A player whose personas cannot be loaded still gets a playable game, just
    with the canonical cast, so a database hiccup does not close the socket.
    """
    if not user_id:
        return {}
    try:
        return load_personas_for_player(user_id)
    except Exception as exc:  # noqa: BLE001 - degrade to canonical names
        print(f"[Persona] Falling back to canonical names for user {user_id}: {exc}")
        return {}
