"""Patience-Reset and Pep-Talk: direct engagement-card effects, no Gather turns (card_effects.py)."""

from mlops_serious_game.application.pitch_debate_service import card_effects
from mlops_serious_game.application.pitch_debate_service.session import PitchState
from mlops_serious_game.domain.emotion import PitchTuning


def test_is_impatient_reads_the_stored_step():
    state = PitchState(impatience={"dave": 2})
    assert card_effects.is_impatient(state, "dave") is True
    assert card_effects.is_impatient(state, "monica") is False


def test_resolve_patience_reset_zeroes_only_the_target():
    state = PitchState(impatience={"dave": 3, "monica": 1})
    updated, event = card_effects.resolve_patience_reset(state, "dave", "Data Dave")

    assert updated.impatience["dave"] == 0
    assert updated.impatience["monica"] == 1  # untouched
    assert event.cause == "patience.reset"
    assert event.subject_id == "dave"
    assert event.params == {"st": "Data Dave"}


def test_pep_talk_deltas_touch_only_confidence_and_control():
    tuning = PitchTuning()
    deltas = card_effects.pep_talk_deltas(["dave", "monica"], {"dave": 1.0, "monica": 0.5}, tuning)

    assert set(deltas["dave"].keys()) == {"confidence", "sense_of_control"}
    assert "trust" not in deltas["dave"]
    assert "fairness" not in deltas["dave"]
    assert "stress" not in deltas["dave"]
    assert "perceived_risk" not in deltas["dave"]


def test_pep_talk_deltas_scale_by_reactivity():
    tuning = PitchTuning()
    deltas = card_effects.pep_talk_deltas(["dave", "monica"], {"dave": 1.0, "monica": 0.5}, tuning)

    assert deltas["dave"]["confidence"] == tuning.pep_talk_confidence_gain
    assert deltas["monica"]["confidence"] == tuning.pep_talk_confidence_gain * 0.5
    assert deltas["dave"]["sense_of_control"] == tuning.pep_talk_control_gain
    assert deltas["monica"]["sense_of_control"] == tuning.pep_talk_control_gain * 0.5


def test_pep_talk_deltas_defaults_reactivity_to_one_for_unknown_stakeholders():
    tuning = PitchTuning()
    deltas = card_effects.pep_talk_deltas(["ruth"], {}, tuning)
    assert deltas["ruth"]["confidence"] == tuning.pep_talk_confidence_gain


def test_pep_talk_events_one_per_room_stakeholder():
    events = card_effects.pep_talk_events(["dave", "monica"], {"dave": "Data Dave", "monica": "Model Monica"})
    assert len(events) == 2
    assert {e.cause for e in events} == {"emotion.pep_talk"}
    assert {e.subject_id for e in events} == {"dave", "monica"}
    assert events[0].params["st"] in {"Data Dave", "Model Monica"}
