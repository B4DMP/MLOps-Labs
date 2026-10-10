"""Hand the Pen: the holder and the rest of the room each lose a little fairness at the reveal."""

from conftest import make_intel_item as _item, make_target as _target
from mlops_serious_game.application.pitch_debate_service import session
from mlops_serious_game.application.pitch_debate_service.session import AtomicChange, PenState, PitchState
from mlops_serious_game.domain.graph import GraphState

_EMO = {"fairness": 0.5, "trust": 0.5, "stress": 0.5, "confidence": 0.5, "perceived_risk": 0.5, "interest": 0.5, "sense_of_control": 0.5}


def _evaluate(real, previous):
    driver = _item("d1", "data_dave", "driver", categorized_type="driver", suggested=_target("data.validation", 2))
    return session.evaluate_pitch(
        graph=real,
        state=GraphState.from_config(real),
        all_intel=[driver],
        card_item_ids={"d1"},
        room=[("data_dave", "high"), ("reliability_ruth", "high")],
        current_emotions={"data_dave": dict(_EMO), "reliability_ruth": dict(_EMO)},
        held_items=[driver],
        names={"data_dave": "Dave", "reliability_ruth": "Ruth"},
        previous=previous,
    )[0]


def _pen(bonus_paid):
    change = AtomicChange(target="data.validation", kind="raise_to", axis="automation", value=2)
    return PenState(stakeholder_id="data_dave", target="data.validation", change=change, band="medium", revealed=True, bonus_paid=bonus_paid)


def test_pen_reveal_costs_the_holder_and_the_room_some_fairness(real):
    base = _evaluate(real, None)
    with_pen = _evaluate(real, PitchState(pen=_pen(bonus_paid=False)))
    for st_id in ("data_dave", "reliability_ruth"):
        assert with_pen.emotion_deltas[st_id]["fairness"] < base.emotion_deltas[st_id]["fairness"]


def test_pen_cost_is_charged_once(real):
    base = _evaluate(real, None)
    again = _evaluate(real, PitchState(pen=_pen(bonus_paid=True)))
    assert again.emotion_deltas["reliability_ruth"]["fairness"] == base.emotion_deltas["reliability_ruth"]["fairness"]
