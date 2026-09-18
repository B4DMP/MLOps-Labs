"""Pitch phase orchestration tests on real graph under the redesign:
- Builder previews & boundary checks
- Trade-off branch derivation in card_ops
- evaluate_pitch with continuous demand alignment and feedback messages
- commit_pitch
"""

from conftest import (
    make_intel_item as _item,
    make_target as _target,
)
from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.pitch_debate_service import session
from mlops_serious_game.domain.graph import GraphOp, GraphState, Knowledge, SeenEntry


# ---------- builder previews & boundary checks ----------

def test_prediction_reports_the_cap_instead_of_the_asked_level(real):
    state = apply_ops(real, GraphState.from_config(real), [
        GraphOp(kind="set_to", target="data.validation", value=0)
    ]).state
    item = _item("i1", "data_dave", "driver", suggested=_target("data.versioning", 4))

    pred = session.predictions_for(real, state, [item])[0]

    assert pred.asked == 4
    assert pred.predicted < 4
    assert pred.capped_by
    assert session.capped_item_ids(real, state, [item]) == {"i1"}


def test_an_unobserved_target_predicts_nothing(real):
    state = GraphState.from_config(real)
    item = _item("i1", "data_dave", "driver", suggested=_target("model.registry", 3))

    blind = session.predictions_for(real, state, [item], knowledge=Knowledge())[0]
    seen = session.predictions_for(real, state, [item], knowledge=Knowledge(
        seen={"model.registry": SeenEntry(seq=99, nominal=1, effective=1)}
    ))[0]

    assert (blind.known, blind.predicted, blind.capped_by) == (False, None, None)
    assert seen.known and seen.predicted is not None


def test_boundary_is_checked_slotted_or_not(real):
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "op": "gte", "level": 3, "on": "nominal"},
    )
    raiser = _item("d1", "data_dave", "driver", suggested=_target("data.validation", 3))

    # Nothing slotted: the boundary already fails on the starting graph.
    assert [w.violated for w in session.boundary_checks(real, state, [boundary], [], ["reliability_ruth"])] == [True]
    # The raising item fixes it
    fixed = session.boundary_checks(real, state, [boundary, raiser], [raiser], ["reliability_ruth"])
    assert [w.violated for w in fixed] == [False]


def test_boundary_on_an_unknown_target_is_reported_as_uncheckable(real):
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        suggested=_target("data.validation", 3),
        holds={"component": "data.validation", "op": "gte", "level": 3},
    )
    w = session.boundary_checks(real, state, [boundary], [], ["reliability_ruth"], knowledge=Knowledge())[0]
    assert (w.checkable, w.violated) == (False, False)


def test_trade_off_branch_ops_derivation():
    # Item with branch_x and branch_y
    trade_off = _item(
        "t1", "data_dave", "trade_off",
        branch_x={"target": "data.ingestion", "level": 3},
        branch_y={"target": "data.validation", "level": 3},
    )
    ops_x = session.card_ops([trade_off], trade_off_branches={"t1": "X"})
    assert len(ops_x) == 1
    assert ops_x[0].target == "data.ingestion"

    ops_y = session.card_ops([trade_off], trade_off_branches={"t1": "Y"})
    assert len(ops_y) == 1
    assert ops_y[0].target == "data.validation"


# ---------- evaluate_pitch & commit_pitch ----------

def test_evaluate_pitch_detects_misclassification_and_returns_refutation(real):
    state = GraphState.from_config(real)
    # Ground truth is trade_off, but player categorized as driver
    item = _item(
        "t1", "data_dave", "trade_off",
        categorized_type="driver",
        branch_x={"target": "data.ingestion", "level": 3},
        branch_y={"target": "data.validation", "level": 3},
    )
    room = [("data_dave", "high")]
    emotions = {"data_dave": {"fairness": 0.5, "trust": 0.5, "stress": 0.5, "confidence": 0.5, "perceived_risk": 0.5, "interest": 0.5, "sense_of_control": 0.5}}

    pitch_state, view, to_correct = session.evaluate_pitch(
        graph=real,
        state=state,
        all_intel=[item],
        card_item_ids={"t1"},
        room=room,
        current_emotions=emotions,
        trade_off_branches={"t1": "X"},
        held_items=[item],
        names={"data_dave": "Dave"},
    )

    assert "t1" in to_correct
    assert any(m.kind == "refutation" for m in pitch_state.feedback_messages)
    pitch_state_correct, _, _ = session.evaluate_pitch(
        graph=real,
        state=state,
        all_intel=[item],
        card_item_ids={"t1"},
        room=room,
        current_emotions=emotions,
        trade_off_branches={"t1": "X"},
        held_items=[_item("t1", "data_dave", "trade_off", categorized_type="trade_off", branch_x={"target": "data.ingestion", "level": 3})],
        names={"data_dave": "Dave"},
    )
    deltas = pitch_state.emotion_deltas.get("data_dave", {})
    deltas_correct = pitch_state_correct.emotion_deltas.get("data_dave", {})
    assert deltas["fairness"] < deltas_correct["fairness"]


def test_evaluate_pitch_detects_boundary_violation(real):
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "op": "gte", "level": 3, "on": "nominal"},
    )
    room = [("reliability_ruth", "high")]
    emotions = {"reliability_ruth": {"fairness": 0.5, "trust": 0.5, "stress": 0.5, "confidence": 0.5, "perceived_risk": 0.5, "interest": 0.5, "sense_of_control": 0.5}}

    pitch_state, view, _ = session.evaluate_pitch(
        graph=real,
        state=state,
        all_intel=[boundary],
        card_item_ids=set(),
        room=room,
        current_emotions=emotions,
        held_items=[boundary],
        names={"reliability_ruth": "Ruth"},
    )

    assert any(o.kind == "boundary" for o in pitch_state.objections)
    assert view.outcome == "VETO"


def test_commit_pitch_locks_stage_and_events():
    state = session.PitchState(card_item_ids=["d1"], stage="PITCHED")
    view = session.CardView(outcome="PASS")

    committed, events = session.commit_pitch(state, view)
    assert committed.stage == "DONE"
    assert committed.outcome == "PASS"
    assert len(events) == 1
    assert events[0].cause == "outcome.pass"
