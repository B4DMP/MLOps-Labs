"""Tests for the patience malus applied to stakeholder emotion values upon repeated Action Card presentations."""

from __future__ import annotations

import pytest

from mlops_serious_game.application.pitch_debate_service import session
from mlops_serious_game.domain.emotion import (
    PATIENCE_MALUS,
    apply_emotion_delta,
    get_patience_malus,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import GraphState, TechnicalGraph
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.requirement import StakeholderRequirement


def _item(item_id: str, st_id: str, kind: str, **kwargs) -> StakeholderRequirement:
    data = {
        "id": item_id,
        "stakeholder_id": st_id,
        "challenge_id": 0,
        "type": kind,
        "description": f"Requirement {item_id}",
        "atoms": [],
    }
    data.update(kwargs)
    return StakeholderRequirement.model_validate(data)


@pytest.fixture
def test_graph() -> TechnicalGraph:
    return GraphFactory.get_graph()


def test_patience_malus_structure():
    """Validates the patience malus default vector and factory function."""
    malus = get_patience_malus(0.05)
    assert malus["stress"] == 0.05
    assert malus["perceived_risk"] == 0.05
    assert malus["trust"] == -0.05
    assert malus["fairness"] == -0.05
    assert malus["sense_of_control"] == -0.05
    assert malus["confidence"] == -0.05
    assert malus["interest"] == -0.05

    # Check EmotionFactory method
    factory_malus = EmotionFactory.get_patience_malus()
    assert factory_malus == PATIENCE_MALUS


def test_evaluate_pitch_presentation_count_1_has_no_malus(test_graph):
    """The first presentation of an action card in a challenge incurs no patience malus."""
    state = GraphState.from_config(test_graph)
    item = _item("d1", "reliability_ruth", "driver", suggested={"target": "ops.alerting", "level": 3})
    room = [("reliability_ruth", "high")]
    emotions = {
        "reliability_ruth": {
            "fairness": 0.5,
            "trust": 0.5,
            "stress": 0.5,
            "confidence": 0.5,
            "perceived_risk": 0.5,
            "interest": 0.5,
            "sense_of_control": 0.5,
        }
    }
    changes = [session.AtomicChange(target="ops.alerting", kind="raise_to")]

    pitch_state_1, view_1, _ = session.evaluate_pitch(
        graph=test_graph,
        state=state,
        all_intel=[item],
        changes=changes,
        room=room,
        current_emotions=emotions,
        presentation_count=1,
    )

    pitch_state_2, view_2, _ = session.evaluate_pitch(
        graph=test_graph,
        state=state,
        all_intel=[item],
        changes=changes,
        room=room,
        current_emotions=emotions,
        presentation_count=2,
    )

    assert pitch_state_1.presentation_count == 1
    ruth_deltas_1 = pitch_state_1.emotion_deltas["reliability_ruth"]
    ruth_deltas_2 = pitch_state_2.emotion_deltas["reliability_ruth"]
    patience_delta = EmotionFactory.get_patience_malus()

    # Presentation 1 has no malus, presentation 2 has 1x malus
    for dim, malus_val in patience_delta.items():
        assert ruth_deltas_2[dim] == pytest.approx(ruth_deltas_1[dim] + malus_val, abs=1e-4)



def test_evaluate_pitch_repeat_presentations_apply_patience_malus(test_graph):
    """Repeated presentations (> 1) apply cumulative patience malus to all stakeholders."""
    state = GraphState.from_config(test_graph)
    item1 = _item("d1", "reliability_ruth", "driver", suggested={"target": "ops.alerting", "level": 3})
    item2 = _item("d2", "data_dave", "driver", suggested={"target": "data.validation", "level": 3})
    room = [("reliability_ruth", "high"), ("data_dave", "low")]
    emotions = {
        "reliability_ruth": {
            "fairness": 0.5,
            "trust": 0.5,
            "stress": 0.5,
            "confidence": 0.5,
            "perceived_risk": 0.5,
            "interest": 0.5,
            "sense_of_control": 0.5,
        },
        "data_dave": {
            "fairness": 0.5,
            "trust": 0.5,
            "stress": 0.5,
            "confidence": 0.5,
            "perceived_risk": 0.5,
            "interest": 0.5,
            "sense_of_control": 0.5,
        },
    }
    changes = [session.AtomicChange(target="ops.alerting", kind="raise_to")]

    # Attempt 1 (initial presentation)
    state_1, view_1, _ = session.evaluate_pitch(
        graph=test_graph,
        state=state,
        all_intel=[item1, item2],
        changes=changes,
        room=room,
        current_emotions=emotions,
        presentation_count=1,
    )

    # Attempt 2 (first repeat)
    state_2, view_2, _ = session.evaluate_pitch(
        graph=test_graph,
        state=state,
        all_intel=[item1, item2],
        changes=changes,
        room=room,
        current_emotions=emotions,
        presentation_count=2,
    )

    # Attempt 3 (second repeat)
    state_3, view_3, _ = session.evaluate_pitch(
        graph=test_graph,
        state=state,
        all_intel=[item1, item2],
        changes=changes,
        room=room,
        current_emotions=emotions,
        presentation_count=3,
    )

    assert state_2.presentation_count == 2
    assert state_3.presentation_count == 3

    patience_delta = EmotionFactory.get_patience_malus()

    for st_id in ["reliability_ruth", "data_dave"]:
        d1 = state_1.emotion_deltas[st_id]
        d2 = state_2.emotion_deltas[st_id]
        d3 = state_3.emotion_deltas[st_id]

        # In Attempt 2: 1x patience malus applied
        for dim, malus_val in patience_delta.items():
            assert d2[dim] == pytest.approx(d1[dim] + malus_val, abs=1e-4)

        # In Attempt 3: 2x patience malus applied
        for dim, malus_val in patience_delta.items():
            assert d3[dim] == pytest.approx(d1[dim] + 2 * malus_val, abs=1e-4)

        # Reads in CardView should reflect the degraded emotion values
        read_1 = next(r for r in view_1.reads if r.stakeholder_id == st_id)
        read_2 = next(r for r in view_2.reads if r.stakeholder_id == st_id)
        read_3 = next(r for r in view_3.reads if r.stakeholder_id == st_id)

        assert read_2.emotion_values["trust"] < read_1.emotion_values["trust"]
        assert read_2.emotion_values["stress"] > read_1.emotion_values["stress"]
        assert read_3.emotion_values["trust"] < read_2.emotion_values["trust"]
        assert read_3.emotion_values["stress"] > read_2.emotion_values["stress"]

        # Buy-in also reflects the drop in emotions
        assert read_3.buy_in <= read_2.buy_in <= read_1.buy_in


def test_clamping_with_extreme_patience_malus(test_graph):
    """Emotion values never exceed [0.0, 1.0] even after many repeated presentations."""
    state = GraphState.from_config(test_graph)
    item = _item("d1", "reliability_ruth", "driver", suggested={"target": "ops.alerting", "level": 3})
    room = [("reliability_ruth", "high")]
    emotions = {
        "reliability_ruth": {
            "fairness": 0.1,
            "trust": 0.1,
            "stress": 0.9,
            "confidence": 0.1,
            "perceived_risk": 0.9,
            "interest": 0.1,
            "sense_of_control": 0.1,
        }
    }
    changes = [session.AtomicChange(target="ops.alerting", kind="raise_to")]

    # 15 repeated presentations
    pitch_state, view, _ = session.evaluate_pitch(
        graph=test_graph,
        state=state,
        all_intel=[item],
        changes=changes,
        room=room,
        current_emotions=emotions,
        presentation_count=15,
    )

    read = view.reads[0]
    for dim, val in read.emotion_values.items():
        assert 0.0 <= val <= 1.0
