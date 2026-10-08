"""Gives a player back the attention tokens of the challenge they are in (teacher panel)."""
from sqlalchemy import select

from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.infrastructure.database import GameChallenge, GameProgression, User, get_session
from mlops_serious_game.infrastructure.database.run_scope import current_run_index

IN_CHALLENGE = 2


def reset_current_challenge_tokens(user_id: int) -> dict | None:
    """Sets the current challenge's tokens back to its budget and nothing else: played cards,
    intel and the pitch stay as they are. Returns None when the player is not in a challenge."""
    with get_session() as session:
        run_index = current_run_index(session, user_id)
        progress = session.scalar(
            select(GameProgression.game_progress_index)
            .where(GameProgression.user_id == user_id, GameProgression.run_index == run_index)
            .order_by(GameProgression.id.desc())
        )
        row = session.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id, GameChallenge.run_index == run_index)
            .order_by(GameChallenge.id.desc())
        ).first()
        if progress != IN_CHALLENGE or row is None:
            return None
        challenge = PhaseFactory.translate_challenge_index(
            challenge_index=row.challenge_index, phase_index=row.phase_index
        )
        before = row.attention_tokens
        row.attention_tokens = challenge.attention_tokens
        return {"challenge_id": challenge.id, "before": before, "after": challenge.attention_tokens}


def player_in_campaigns(email: str, campaign_keys: list[str]) -> int | None:
    """The player's id if they belong to one of `campaign_keys`, else None."""
    with get_session() as session:
        user = session.scalar(select(User).where(User.email == email))
        return user.id if user is not None and user.campaign_key in campaign_keys else None
