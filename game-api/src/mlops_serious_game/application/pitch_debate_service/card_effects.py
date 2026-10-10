"""Direct, immediate engagement-card effects on stakeholders (not a Gather conversation).

A "gather" card buys dialogue turns (`gather.py`); an "effect" card instead changes something
about a stakeholder's state the moment it is played - no options, no intel. Pure over its inputs,
mirroring `gather.py`'s convention: the caller resolves ground truth (the current `PitchState`,
each stakeholder's reactivity) and performs the actual writes from what these functions decide.
"""

from __future__ import annotations

from mlops_serious_game.application.pitch_debate_service.session import PitchState
from mlops_serious_game.domain.emotion import EmotionDelta, PitchTuning
from mlops_serious_game.domain.event import GameEvent


def is_impatient(pitch_state: PitchState, stakeholder_id: str) -> bool:
    """Whether a stakeholder has any accumulated impatience to reset."""
    return pitch_state.impatience.get(stakeholder_id, 0) > 0


def resolve_patience_reset(
    pitch_state: PitchState,
    stakeholder_id: str,
    stakeholder_name: str,
) -> tuple[PitchState, GameEvent]:
    """Fully resets one stakeholder's accumulated impatience for this challenge."""
    impatience = dict(pitch_state.impatience)
    impatience[stakeholder_id] = 0
    updated = pitch_state.model_copy(update={"impatience": impatience})
    event = GameEvent(
        step="gather",
        kind="patience",
        subject_id=stakeholder_id,
        direction="up",
        magnitude="clear",
        cause="patience.reset",
        params={"st": stakeholder_name},
    )
    return updated, event


def pep_talk_deltas(
    room_ids: list[str],
    reactivity_by_stakeholder: dict[str, float],
    tuning: PitchTuning,
) -> dict[str, EmotionDelta]:
    """Per-stakeholder confidence/sense-of-control lift, scaled by reactivity.

    Deliberately touches only these two dimensions - a stand-up lifts morale and a feeling of
    being on top of things, it doesn't earn trust or fairness the way real engagement does.
    """
    deltas: dict[str, EmotionDelta] = {}
    for st_id in room_ids:
        mu = reactivity_by_stakeholder.get(st_id, 1.0)
        deltas[st_id] = {
            "confidence": tuning.pep_talk_confidence_gain * mu,
            "sense_of_control": tuning.pep_talk_control_gain * mu,
        }
    return deltas


def pep_talk_events(room_ids: list[str], names_by_stakeholder: dict[str, str]) -> list[GameEvent]:
    return [
        GameEvent(
            step="gather",
            kind="emotion",
            subject_id=st_id,
            direction="up",
            magnitude="slight",
            cause="emotion.pep_talk",
            params={"st": names_by_stakeholder.get(st_id, st_id)},
        )
        for st_id in room_ids
    ]
