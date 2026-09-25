"""Pitch phase orchestration tests on real graph under the redesign:
- Builder previews & boundary checks
- Trade-off branch derivation in card_ops
- evaluate_pitch with continuous demand alignment and feedback messages
- commit_pitch
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

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
        GraphOp(kind="set_to", target="data.validation", axis="automation", value=0)
    ]).state
    item = _item("i1", "data_dave", "driver", suggested=_target("data.versioning", 3, axis="automation"))

    pred = session.predictions_for(real, state, [item])[0]

    assert pred.asked == 3
    assert pred.predicted < 3
    assert pred.capped_by
    assert session.capped_item_ids(real, state, [item]) == {"i1"}


def test_an_unobserved_target_predicts_nothing(real):
    state = GraphState.from_config(real)
    item = _item("i1", "data_dave", "driver", suggested=_target("model.registry", 3))

    blind = session.predictions_for(real, state, [item], knowledge=Knowledge())[0]
    seen = session.predictions_for(real, state, [item], knowledge=Knowledge(
        seen={"model.registry": SeenEntry(
            seq=99, nominal_automation=1, nominal_governance=0, effective_automation=1, effective_governance=0
        )}
    ))[0]

    assert (blind.known, blind.predicted, blind.capped_by) == (False, None, None)
    assert seen.known and seen.predicted is not None


def test_find_pipeline_predecessors_is_repeatable_in_process(real):
    """`find_pipeline_predecessors` must return the same order every time it's called with the
    same graph and target: `predictions_for` reports its result verbatim as
    `upstream_uncertain_nodes`, and a caller diffing two calls (or a test asserting on the exact
    list) must not see it reshuffle."""
    state = GraphState.from_config(real)
    first = session.find_pipeline_predecessors(real, "deploy.shadow")
    for _ in range(20):
        assert session.find_pipeline_predecessors(real, "deploy.shadow") == first


def test_find_pipeline_predecessors_order_is_stable_across_processes():
    """Regression for a hash-order bug (ch118, `deploy.shadow`): `find_pipeline_predecessors`
    used to build its result as a `set` and return `list(that_set)`. Set iteration order for
    `str` keys depends on Python's per-process hash randomization (`PYTHONHASHSEED`), so the same
    graph and target produced a different `upstream_uncertain_nodes` order - and, worse, a
    different first/blocking node wherever a caller relied on that order - on every fresh
    process, even with no code or data change between runs. Confirmed by running this exact
    scenario 8x in a row inside the `api` container. Fixed by returning the BFS visitation order
    directly instead of routing it through a set. This spawns several real subprocesses with
    different explicit `PYTHONHASHSEED` values - only that reproduces the bug, since hash seed is
    fixed for the lifetime of one process and an in-process repeat can't catch it.
    """
    config_candidates = [
        Path("/gameConfig"),
        Path(__file__).resolve().parent.parent.parent / "gameConfig",
        Path(__file__).resolve().parent.parent / "gameConfig",
    ]
    config_dir = next((c for c in config_candidates if (c / "MlopsGraph.json").exists()), None)
    if config_dir is None:
        pytest.skip("gameConfig not found")

    script = (
        "from mlops_serious_game.domain.graph_factory import GraphFactory\n"
        "from mlops_serious_game.application.pitch_debate_service.session import find_pipeline_predecessors\n"
        "import pathlib\n"
        f"graph = GraphFactory.load_graph(pathlib.Path({str(config_dir / 'MlopsGraph.json')!r}))\n"
        "print(','.join(find_pipeline_predecessors(graph, 'deploy.shadow')))\n"
    )

    results = []
    for seed in ("0", "1", "2", "42", "1337"):
        proc = subprocess.run(
            [sys.executable, "-c", script],
            env={**os.environ, "PYTHONHASHSEED": seed},
            capture_output=True, text=True, timeout=60,
        )
        assert proc.returncode == 0, proc.stderr
        results.append(proc.stdout.strip())

    assert len(set(results)) == 1, f"predecessor order varies by PYTHONHASHSEED: {results}"


def test_boundary_is_checked_slotted_or_not(real):
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "axis": "automation", "op": "gte", "level": 2, "on": "nominal"},
    )
    # data.validation starts absent(1): one legal single-step raise reaches manual(2).
    raiser = _item("d1", "data_dave", "driver", suggested=_target("data.validation", 2))

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
        branch_x={"target": "data.ingestion", "axis": "automation", "level": 3},
        branch_y={"target": "data.validation", "axis": "automation", "level": 3},
    )
    ops_x = session.card_ops([trade_off], trade_off_branches={"t1": "X"})
    assert len(ops_x) == 1
    assert ops_x[0].target == "data.ingestion"

    ops_y = session.card_ops([trade_off], trade_off_branches={"t1": "Y"})
    assert len(ops_y) == 1
    assert ops_y[0].target == "data.validation"


def test_card_ops_puts_automation_before_governance_regardless_of_item_order():
    """A governance raise is rejected outright on a target that isn't implemented yet
    (apply.py's `_apply_one`), and `replay` re-derives ground truth from these same logged ops
    with no lookahead - so whichever order the room's items happen to list a target's automation
    and governance asks in (here, deliberately governance first), the ops built from them must
    still put automation first."""
    ask_governance = _item("g1", "requirements_reuben", "driver", suggested=_target("data.validation", 3, axis="governance"))
    ask_automation = _item("a1", "reliability_ruth", "driver", suggested=_target("data.validation", 2, axis="automation"))
    ops = session.card_ops([ask_governance, ask_automation])
    assert [(op.axis, op.value) for op in ops] == [("automation", 2), ("governance", 3)]


def test_atomic_changes_to_ops_puts_automation_before_governance_regardless_of_change_order(real):
    """Same guarantee, from the composer's own AtomicChange list rather than accepted items -
    the player can still queue a target's governance step before its automation step in the
    array (the ladder disallows it live, but a stale/replayed proposal shouldn't rely on that)."""
    from mlops_serious_game.application.pitch_debate_service.session import AtomicChange

    state = GraphState.from_config(real)
    changes = [
        AtomicChange(target="data.validation", kind="raise_to", axis="governance", value=3),
        AtomicChange(target="data.validation", kind="raise_to", axis="automation", value=2),
    ]
    ops = session.atomic_changes_to_ops(real, state, changes)
    assert [(op.axis, op.value) for op in ops] == [("automation", 2), ("governance", 3)]


# ---------- evaluate_pitch & commit_pitch ----------

def test_evaluate_pitch_detects_misclassification_and_returns_refutation(real):
    state = GraphState.from_config(real)
    # Ground truth is trade_off, but player categorized as driver
    item = _item(
        "t1", "data_dave", "trade_off",
        categorized_type="driver",
        branch_x={"target": "data.ingestion", "axis": "automation", "level": 3},
        branch_y={"target": "data.validation", "axis": "automation", "level": 3},
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
        held_items=[_item("t1", "data_dave", "trade_off", categorized_type="trade_off", branch_x={"target": "data.ingestion", "axis": "automation", "level": 3})],
        names={"data_dave": "Dave"},
    )
    deltas = pitch_state.emotion_deltas.get("data_dave", {})
    deltas_correct = pitch_state_correct.emotion_deltas.get("data_dave", {})
    assert deltas["fairness"] < deltas_correct["fairness"]


def test_evaluate_pitch_detects_boundary_violation(real):
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "axis": "automation", "op": "gte", "level": 3, "on": "nominal"},
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


def test_agreeing_stakeholder_receives_positive_emotions(real):
    state = GraphState.from_config(real)
    driver = _item(
        "d1", "data_dave", "driver",
        categorized_type="driver",
        suggested=_target("data.validation", 3),
    )
    room = [("data_dave", "high")]
    emotions = {"data_dave": {"fairness": 0.5, "trust": 0.5, "stress": 0.5, "confidence": 0.5, "perceived_risk": 0.5, "interest": 0.5, "sense_of_control": 0.5}}

    pitch_state, view, to_correct = session.evaluate_pitch(
        graph=real,
        state=state,
        all_intel=[driver],
        card_item_ids={"d1"},
        room=room,
        current_emotions=emotions,
        held_items=[driver],
        names={"data_dave": "Dave"},
    )

    # Must have approval feedback message
    assert any(m.kind == "approval" for m in pitch_state.feedback_messages)
    assert not pitch_state.objections
    assert view.outcome == "PASS"

    # Must receive positive emotion changes
    deltas = pitch_state.emotion_deltas.get("data_dave", {})
    assert deltas["fairness"] > 0
    assert deltas["trust"] > 0
    assert deltas["confidence"] > 0
    assert deltas["sense_of_control"] > 0
    assert deltas["stress"] < 0  # stress relieved
    assert deltas["perceived_risk"] < 0  # perceived risk lowered


def test_edge_editing_and_trigger_in_atomic_changes(real):
    state = GraphState.from_config(real)
    edge_change = session.AtomicChange(
        target="e.ingest_validate",
        kind="raise_to",
        axis="automation",
        value=3,
        trigger="on_data_arrival",
    )
    ops = session.atomic_changes_to_ops(real, state, [edge_change])
    assert len(ops) == 2
    assert ops[0].kind == "raise_to" and ops[0].target == "e.ingest_validate" and ops[0].value == 3
    assert ops[1].kind == "set_trigger" and ops[1].target == "e.ingest_validate" and ops[1].value == "on_data_arrival"

    after = session.predicted_state(real, state, [edge_change])
    assert after.value("e.ingest_validate", "automation") == 3
    assert after.edge_triggers.get("e.ingest_validate") == "on_data_arrival"

