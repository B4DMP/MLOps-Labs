"""The per-player settings profile (docs/plans/player-settings-and-tts.md).

Reads never write. A player who has never opened the settings panel has no row, and asking for
their settings must not create one: the row appears on the first actual change. That keeps the
table a record of deliberate choices rather than a shadow of the user table.

Everything here is keyed by username, because that is all the websocket layer ever knows. The
`user_id` FK is resolved on write.
"""

from typing import Any

from sqlalchemy import select

from mlops_serious_game.infrastructure.database import get_session, get_user_id
from mlops_serious_game.infrastructure.database.models import UserSettings

# The shape the client is promised, and the value of every field before a player changes it.
DEFAULT_SETTINGS: dict[str, Any] = {
    "auto_skip_conversations": False,
    "mute_tts": False,
    "voice_male": None,
    "voice_female": None,
    "voice_narrator": None,
    "voice_player": None,
    "tts_backend": "auto",
    "player_voice_gender": "male",
    "speech_rate": 1.0,
}

BOOL_FIELDS = ("auto_skip_conversations", "mute_tts")
VOICE_FIELDS = ("voice_male", "voice_female", "voice_narrator", "voice_player")
# "auto" prefers server-side edge-tts and falls back to window.speechSynthesis on failure;
# "webspeech" skips the backend and forces the old client-only behaviour.
TTS_BACKEND_VALUES = ("auto", "webspeech")
# Which of the two PLAYER_VOICES (tts_service.py) narrates the player's own lines.
PLAYER_VOICE_GENDER_VALUES = ("male", "female")
# Matches the slider's range in SettingsPanel.tsx - wide enough to feel like a real speed change,
# narrow enough that neither TTS path starts mangling words.
MIN_SPEECH_RATE = 0.5
MAX_SPEECH_RATE = 1.75

# A voice is a `SpeechSynthesisVoice.name` from the player's browser, so its contents are
# whatever their OS calls a voice. Only the length is ours to enforce, and it has to match the
# column or a long name would fail on insert instead of being refused here.
MAX_VOICE_NAME_LENGTH = 255


def _as_dict(row: UserSettings | None) -> dict[str, Any]:
    if row is None:
        return dict(DEFAULT_SETTINGS)
    return {
        "auto_skip_conversations": row.auto_skip_conversations,
        "mute_tts": row.mute_tts,
        "voice_male": row.voice_male,
        "voice_female": row.voice_female,
        "voice_narrator": row.voice_narrator,
        "voice_player": row.voice_player,
        "tts_backend": row.tts_backend,
        "player_voice_gender": row.player_voice_gender,
        "speech_rate": row.speech_rate,
    }


def sanitize_settings(payload: dict[str, Any]) -> dict[str, Any]:
    """Keeps only the fields this service owns, coerced to the types the column expects.

    The payload comes straight off a websocket frame, so an unknown key, a string where a bool
    belongs or a 10kB "voice name" all have to bounce off here rather than reach the database.
    Anything unusable is dropped, not corrected: a partial update is the normal case, so leaving
    a field out is already meaningful and dropping a bad one lands on the same behaviour.
    """
    clean: dict[str, Any] = {}

    for field in BOOL_FIELDS:
        if field in payload and isinstance(payload[field], bool):
            clean[field] = payload[field]

    for field in VOICE_FIELDS:
        if field not in payload:
            continue
        value = payload[field]
        if value is None:
            # An explicit null is how the client says "back to automatic voice matching".
            clean[field] = None
        elif isinstance(value, str) and 0 < len(value.strip()) <= MAX_VOICE_NAME_LENGTH:
            clean[field] = value.strip()

    if "tts_backend" in payload and payload["tts_backend"] in TTS_BACKEND_VALUES:
        clean["tts_backend"] = payload["tts_backend"]

    if "player_voice_gender" in payload and payload["player_voice_gender"] in PLAYER_VOICE_GENDER_VALUES:
        clean["player_voice_gender"] = payload["player_voice_gender"]

    if "speech_rate" in payload:
        value = payload["speech_rate"]
        if (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and MIN_SPEECH_RATE <= value <= MAX_SPEECH_RATE
        ):
            clean["speech_rate"] = float(value)

    return clean


def get_settings(user_name: str) -> dict[str, Any]:
    """The player's settings, or the defaults when they have never changed any. Never writes."""
    with get_session() as session:
        row = session.scalar(select(UserSettings).where(UserSettings.user_name == user_name))
        return _as_dict(row)


def update_settings(user_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Applies the usable fields of `payload` and returns the full, merged settings.

    Creates the row on first use. Unknown users are a no-op that returns the defaults: the FK
    needs a real `User.id`, and a websocket frame naming a user who no longer exists (deleted
    mid-session, or reset) should not raise on what is only a preference.
    """
    clean = sanitize_settings(payload)

    with get_session() as session:
        row = session.scalar(select(UserSettings).where(UserSettings.user_name == user_name))

        if row is None:
            user_id = get_user_id(session, user_name)
            if user_id is None:
                return dict(DEFAULT_SETTINGS)
            row = UserSettings(user_name=user_name, user_id=user_id, **DEFAULT_SETTINGS)
            session.add(row)

        for field, value in clean.items():
            setattr(row, field, value)

        session.flush()
        return _as_dict(row)


def delete_settings(user_name: str) -> None:
    """Drops a player's settings row.

    The `user_id` FK cascades, so deleting or resetting an account already takes the row with
    it. This exists for call sites that want the settings gone without touching the user.
    """
    with get_session() as session:
        row = session.scalar(select(UserSettings).where(UserSettings.user_name == user_name))
        if row is not None:
            session.delete(row)
