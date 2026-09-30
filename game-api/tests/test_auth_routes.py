"""HTTP-level tests for the cookie-based auth endpoints
(docs/plans/session-persistence-and-url-routing.md steps 1-2). Exercises the real FastAPI app
against the shared dev Postgres via TestClient, so a real DB is required (same assumption the
rest of the suite already makes)."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from mlops_serious_game.application.services.auth_service import (
    ADMIN_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    PLAYER_COOKIE_NAME,
    hash_password,
)
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.api import app
from mlops_serious_game.infrastructure.database import Campaign, User, get_session


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clear_cookie_jar(client):
    """The TestClient instance (and its cookie jar) is shared across the module to avoid
    re-running the app's lifespan per test - reset the jar between tests so one test's login
    doesn't leak into the next."""
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def registered_player():
    """A real, verified User row with a known password, so /login can be exercised end to end."""
    email = f"cookie_test_{uuid.uuid4().hex[:8]}@example.test"
    password = "correct-horse-battery-staple"
    campaign_key = "cookie-test-campaign"

    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
        if campaign is None:
            campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key, is_bot_campaign=True)
            session.add(campaign)
            session.flush()
        session.add(User(
            campaign_key=campaign_key,
            campaign_id=campaign.id,
            email=email,
            password_hash=hash_password(password),
            users_on_machine=1,
            is_verified=True,
        ))

    return email, password


def test_login_sets_player_cookie_and_omits_token(client, registered_player):
    email, password = registered_player
    response = client.post("/api/auth/login", json={"email": email, "password": password})

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "login_success"
    assert body["email"] == email
    assert "token" not in body
    assert PLAYER_COOKIE_NAME in response.cookies
    assert CSRF_COOKIE_NAME in response.cookies
    assert ADMIN_COOKIE_NAME not in response.cookies


def test_login_wrong_password_sets_no_cookies(client, registered_player):
    email, _ = registered_player
    response = client.post("/api/auth/login", json={"email": email, "password": "wrong"})

    assert response.status_code == 400
    assert PLAYER_COOKIE_NAME not in response.cookies


def test_admin_login_sets_admin_cookie_only(client):
    response = client.post(
        "/api/auth/login", json={"email": settings.ADMIN_USER, "password": settings.ADMIN_KEY}
    )

    assert response.status_code == 200
    assert response.json() == {"type": "admin_login_success"}
    assert ADMIN_COOKIE_NAME in response.cookies
    assert PLAYER_COOKIE_NAME not in response.cookies


def test_whoami_reflects_no_session(client):
    fresh_client = TestClient(app)
    response = fresh_client.get("/api/auth/whoami")

    assert response.status_code == 200
    assert response.json() == {"player": None, "admin": None, "teacher": None}


def test_whoami_reflects_player_session(client, registered_player):
    email, password = registered_player
    client.post("/api/auth/login", json={"email": email, "password": password})

    response = client.get("/api/auth/whoami")

    assert response.status_code == 200
    player = response.json()["player"]
    assert player["email"] == email
    assert isinstance(player["id"], int)


def _csrf_headers(client) -> dict[str, str]:
    """The double-submit token rides a non-httpOnly cookie the real frontend echoes back as a
    header (docs/plans/session-persistence-and-url-routing.md, D-csrf) - TestClient's cookie jar
    doesn't do that automatically, so mutating-request tests have to do it themselves."""
    return {"x-csrf-token": client.cookies.get(CSRF_COOKIE_NAME)}


def test_logout_clears_player_cookie(client, registered_player):
    email, password = registered_player
    client.post("/api/auth/login", json={"email": email, "password": password})
    assert client.get("/api/auth/whoami").json()["player"] is not None

    logout_response = client.post("/api/auth/logout", headers=_csrf_headers(client))
    assert logout_response.status_code == 200

    assert client.get("/api/auth/whoami").json()["player"] is None


def test_whoami_treats_a_deleted_users_cookie_as_logged_out(client, registered_player):
    """The token itself is a self-contained signed JWT and stays cryptographically valid after its
    row is gone (a database reset, an account deletion) - `whoami` must not report the player as
    logged in on a cookie nothing backs, or the frontend sails into gameplay on a phantom identity
    that then crashes the first real DB write (NOT NULL on `user_id`)."""
    email, password = registered_player
    client.post("/api/auth/login", json={"email": email, "password": password})
    assert client.get("/api/auth/whoami").json()["player"] is not None

    with get_session() as session:
        row = session.scalar(select(User).where(User.email == email))
        session.delete(row)

    response = client.get("/api/auth/whoami")
    assert response.json()["player"] is None
    # And the now-useless cookie is not kept sending itself forever.
    assert PLAYER_COOKIE_NAME not in client.cookies


def test_admin_logout_clears_admin_cookie_only(client, registered_player):
    email, password = registered_player
    client.post("/api/auth/login", json={"email": email, "password": password})
    client.post(
        "/api/auth/login", json={"email": settings.ADMIN_USER, "password": settings.ADMIN_KEY}
    )
    before = client.get("/api/auth/whoami").json()
    assert before["player"] is not None
    assert before["admin"] is not None

    client.post("/api/auth/admin-logout", headers=_csrf_headers(client))

    after = client.get("/api/auth/whoami").json()
    assert after["admin"] is None
    assert after["player"] is not None
