"""Tests for server-side narration (docs/plans/player-settings-and-tts.md).

`edge_tts.Communicate` is always mocked - these tests must never reach Microsoft's real
endpoint. `test_tts_service.py`-style pure logic (voice/prosody selection) needs no mocking at
all since it never imports `edge_tts`.
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from mlops_serious_game.application.services import user_settings_service
from mlops_serious_game.application.services.auth_service import hash_password, register_user
from mlops_serious_game.application.services.tts_service import (
    DEFAULT_PLAYER_VOICE_GENDER,
    FIXED_VOICES,
    PLAYER_VOICES,
    VOICE_POOLS,
    voice_and_prosody,
)
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.api import app
from mlops_serious_game.infrastructure.database import Campaign, User, get_session

# Every fixture/test below shares this one campaign instead of minting a fresh
# `tts-*-campaign-<uuid>` per test - `register_user` needs `is_test_campaign` set to accept an
# empty email/password-policy-free registration, so this get-or-create also forces that flag on
# in case the row was created by an older test run before this campaign carried it.
TEST_CAMPAIGN_KEY = "tts-test-campaign"


def _get_or_create_tts_test_campaign(session) -> Campaign:
    campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == TEST_CAMPAIGN_KEY))
    if campaign is None:
        campaign = Campaign(
            campaign_name=TEST_CAMPAIGN_KEY,
            campaign_key=TEST_CAMPAIGN_KEY,
            is_test_campaign=True,
            is_bot_campaign=True,
        )
        session.add(campaign)
        session.flush()
    else:
        if not campaign.is_test_campaign:
            campaign.is_test_campaign = True
        if not campaign.is_bot_campaign:
            campaign.is_bot_campaign = True
    return campaign


# ---------- voice/prosody selection (pure, no mocking) ----------


def test_voice_selection_is_deterministic_per_seed():
    first = voice_and_prosody("male", "data_dave")
    second = voice_and_prosody("male", "data_dave")
    assert first == second


def test_different_seeds_can_pick_different_voices():
    picks = {voice_and_prosody("female", seed)[0] for seed in ["a", "b", "c", "d", "e", "f"]}
    assert picks.issubset(set(VOICE_POOLS["female"]))
    assert len(picks) > 1


def test_narrator_and_player_ignore_the_seed():
    for seed in ["alice", "bob", None]:
        assert voice_and_prosody("narrator", seed)[0] == FIXED_VOICES["narrator"]
        assert voice_and_prosody("player", seed)[0] == PLAYER_VOICES[DEFAULT_PLAYER_VOICE_GENDER]


def test_player_voice_picks_the_gendered_voice():
    assert voice_and_prosody("player", None, "male")[0] == PLAYER_VOICES["male"]
    assert voice_and_prosody("player", None, "female")[0] == PLAYER_VOICES["female"]


def test_player_voice_falls_back_to_default_gender_when_unset_or_unknown():
    assert voice_and_prosody("player", None, None)[0] == PLAYER_VOICES[DEFAULT_PLAYER_VOICE_GENDER]
    assert voice_and_prosody("player", None, "nonbinary")[0] == PLAYER_VOICES[DEFAULT_PLAYER_VOICE_GENDER]


def test_narrator_and_player_have_no_pitch_wobble():
    voice1, rate1, pitch1 = voice_and_prosody("narrator", "alice")
    voice2, rate2, pitch2 = voice_and_prosody("narrator", "bob")
    assert (voice1, rate1, pitch1) == (voice2, rate2, pitch2)
    assert pitch1 == "+0Hz"


def test_seeded_slots_without_a_seed_fall_back_to_the_first_pool_voice():
    voice, rate, pitch = voice_and_prosody("male", None)
    assert voice == VOICE_POOLS["male"][0]
    assert rate == "+0%"
    assert pitch == "+0Hz"


# ---------- speed ----------


def test_speed_shifts_rate_on_every_slot():
    for slot, seed in [("narrator", None), ("player", None), ("male", "data_dave")]:
        normal = voice_and_prosody(slot, seed, speed=1.0)
        faster = voice_and_prosody(slot, seed, speed=1.25)
        assert normal[1] != faster[1]  # rate differs
        assert normal[0] == faster[0]  # voice choice itself is untouched


# ---------- HTTP endpoint ----------


class FakeCommunicate:
    """Stands in for `edge_tts.Communicate`: `.stream()` yields the same shape edge-tts does,
    audio chunks interleaved with metadata this route ignores."""

    def __init__(self, text, voice=None, rate=None, pitch=None):
        self.text = text
        self.voice = voice
        self.rate = rate
        self.pitch = pitch

    async def stream(self):
        yield {"type": "audio", "data": b"fake-mp3-bytes-1"}
        yield {"type": "WordBoundary", "offset": 0, "duration": 1}
        yield {"type": "audio", "data": b"fake-mp3-bytes-2"}


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
    username = f"tts_test_{uuid.uuid4().hex[:8]}"
    password = "correct-horse-battery-staple"

    with get_session() as session:
        campaign = _get_or_create_tts_test_campaign(session)
        session.add(User(
            user_name=username,
            campaign_key=TEST_CAMPAIGN_KEY,
            campaign_id=campaign.id,
            email=f"{username}@example.test",
            password_hash=hash_password(password),
            users_on_machine=1,
            is_verified=True,
        ))

    login = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200
    csrf_token = client.cookies.get("mlops_csrf")
    return {"X-CSRF-Token": csrf_token}


def test_tts_endpoint_requires_auth(client):
    # A matching CSRF cookie/header pair with no player cookie, so the request clears the CSRF
    # middleware and actually reaches the route's auth dependency instead of failing earlier.
    client.cookies.set("mlops_csrf", "no-session-token")
    response = client.post(
        "/api/tts",
        json={"text": "hello world", "slot": "narrator"},
        headers={"X-CSRF-Token": "no-session-token"},
    )
    assert response.status_code == 401


def test_tts_endpoint_streams_audio_mpeg(client, logged_in_player):
    with patch("edge_tts.Communicate", FakeCommunicate):
        response = client.post(
            "/api/tts",
            json={"text": "hello world", "slot": "narrator"},
            headers=logged_in_player,
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"fake-mp3-bytes-1fake-mp3-bytes-2"


def test_tts_endpoint_passes_the_seeded_voice_through(client, logged_in_player):
    captured = {}

    class CapturingCommunicate(FakeCommunicate):
        def __init__(self, text, voice=None, rate=None, pitch=None):
            captured["voice"] = voice
            captured["rate"] = rate
            captured["pitch"] = pitch
            super().__init__(text, voice, rate, pitch)

    with patch("edge_tts.Communicate", CapturingCommunicate):
        response = client.post(
            "/api/tts",
            json={"text": "hello world", "slot": "male", "seed": "data_dave"},
            headers=logged_in_player,
        )

    assert response.status_code == 200
    expected_voice, expected_rate, expected_pitch = voice_and_prosody("male", "data_dave")
    assert captured == {"voice": expected_voice, "rate": expected_rate, "pitch": expected_pitch}


def test_tts_endpoint_rejects_empty_text(client, logged_in_player):
    with patch("edge_tts.Communicate", FakeCommunicate):
        response = client.post(
            "/api/tts", json={"text": "   ", "slot": "narrator"}, headers=logged_in_player
        )
    assert response.status_code == 400


def test_tts_endpoint_is_503_when_the_flag_is_off(client, logged_in_player):
    with patch.object(settings, "TTS_BACKEND_ENABLED", False):
        response = client.post(
            "/api/tts",
            json={"text": "hello world", "slot": "narrator"},
            headers=logged_in_player,
        )
    assert response.status_code == 503


# ---------- player_voice_gender wiring (docs/plans/player-settings-and-tts.md) ----------


@pytest.fixture
def logged_in_player_with_voice_gender(client):
    """Same as `logged_in_player`, but the account's `player_voice_gender` setting is seeded
    to the given value first, so the `player` slot request below has something real to read."""

    def _make(gender: str) -> dict:
        username = f"tts_gender_test_{uuid.uuid4().hex[:8]}"
        password = "correct-horse-battery-staple"

        with get_session() as session:
            campaign = _get_or_create_tts_test_campaign(session)
            session.add(User(
                user_name=username,
                campaign_key=TEST_CAMPAIGN_KEY,
                campaign_id=campaign.id,
                email=f"{username}@example.test",
                password_hash=hash_password(password),
                users_on_machine=1,
                is_verified=True,
            ))
        user_settings_service.update_settings(username, {"player_voice_gender": gender})

        login = client.post("/api/auth/login", json={"username": username, "password": password})
        assert login.status_code == 200
        csrf_token = client.cookies.get("mlops_csrf")
        return {"X-CSRF-Token": csrf_token}

    return _make


def test_tts_player_slot_uses_the_male_voice_for_a_male_setting(client, logged_in_player_with_voice_gender):
    headers = logged_in_player_with_voice_gender("male")
    captured = {}

    class CapturingCommunicate(FakeCommunicate):
        def __init__(self, text, voice=None, rate=None, pitch=None):
            captured["voice"] = voice
            super().__init__(text, voice, rate, pitch)

    with patch("edge_tts.Communicate", CapturingCommunicate):
        response = client.post("/api/tts", json={"text": "hello world", "slot": "player"}, headers=headers)

    assert response.status_code == 200
    assert captured["voice"] == PLAYER_VOICES["male"]


def test_tts_player_slot_uses_the_female_voice_for_a_female_setting(client, logged_in_player_with_voice_gender):
    headers = logged_in_player_with_voice_gender("female")
    captured = {}

    class CapturingCommunicate(FakeCommunicate):
        def __init__(self, text, voice=None, rate=None, pitch=None):
            captured["voice"] = voice
            super().__init__(text, voice, rate, pitch)

    with patch("edge_tts.Communicate", CapturingCommunicate):
        response = client.post("/api/tts", json={"text": "hello world", "slot": "player"}, headers=headers)

    assert response.status_code == 200
    assert captured["voice"] == PLAYER_VOICES["female"]


def test_tts_non_player_slots_ignore_the_players_voice_gender_setting(client, logged_in_player_with_voice_gender):
    """`player_voice_gender` only steers the `player` slot - a stakeholder's own pool pick must
    not shift just because the player picked "female" for their own voice."""
    headers = logged_in_player_with_voice_gender("female")
    captured = {}

    class CapturingCommunicate(FakeCommunicate):
        def __init__(self, text, voice=None, rate=None, pitch=None):
            captured["voice"] = voice
            super().__init__(text, voice, rate, pitch)

    with patch("edge_tts.Communicate", CapturingCommunicate):
        response = client.post(
            "/api/tts",
            json={"text": "hello world", "slot": "narrator"},
            headers=headers,
        )

    assert response.status_code == 200
    assert captured["voice"] == FIXED_VOICES["narrator"]


# ---------- speed wiring ----------


def test_tts_endpoint_reads_speed_from_the_players_own_settings(client, logged_in_player_with_voice_gender):
    # Reuses the voice-gender fixture purely for its "seed a user, set one setting, log in" shape -
    # the gender it sets is irrelevant here, only the speed set afterwards matters.
    headers = logged_in_player_with_voice_gender("male")
    captured = {}

    class CapturingCommunicate(FakeCommunicate):
        def __init__(self, text, voice=None, rate=None, pitch=None):
            captured["rate"] = rate
            super().__init__(text, voice, rate, pitch)

    with patch("edge_tts.Communicate", CapturingCommunicate):
        response = client.post(
            "/api/tts",
            json={"text": "hello world", "slot": "narrator"},
            headers=headers,
        )

    assert response.status_code == 200
    assert captured["rate"] == "-5%"  # NARRATOR_RATE_PCT with the default 1.0x speed


def test_tts_endpoint_speed_setting_shifts_the_rate(client):
    username = f"tts_speed_test_{uuid.uuid4().hex[:8]}"
    password = "correct-horse-battery-staple"

    with get_session() as session:
        campaign = _get_or_create_tts_test_campaign(session)
        session.add(User(
            user_name=username,
            campaign_key=TEST_CAMPAIGN_KEY,
            campaign_id=campaign.id,
            email=f"{username}@example.test",
            password_hash=hash_password(password),
            users_on_machine=1,
            is_verified=True,
        ))
    user_settings_service.update_settings(username, {"speech_rate": 1.25})

    client.cookies.clear()
    login = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200
    headers = {"X-CSRF-Token": client.cookies.get("mlops_csrf")}

    captured = {}

    class CapturingCommunicate(FakeCommunicate):
        def __init__(self, text, voice=None, rate=None, pitch=None):
            captured["rate"] = rate
            super().__init__(text, voice, rate, pitch)

    with patch("edge_tts.Communicate", CapturingCommunicate):
        response = client.post(
            "/api/tts",
            json={"text": "hello world", "slot": "narrator"},
            headers=headers,
        )

    assert response.status_code == 200
    assert captured["rate"] == "+20%"  # NARRATOR_RATE_PCT (-5) + 1.25x speed (+25)


@pytest.mark.anyio
async def test_registering_with_a_voice_gender_round_trips_through_settings():
    with get_session() as session:
        _get_or_create_tts_test_campaign(session)

    username = f"tts_register_{uuid.uuid4().hex[:8]}"
    result = await register_user(
        username, "", "", "correct-horse-battery-staple", "correct-horse-battery-staple",
        1, TEST_CAMPAIGN_KEY, "female",
    )

    assert result["success"] is True
    assert user_settings_service.get_settings(username)["player_voice_gender"] == "female"


@pytest.mark.anyio
async def test_registering_with_an_unset_or_garbage_voice_gender_defaults_to_male():
    with get_session() as session:
        _get_or_create_tts_test_campaign(session)

    for gender, label in [(None, "unset"), ("nonbinary", "garbage")]:
        username = f"tts_register_default_{label}_{uuid.uuid4().hex[:8]}"
        result = await register_user(
            username, "", "", "correct-horse-battery-staple", "correct-horse-battery-staple",
            1, TEST_CAMPAIGN_KEY, gender,
        )

        assert result["success"] is True
        assert user_settings_service.get_settings(username)["player_voice_gender"] == "male"
