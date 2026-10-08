"""Teacher token reset: refills only the current challenge's tokens, only for the teacher's own players."""
import pytest
from sqlalchemy import select

from mlops_serious_game.application.services.token_reset_service import (
    player_in_campaigns,
    reset_current_challenge_tokens,
)
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import GameChallenge, GameProgression

from test_run_scope import _seed_user, _start_run, _uid, migrated_db  # noqa: F401  (fixture used by name)


def _challenge_row(user_id: int, tokens: int, action_card: dict) -> None:
    with get_session() as session:
        session.add(GameChallenge(
            user_id=user_id, run_index=1, phase_index=1, challenge_index=0, challenge_loop_index=0,
            action_card=action_card, metric_values=[], messages=[], attention_tokens=tokens, emotion_values={},
        ))


def _tokens(user_id: int) -> int:
    with get_session() as session:
        return session.scalars(
            select(GameChallenge.attention_tokens).where(GameChallenge.user_id == user_id).order_by(GameChallenge.id.desc())
        ).first()


@pytest.mark.db
def test_reset_refills_tokens_and_leaves_the_rest_alone(migrated_db):  # noqa: F811
    _seed_user("tok_a", campaign_key="camp-tok-a")
    uid = _uid("tok_a")
    _start_run(uid, 1, None)
    card = {"played_engagement_card_ids": ["probe"], "engagement_card_targets": {"probe": ["x"]}}
    _challenge_row(uid, 0, card)

    result = reset_current_challenge_tokens(uid)

    assert result["before"] == 0 and result["after"] == _tokens(uid) > 0
    with get_session() as session:
        row = session.scalars(select(GameChallenge).where(GameChallenge.user_id == uid)).first()
        assert row.action_card == card


@pytest.mark.db
def test_reset_does_nothing_for_a_player_who_is_not_in_a_challenge(migrated_db):  # noqa: F811
    _seed_user("tok_b", campaign_key="camp-tok-b")
    uid = _uid("tok_b")
    _start_run(uid, 1, None)
    _challenge_row(uid, 3, {})
    with get_session() as session:
        session.add(GameProgression(user_id=uid, run_index=1, game_progress_index=4, additional_data=[]))

    assert reset_current_challenge_tokens(uid) is None
    assert _tokens(uid) == 3


@pytest.mark.db
def test_a_teacher_only_reaches_players_in_their_own_campaigns(migrated_db):  # noqa: F811
    _seed_user("tok_c", campaign_key="camp-tok-c")

    assert player_in_campaigns("tok_c@example.test", ["camp-tok-c"]) == _uid("tok_c")
    assert player_in_campaigns("tok_c@example.test", ["another-campaign"]) is None
    assert player_in_campaigns("nobody@example.test", ["camp-tok-c"]) is None


@pytest.mark.db
def test_the_route_404s_a_stranger_409s_an_idle_player_and_pushes_to_the_player(migrated_db, monkeypatch):  # noqa: F811
    import asyncio

    from fastapi import HTTPException

    from mlops_serious_game.infrastructure.routes import teacher_routes

    _seed_user("tok_d", campaign_key="camp-tok-d")
    uid = _uid("tok_d")
    pushed = []

    async def fake_push(user_id, event, payload):
        pushed.append((user_id, event, payload))
        return 1

    monkeypatch.setattr(teacher_routes.manager, "send_to_player", fake_push)
    monkeypatch.setattr(teacher_routes, "get_teacher_campaign_keys", lambda teacher_id: ["camp-tok-d"])
    teacher = {"id": 1}
    run = lambda email: asyncio.run(teacher_routes.reset_player_tokens(email, teacher))  # noqa: E731

    with pytest.raises(HTTPException) as stranger:
        run("nobody@example.test")
    assert stranger.value.status_code == 404

    with pytest.raises(HTTPException) as idle:
        run("tok_d@example.test")
    assert idle.value.status_code == 409 and not pushed

    _start_run(uid, 1, None)
    _challenge_row(uid, 0, {})
    out = run("tok_d@example.test")

    assert out["notified"] is True and pushed == [(uid, "game:tokens_reset", {"challenge_id": pushed[0][2]["challenge_id"], "attention_tokens": out["attention_tokens"]})]
