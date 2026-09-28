"""Double-submit CSRF middleware tests (docs/plans/session-persistence-and-url-routing.md,
D-csrf). Uses the real app via TestClient since the middleware is wired at the app level."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from mlops_serious_game.application.services.auth_service import (
    CSRF_COOKIE_NAME,
    hash_password,
)
from mlops_serious_game.infrastructure.api import app
from mlops_serious_game.infrastructure.database import Campaign, User, get_session
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


@pytest.fixture
def logged_in_player(client):
    username = f"csrf_test_{uuid.uuid4().hex[:8]}"
    password = "correct-horse-battery-staple"
    campaign_key = "csrf-test-campaign"

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
            password_hash=hash_password(password),
            users_on_machine=1,
            is_verified=True,
        ))

    client.post("/api/auth/login", json={"username": username, "password": password})
    return username


def test_login_itself_is_exempt_from_csrf(client):
    # No CSRF cookie exists yet on a fresh client - login must still work.
    response = client.post("/api/auth/login", json={"username": "nobody", "password": "wrong"})
    # Wrong credentials -> 400 from the auth check, not 403 from CSRF - proves the middleware
    # let the request through to the handler at all.
    assert response.status_code == 400


def test_mutating_request_without_csrf_header_is_rejected(client, logged_in_player):
    response = client.post("/api/auth/logout")
    assert response.status_code == 403


def test_mutating_request_with_mismatched_csrf_header_is_rejected(client, logged_in_player):
    response = client.post(
        "/api/auth/logout", headers={CSRF_HEADER_NAME: "not-the-right-value"}
    )
    assert response.status_code == 403


def test_mutating_request_with_matching_csrf_header_is_allowed(client, logged_in_player):
    csrf_token = client.cookies.get(CSRF_COOKIE_NAME)
    assert csrf_token

    response = client.post("/api/auth/logout", headers={CSRF_HEADER_NAME: csrf_token})
    assert response.status_code == 200


def test_get_requests_are_never_csrf_checked(client, logged_in_player):
    response = client.get("/api/auth/whoami")
    assert response.status_code == 200
