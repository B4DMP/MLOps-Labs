"""Unit tests for the cookie/token helpers added for session persistence
(docs/plans/session-persistence-and-url-routing.md). No DB/network needed - these are pure
JWT + cookie-header manipulation, except for `verify_player_token`/`sliding_refresh_player`'s
`player_exists` check (a stale-but-unexpired cookie must not outlive the user it names, see
docs/plans/graph-governance-automation-rework), which is monkeypatched here rather than exercised
against a real database - that gate has its own dedicated tests below."""

from datetime import timedelta

import pytest
from fastapi import Response

from mlops_serious_game.application.services import auth_service
from mlops_serious_game.config import settings


@pytest.fixture(autouse=True)
def _player_always_exists(monkeypatch):
    """The default for every test in this file: a token's subject is a real user. Tests of the
    existence gate itself override this per-test."""
    monkeypatch.setattr(auth_service, "player_exists", lambda user_id: True)


def _set_cookie_names(response: Response) -> list[str]:
    """Every cookie name set on `response` via Set-Cookie, in order."""
    names = []
    for key, value in response.raw_headers:
        if key == b"set-cookie":
            names.append(value.decode().split("=", 1)[0])
    return names


def test_decode_token_round_trips_and_rejects_garbage():
    token = auth_service.create_access_token(data={"sub": "1", "role": "player"})
    payload = auth_service.decode_token(token)
    assert payload["sub"] == "1"
    assert payload["role"] == "player"

    assert auth_service.decode_token("not-a-real-token") is None
    assert auth_service.decode_token(None) is None
    assert auth_service.decode_token("") is None


def test_decode_token_rejects_expired():
    token = auth_service.create_access_token(
        data={"sub": "1", "role": "player"}, expires_delta=timedelta(seconds=-1)
    )
    assert auth_service.decode_token(token) is None


def test_verify_admin_token():
    admin_token = auth_service.create_access_token(data={"sub": settings.ADMIN_USER})
    player_token = auth_service.create_access_token(data={"sub": "1", "role": "player"})

    assert auth_service.verify_admin_token(admin_token) is True
    assert auth_service.verify_admin_token(player_token) is False
    assert auth_service.verify_admin_token("garbage") is False
    assert auth_service.verify_admin_token("") is False


def test_verify_player_token():
    player_token = auth_service.create_access_token(data={"sub": "1", "role": "player"})
    admin_token = auth_service.create_access_token(data={"sub": settings.ADMIN_USER})
    no_role_token = auth_service.create_access_token(data={"sub": "1"})

    assert auth_service.verify_player_token(player_token) == 1
    assert auth_service.verify_player_token(admin_token) is None
    assert auth_service.verify_player_token(no_role_token) is None
    assert auth_service.verify_player_token("garbage") is None


def test_set_player_cookie_sets_player_and_csrf_cookies():
    response = Response()
    auth_service.set_player_cookie(response, 1, secure=False)

    names = _set_cookie_names(response)
    assert auth_service.PLAYER_COOKIE_NAME in names
    assert auth_service.CSRF_COOKIE_NAME in names


def test_set_player_cookie_does_not_reissue_existing_csrf():
    response = Response()
    auth_service.set_player_cookie(response, 1, secure=False, existing_csrf="already-set")

    names = _set_cookie_names(response)
    assert auth_service.PLAYER_COOKIE_NAME in names
    assert auth_service.CSRF_COOKIE_NAME not in names


def test_sliding_refresh_player_reissues_near_expiry_token():
    near_expiry_token = auth_service.create_access_token(
        data={"sub": "1", "role": "player"}, expires_delta=timedelta(minutes=1)
    )
    response = Response()

    user_id = auth_service.sliding_refresh_player(near_expiry_token, response, secure=False)

    assert user_id == 1
    assert auth_service.PLAYER_COOKIE_NAME in _set_cookie_names(response)


def test_sliding_refresh_player_leaves_fresh_token_alone():
    fresh_token = auth_service.create_access_token(data={"sub": "1", "role": "player"})
    response = Response()

    user_id = auth_service.sliding_refresh_player(fresh_token, response, secure=False)

    assert user_id == 1
    assert auth_service.PLAYER_COOKIE_NAME not in _set_cookie_names(response)


def test_sliding_refresh_player_returns_none_for_invalid_token():
    response = Response()
    assert auth_service.sliding_refresh_player(None, response, secure=False) is None
    assert auth_service.sliding_refresh_player("garbage", response, secure=False) is None
    assert _set_cookie_names(response) == []


