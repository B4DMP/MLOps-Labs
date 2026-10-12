"""Admin "Reset player": the typed-name check, auth, and that the account survives but its progress doesn't."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from mlops_serious_game.application.services.auth_service import CSRF_COOKIE_NAME, hash_password
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.api import app
from mlops_serious_game.infrastructure.database import Campaign, GameProgression, User, get_session

pytestmark = pytest.mark.db


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_cookie_jar(client):
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def player():
    email = f"reset_test_{uuid.uuid4().hex[:8]}@example.test"
    campaign_key = "reset-test-campaign"
    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
        if campaign is None:
            campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key, is_bot_campaign=True)
            session.add(campaign)
            session.flush()
        user = User(
            campaign_key=campaign_key,
            campaign_id=campaign.id,
            email=email,
            password_hash=hash_password("correct-horse-battery-staple"),
            users_on_machine=1,
            is_verified=True,
        )
        session.add(user)
        session.flush()
        session.add(GameProgression(user_id=user.id, game_progress_index=2, run_index=1))
        user_id = user.id
    return user_id, email


def _login_admin(client) -> dict[str, str]:
    client.post("/api/auth/login", json={"email": settings.ADMIN_USER, "password": settings.ADMIN_KEY})
    return {"x-csrf-token": client.cookies.get(CSRF_COOKIE_NAME)}


def _progress_rows(user_id: int) -> int:
    with get_session() as session:
        return session.scalar(select(func.count()).select_from(GameProgression).where(GameProgression.user_id == user_id))


def test_reset_requires_admin(client, player):
    user_id, email = player
    client.cookies.set(CSRF_COOKIE_NAME, "t")

    response = client.post(
        f"/api/admin/players/{email}/reset", json={"confirm_name": email}, headers={"x-csrf-token": "t"}
    )

    assert response.status_code == 401
    assert _progress_rows(user_id) == 1


def test_reset_with_wrong_name_changes_nothing(client, player):
    user_id, email = player
    headers = _login_admin(client)

    response = client.post(f"/api/admin/players/{email}/reset", json={"confirm_name": "someone-else"}, headers=headers)

    assert response.status_code == 400
    assert _progress_rows(user_id) == 1


def test_reset_unknown_player_is_404(client):
    headers = _login_admin(client)
    name = "nobody@example.test"

    response = client.post(f"/api/admin/players/{name}/reset", json={"confirm_name": name}, headers=headers)

    assert response.status_code == 404


def test_reset_wipes_progress_but_keeps_the_account(client, player):
    user_id, email = player
    headers = _login_admin(client)

    response = client.post(f"/api/admin/players/{email}/reset", json={"confirm_name": email}, headers=headers)

    assert response.status_code == 200
    assert response.json()["type"] == "admin_data_update"
    assert _progress_rows(user_id) == 0
    with get_session() as session:
        user = session.get(User, user_id)
        assert user is not None
        assert user.email == email
        assert user.campaign_key == "reset-test-campaign"
        assert user.is_verified is True
