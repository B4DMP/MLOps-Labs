"""Profile management tests (docs/plans/session-persistence-and-url-routing.md): change
password/email/username, reachable once already logged in via the player cookie."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from mlops_serious_game.application.services.auth_service import (
    CSRF_COOKIE_NAME,
    PLAYER_COOKIE_NAME,
    _hash_password,
)
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.api import app
from mlops_serious_game.infrastructure.database import (
    Campaign,
    GameChallenge,
    GameProgression,
    User,
    get_session,
    get_user_id,
)
from mlops_serious_game.infrastructure.middleware.csrf import CSRF_HEADER_NAME


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_cookie_jar(client):
    client.cookies.clear()
    yield
    client.cookies.clear()


def _register_and_login(client, password="correct-horse-battery-staple"):
    username = f"profile_test_{uuid.uuid4().hex[:8]}"
    campaign_key = "profile-test-campaign"
    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
        if campaign is None:
            campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key)
            session.add(campaign)
            session.flush()
        session.add(User(
            user_name=username,
            campaign_key=campaign_key,
            campaign_id=campaign.id,
            email=f"{username}@example.test",
            password_hash=_hash_password(password),
            users_on_machine=1,
            is_verified=True,
        ))
    client.post("/api/auth/login", json={"username": username, "password": password})
    csrf_token = client.cookies.get(CSRF_COOKIE_NAME)
    return username, password, {CSRF_HEADER_NAME: csrf_token}


def test_change_password_requires_authentication(client):
    # Isolate the auth check from CSRF: without a matching cookie/header pair, the CSRF
    # middleware itself would 403 before the route's auth dependency ever runs.
    client.cookies.set(CSRF_COOKIE_NAME, "unauthenticated-test-token")
    response = client.post(
        "/api/auth/change-password",
        json={"current_password": "x", "new_password": "y" * 10, "new_password_confirm": "y" * 10},
        headers={CSRF_HEADER_NAME: "unauthenticated-test-token"},
    )
    assert response.status_code == 401


def test_change_password_rejects_wrong_current_password(client):
    username, password, headers = _register_and_login(client)
    response = client.post(
        "/api/auth/change-password",
        json={
            "current_password": "totally-wrong",
            "new_password": "new-password-123",
            "new_password_confirm": "new-password-123",
        },
        headers=headers,
    )
    assert response.status_code == 400


def test_change_password_succeeds_and_new_password_then_works(client):
    username, password, headers = _register_and_login(client)
    response = client.post(
        "/api/auth/change-password",
        json={
            "current_password": password,
            "new_password": "brand-new-password-1",
            "new_password_confirm": "brand-new-password-1",
        },
        headers=headers,
    )
    assert response.status_code == 200

    client.cookies.clear()
    login_response = client.post(
        "/api/auth/login", json={"username": username, "password": "brand-new-password-1"}
    )
    assert login_response.status_code == 200
    assert login_response.json()["type"] == "login_success"


def test_change_email_requires_confirmation_code(client):
    username, password, headers = _register_and_login(client)
    new_email = f"{username}-new@example.test"

    response = client.post(
        "/api/auth/change-email", json={"new_email": new_email}, headers=headers
    )
    assert response.status_code == 200

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        assert user.email != new_email
        assert user.pending_email == new_email
        code = user.email_change_code

    confirm_response = client.post(
        "/api/auth/confirm-email-change", json={"code": code}, headers=headers
    )
    assert confirm_response.status_code == 200

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        assert user.email == new_email
        assert user.pending_email is None


def test_confirm_email_change_rejects_reused_code(client):
    username, password, headers = _register_and_login(client)
    new_email = f"{username}-new2@example.test"
    client.post("/api/auth/change-email", json={"new_email": new_email}, headers=headers)

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        code = user.email_change_code

    first = client.post("/api/auth/confirm-email-change", json={"code": code}, headers=headers)
    assert first.status_code == 200

    second = client.post("/api/auth/confirm-email-change", json={"code": code}, headers=headers)
    assert second.status_code == 400


def test_change_username_rejects_duplicate(client):
    username_a, _, headers_a = _register_and_login(client)
    client.cookies.clear()
    username_b, password_b, headers_b = _register_and_login(client)

    response = client.post(
        "/api/auth/change-username",
        json={"new_username": username_a, "current_password": password_b},
        headers=headers_b,
    )
    assert response.status_code == 400


def test_change_username_renames_across_tables_and_resets_cookie(client):
    username, password, headers = _register_and_login(client)
    new_username = f"{username}_renamed"

    with get_session() as session:
        user_id = get_user_id(session, username)
        session.add(GameProgression(
            user_name=username, user_id=user_id, run_index=1, game_progress_index=1,
            time_stamp=__import__("datetime").datetime.utcnow(), additional_data=[],
        ))
        session.add(GameChallenge(
            user_name=username, user_id=user_id, run_index=1, phase_index=0, challenge_index=0,
            challenge_loop_index=0, action_card={}, metric_values=[], messages=[],
            time_stamp=__import__("datetime").datetime.utcnow(), attention_tokens=20,
        ))

    response = client.post(
        "/api/auth/change-username",
        json={"new_username": new_username, "current_password": password},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["username"] == new_username
    assert client.cookies.get(PLAYER_COOKIE_NAME) is not None

    whoami = client.get("/api/auth/whoami")
    assert whoami.json()["player"] == {"username": new_username}

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == new_username))
        assert user is not None
        assert session.scalar(select(User).where(User.user_name == username)) is None

        progression = session.scalar(select(GameProgression).where(GameProgression.user_id == user.id))
        assert progression.user_name == new_username
        challenge = session.scalar(select(GameChallenge).where(GameChallenge.user_id == user.id))
        assert challenge.user_name == new_username
