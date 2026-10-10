"""Admin "view as player": start/stop endpoints, whoami, the profile-route guard, and the
websocket's read-only gate."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from mlops_serious_game.application.services.auth_service import (
    CSRF_COOKIE_NAME,
    IMPERSONATE_COOKIE_NAME,
    hash_password,
)
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.api import app
from mlops_serious_game.infrastructure.database import Campaign, User, get_session

pytestmark = pytest.mark.db

_ORIGIN = settings.FRONTEND_ORIGINS[0]


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
def target_player():
    email = f"impersonate_test_{uuid.uuid4().hex[:8]}@example.test"
    campaign_key = "impersonate-test-campaign"
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
        user_id = user.id
    return user_id, email


def _login_admin(client) -> dict[str, str]:
    client.post("/api/auth/login", json={"email": settings.ADMIN_USER, "password": settings.ADMIN_KEY})
    return {"x-csrf-token": client.cookies.get(CSRF_COOKIE_NAME)}


def test_impersonate_requires_admin(client, target_player):
    _, email = target_player
    client.cookies.set(CSRF_COOKIE_NAME, "t")

    response = client.post(f"/api/admin/players/{email}/impersonate", headers={"x-csrf-token": "t"})

    assert response.status_code == 401
    assert IMPERSONATE_COOKIE_NAME not in response.cookies


def test_impersonate_unknown_player_is_404(client):
    headers = _login_admin(client)

    response = client.post("/api/admin/players/nobody@example.test/impersonate", headers=headers)

    assert response.status_code == 404


def test_impersonate_sets_cookie_and_whoami_reports_it(client, target_player):
    user_id, email = target_player
    headers = _login_admin(client)

    response = client.post(f"/api/admin/players/{email}/impersonate", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"type": "impersonation_started", "user_id": user_id, "email": email}
    who = client.get("/api/auth/whoami").json()
    assert who["impersonating"] == {"id": user_id, "email": email}
    assert who["player"] is None


def test_stop_clears_impersonation(client, target_player):
    _, email = target_player
    headers = _login_admin(client)
    client.post(f"/api/admin/players/{email}/impersonate", headers=headers)

    assert client.post("/api/auth/impersonate/stop", headers=headers).status_code == 200

    assert client.get("/api/auth/whoami").json()["impersonating"] is None


def test_admin_logout_ends_impersonation(client, target_player):
    _, email = target_player
    headers = _login_admin(client)
    client.post(f"/api/admin/players/{email}/impersonate", headers=headers)

    client.post("/api/auth/admin-logout", headers=headers)

    assert client.get("/api/auth/whoami").json()["impersonating"] is None


def test_account_changes_are_refused_while_impersonating(client, target_player):
    _, email = target_player
    headers = _login_admin(client)
    client.post(f"/api/admin/players/{email}/impersonate", headers=headers)

    response = client.post(
        "/api/auth/change-password",
        json={"current_password": "x", "new_password": "newpassword1", "new_password_confirm": "newpassword1"},
        headers=headers,
    )

    assert response.status_code == 403


def test_websocket_lets_loads_through_and_refuses_actions(client, target_player):
    _, email = target_player
    headers = _login_admin(client)
    client.post(f"/api/admin/players/{email}/impersonate", headers=headers)

    with client.websocket_connect("/ws", headers={"origin": _ORIGIN}) as ws:
        ws.send_json({"event": "game:progress_update", "payload": {"value": 2}})
        blocked = ws.receive_json()
        assert blocked["event"] == "system:read_only"
        assert blocked["payload"] == {"event": "game:progress_update"}

        ws.send_json({"event": "board:connect", "payload": {"a": "x", "b": "y", "kind": "ally"}})
        blocked = ws.receive_json()
        assert blocked["event"] == "system:read_only" and blocked["payload"] == {"event": "board:connect"}

        ws.send_json({"event": "board:pencil", "payload": {"item_id": "x", "on": True}})
        blocked = ws.receive_json()
        assert blocked["event"] == "system:read_only" and blocked["payload"] == {"event": "board:pencil"}

        ws.send_json({"event": "pitch:delegate", "payload": {"phase_id": 0, "challenge_id": 0, "stakeholder_id": "x", "target": "y"}})
        blocked = ws.receive_json()
        assert blocked["event"] == "system:read_only" and blocked["payload"] == {"event": "pitch:delegate"}

        ws.send_json({"event": "board:get", "payload": {"phase_id": 0, "challenge_id": 0}})
        assert ws.receive_json()["event"] == "board:state"

        ws.send_json({"event": "system:ping", "payload": {}})
        assert ws.receive_json()["event"] == "system:pong"


def test_websocket_is_refused_once_the_admin_is_gone(client, target_player):
    _, email = target_player
    headers = _login_admin(client)
    client.post(f"/api/admin/players/{email}/impersonate", headers=headers)
    client.post("/api/auth/admin-logout", headers=headers)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": _ORIGIN}):
            pass
