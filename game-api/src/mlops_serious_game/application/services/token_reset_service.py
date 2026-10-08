"""Gives a player back the attention tokens of the challenge they are in (teacher and admin panels)."""
from loguru import logger
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


def player_in_campaigns(email: str, campaign_keys: list[str] | None) -> int | None:
    """The player's id if they belong to one of `campaign_keys` (any campaign when None), else None."""
    with get_session() as session:
        user = session.scalar(select(User).where(User.email == email))
        if user is None or (campaign_keys is not None and user.campaign_key not in campaign_keys):
            return None
        return user.id


async def reset_and_notify(user_id: int, actor: str) -> dict | None:
    """Resets the tokens, logs who did it and tells the player's open game. None when the player is
    not in a challenge."""
    from mlops_serious_game.infrastructure.websocket.manager import manager

    result = reset_current_challenge_tokens(user_id)
    if result is None:
        return None
    logger.info(
        f"{actor} reset the tokens of user {user_id} on challenge {result['challenge_id']}: "
        f"{result['before']} -> {result['after']}"
    )
    # The client sends its own token count with every card play, so without this push it would
    # write the old number straight back.
    online = await manager.send_to_player(
        user_id, "game:tokens_reset", {"challenge_id": result["challenge_id"], "attention_tokens": result["after"]}
    )
    return {"attention_tokens": result["after"], "notified": online > 0}
