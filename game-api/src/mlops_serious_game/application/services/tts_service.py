"""Server-side narration via `edge-tts` (docs/plans/player-settings-and-tts.md).

Ports the voice-selection scheme `speech.ts` already uses for `window.speechSynthesis`: `male`
and `female` are pools of a few neural voices, picked deterministically per stakeholder id so the
same stakeholder always sounds the same, with a small seeded rate/pitch offset layered on top
(mirroring `pitchFor`'s spread/clamp). `narrator` and `player` are one fixed voice each, matching
`SEEDED_SLOTS` in `speech.ts` - no wobble, since each is a single speaker.

Deliberately does not attempt to vary voice by a stakeholder's emotional state: edge-tts (Microsoft
Edge's free "Read Aloud" backend, not the paid Azure Speech SDK) has no `mstts:express-as` style
support - `edge_tts.Communicate` only ever accepts rate/pitch/volume (see its `mkssml`), and a
prosody-only approximation (louder/faster/higher-pitched for "angry", etc.) was tried and dropped:
playtesting found it imperceptible as emotion and just read as "sped up". Mood is now surfaced
visually instead (see `EmotionEmoji.tsx` on the frontend).
"""

from typing import Literal

VoiceSlot = Literal["male", "female", "narrator", "player"]

# A few real Azure neural voice ids per gendered slot, not just one, so a handful of stakeholders
# sharing a slot still sound distinct from each other before the rate/pitch offset is even applied.
# Index 0 is what an unseeded pick and hash-seed-0 both land on; the rest of the pool is unchanged,
# kept for variety among stakeholders. No "Multilingual" voices anywhere in here (or in
# FIXED_VOICES/PLAYER_VOICES below) - they read English noticeably worse than the plain en-US
# voices for our use case, despite otherwise being Azure's flagship picks. `AvaNeural` was dropped
# from the female pool because it is now the female option for the player's own voice
# (`PLAYER_VOICES` below) - reusing it here too would make a stakeholder and the player sound
# identical.
VOICE_POOLS: dict[str, list[str]] = {
    "male": [
        "en-US-AndrewNeural",
        "en-US-GuyNeural",
        "en-US-ChristopherNeural",
        "en-US-EricNeural",
    ],
    # MichelleNeural leads the female pool (index 0) - playtesting found it clearly the strongest
    # of the four.
    "female": [
        "en-US-MichelleNeural",
        "en-US-JennyNeural",
        "en-US-AriaNeural",
        "en-US-EmmaNeural",
    ],
}

# Narrator is not seeded (one speaker), so it gets a single fixed voice, deliberately distinct
# from both gendered pools. No en-US voice fits that's still outside VOICE_POOLS above, so the
# narrator carries a British accent instead.
FIXED_VOICES: dict[str, str] = {
    "narrator": "en-GB-RyanNeural",
}

# The player's own "you" voice is not seeded either, but unlike narrator it is not a single fixed
# voice: the player picks which of these they are at registration (editable later in settings).
PLAYER_VOICES: dict[str, str] = {
    "male": "en-US-BrianNeural",
    "female": "en-US-AvaNeural",
}
DEFAULT_PLAYER_VOICE_GENDER = "male"

SEEDED_SLOTS = {"male", "female"}

# Same idea as PITCH_SPREAD in speech.ts, expressed in the units edge_tts.Communicate accepts.
PITCH_SPREAD_HZ = 20
RATE_SPREAD_PCT = 8

# The narrator's baseline rate in speech.ts is 0.95x, denser prose read a touch slower than a
# one-line bubble. Kept fixed, matching the "no wobble" rule for unseeded slots.
NARRATOR_RATE_PCT = -5

# Clamped after every bias (seed wobble + the player's speed setting) is summed, so a worst-case
# stack-up never reaches a percentage edge-tts itself would choke on.
RATE_PCT_BOUNDS = (-60, 80)


def _clamp(value: int, bounds: tuple[int, int]) -> int:
    lo, hi = bounds
    return max(lo, min(hi, value))


def hash_seed(seed: str) -> int:
    """Same 32-bit rolling hash as `hashSeed` in `speech.ts`, so a stakeholder id picks the same
    voice and offset here as it would in the browser fallback."""
    h = 0
    for ch in seed:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    if h >= 0x80000000:
        h -= 0x100000000
    return abs(h)


def _signed(value: int) -> str:
    return f"+{value}" if value >= 0 else str(value)


def voice_and_prosody(
    slot: VoiceSlot,
    seed: str | None,
    player_voice_gender: str | None = None,
    speed: float | None = None,
) -> tuple[str, str, str]:
    """Returns `(voice_id, rate, pitch)` for `edge_tts.Communicate`. `rate`/`pitch` are the
    percentage/Hz strings that parameter expects (e.g. "+5%", "-20Hz").

    `player_voice_gender` only matters for the `player` slot - it is the gender the player chose
    at registration (editable later in settings), not a seeded/stakeholder concept. `speed` is the
    player's own narration-speed setting (1.0 = unchanged) and applies to every slot.
    """
    speed_pct = round(((speed if speed is not None else 1.0) - 1.0) * 100)

    if slot == "narrator":
        rate_pct = _clamp(NARRATOR_RATE_PCT + speed_pct, RATE_PCT_BOUNDS)
        return FIXED_VOICES["narrator"], f"{_signed(rate_pct)}%", "+0Hz"

    if slot == "player":
        voice = PLAYER_VOICES.get(player_voice_gender or DEFAULT_PLAYER_VOICE_GENDER, PLAYER_VOICES[DEFAULT_PLAYER_VOICE_GENDER])
        rate_pct = _clamp(speed_pct, RATE_PCT_BOUNDS)
        return voice, f"{_signed(rate_pct)}%", "+0Hz"

    pool = VOICE_POOLS[slot]
    if not seed:
        rate_pct = _clamp(speed_pct, RATE_PCT_BOUNDS)
        return pool[0], f"{_signed(rate_pct)}%", "+0Hz"

    h = hash_seed(seed)
    voice = pool[h % len(pool)]
    unit = (h % 1000) / 1000  # [0, 1), same derivation as pitchFor's offset
    pitch_offset = round(unit * (2 * PITCH_SPREAD_HZ) - PITCH_SPREAD_HZ)
    rate_offset = round(unit * (2 * RATE_SPREAD_PCT) - RATE_SPREAD_PCT)

    rate_pct = _clamp(rate_offset + speed_pct, RATE_PCT_BOUNDS)
    return voice, f"{_signed(rate_pct)}%", f"{_signed(pitch_offset)}Hz"


async def synthesize(
    text: str,
    slot: VoiceSlot,
    seed: str | None,
    player_voice_gender: str | None = None,
    speed: float | None = None,
):
    """Streams MP3 audio bytes for `text` in `slot`'s voice. A thin wrapper so the route doesn't
    import `edge_tts` directly, which keeps the test mocking surface to one place."""
    import edge_tts

    voice, rate, pitch = voice_and_prosody(slot, seed, player_voice_gender, speed)
    communicate = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            yield chunk["data"]
