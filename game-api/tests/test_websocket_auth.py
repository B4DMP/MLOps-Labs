"""Websocket handshake auth tests (docs/plans/session-persistence-and-url-routing.md,
D-ws-cookie/D-origin-check). The /ws endpoint now authenticates entirely off the `mlops_player`
cookie plus an Origin check - there is no client-supplied username to trust anymore."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from mlops_serious_game.application.services.auth_service import hash_password
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.api import app
from mlops_serious_game.infrastructure.database import Campaign, User, get_session

_ALLOWED_ORIGIN = settings.FRONTEND_ORIGINS[0]


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
def registered_player():
    username = f"ws_auth_test_{uuid.uuid4().hex[:8]}"
    password = "correct-horse-battery-staple"
    campaign_key = "ws-auth-test-campaign"

    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
        if campaign is None:
            campaign = Campaign(campaign_name=campaign_key, campaign_key=campaign_key, is_bot_campaign=True)
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

    return username, password


def test_connect_rejected_with_no_cookie(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": _ALLOWED_ORIGIN}):
            pass


def test_connect_rejected_with_garbage_cookie(client):
    client.cookies.set("mlops_player", "not-a-real-token")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": _ALLOWED_ORIGIN}):
            pass


def test_connect_rejected_on_origin_mismatch(client, registered_player):
    username, password = registered_player
    client.post("/api/auth/login", json={"username": username, "password": password})

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}):
            pass


def test_connect_accepted_with_valid_cookie(client, registered_player):
    username, password = registered_player
    client.post("/api/auth/login", json={"username": username, "password": password})

    with client.websocket_connect("/ws", headers={"origin": _ALLOWED_ORIGIN}) as ws:
        ws.send_json({"event": "system:ping", "payload": {}})
        response = ws.receive_json()
        assert response["event"] == "system:pong"