def test_verify_player_token_rejects_a_signature_valid_token_for_a_user_that_no_longer_exists(monkeypatch):
    """A stale cookie from before a database reset decodes fine but must not authenticate - this
    is what turned a missing `users` row into a raw NOT NULL crash deep in a handler."""
    monkeypatch.setattr(auth_service, "player_exists", lambda user_id: False)
    player_token = auth_service.create_access_token(data={"sub": "1", "role": "player"})

    assert auth_service.verify_player_token(player_token) is None


def _impersonation_cookies(user_id: int = 7, *, admin: bool = True, own_player: int | None = None) -> dict:
    cookies = {auth_service.IMPERSONATE_COOKIE_NAME: auth_service._create_impersonation_token(user_id)}
    if admin:
        cookies[auth_service.ADMIN_COOKIE_NAME] = auth_service._create_admin_token()
    if own_player is not None:
        cookies[auth_service.PLAYER_COOKIE_NAME] = auth_service._create_player_token(own_player)
    return cookies


def test_resolve_player_prefers_a_valid_impersonation_over_the_own_player_cookie():
    cookies = _impersonation_cookies(7, own_player=1)

    assert auth_service.resolve_player(cookies) == (7, True)
    assert auth_service.player_id_from_cookies(cookies) == 7


def test_resolve_player_ignores_impersonation_without_a_valid_admin_cookie():
    cookies = _impersonation_cookies(7, admin=False, own_player=1)

    assert auth_service.resolve_player(cookies) == (1, False)
    assert auth_service.resolve_player(_impersonation_cookies(7, admin=False)) is None


def test_resolve_player_rejects_a_player_token_in_the_impersonation_cookie():
    cookies = {
        auth_service.IMPERSONATE_COOKIE_NAME: auth_service._create_player_token(7),
        auth_service.ADMIN_COOKIE_NAME: auth_service._create_admin_token(),
    }

    assert auth_service.resolve_player(cookies) is None


def test_resolve_player_ignores_impersonation_of_a_user_that_no_longer_exists(monkeypatch):
    monkeypatch.setattr(auth_service, "player_exists", lambda user_id: False)

    assert auth_service.resolve_player(_impersonation_cookies(7)) is None


def test_resolve_player_falls_back_to_the_own_player_cookie():
    own = {auth_service.PLAYER_COOKIE_NAME: auth_service._create_player_token(1)}

    assert auth_service.resolve_player(own) == (1, False)
    assert auth_service.resolve_player({}) is None


def test_sliding_refresh_impersonation_reissues_near_expiry_only(monkeypatch):
    near_expiry = {
        auth_service.IMPERSONATE_COOKIE_NAME: auth_service.create_access_token(
            data={"sub": "7", "role": "impersonation"}, expires_delta=timedelta(minutes=1)
        ),
        auth_service.ADMIN_COOKIE_NAME: auth_service._create_admin_token(),
    }
    response = Response()
    assert auth_service.sliding_refresh_impersonation(near_expiry, response, secure=False) == 7
    assert auth_service.IMPERSONATE_COOKIE_NAME in _set_cookie_names(response)

    fresh_response = Response()
    assert auth_service.sliding_refresh_impersonation(_impersonation_cookies(7), fresh_response, secure=False) == 7
    assert auth_service.IMPERSONATE_COOKIE_NAME not in _set_cookie_names(fresh_response)


def test_sliding_refresh_player_reports_logged_out_for_a_user_that_no_longer_exists(monkeypatch):
    monkeypatch.setattr(auth_service, "player_exists", lambda user_id: False)
    fresh_token = auth_service.create_access_token(data={"sub": "1", "role": "player"})
    response = Response()

    user_id = auth_service.sliding_refresh_player(fresh_token, response, secure=False)

    assert user_id is None
    assert _set_cookie_names(response) == []


def test_sliding_refresh_admin_reissues_near_expiry_token():
    near_expiry_token = auth_service.create_access_token(
        data={"sub": settings.ADMIN_USER}, expires_delta=timedelta(minutes=1)
    )
    response = Response()

    assert auth_service.sliding_refresh_admin(near_expiry_token, response, secure=False) is True
    assert auth_service.ADMIN_COOKIE_NAME in _set_cookie_names(response)


def test_sliding_refresh_admin_rejects_player_token():
    player_token = auth_service.create_access_token(data={"sub": "1", "role": "player"})
    response = Response()

    assert auth_service.sliding_refresh_admin(player_token, response, secure=False) is False
    assert _set_cookie_names(response) == []


def test_clear_cookies():
    response = Response()
    auth_service.clear_player_cookie(response)
    auth_service.clear_admin_cookie(response)
    names = _set_cookie_names(response)
    assert auth_service.PLAYER_COOKIE_NAME in names
    assert auth_service.ADMIN_COOKIE_NAME in names
