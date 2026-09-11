"""Pitch phase orchestration on the real graph (plan 06): builder previews, objections, outcome."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.pitch_debate_service import session
from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype
from mlops_serious_game.domain.graph import GraphOp, GraphState, Knowledge, SeenEntry
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.pattern import PatternFactory
from mlops_serious_game.domain.requirement import IntelTag


def _config_dir() -> Path:
    for candidate in (Path(__file__).resolve().parents[2] / "gameConfig", Path("/gameConfig")):
        if (candidate / "MlopsPatterns.json").exists():
            return candidate
    pytest.skip("gameConfig not found")


@pytest.fixture(scope="module")
def real():
    config = _config_dir()
    graph = GraphFactory.load_graph(config / "MlopsGraph.json")
    PatternFactory.load(config / "MlopsPatterns.json", graph)
    return graph


def _item(id, stakeholder_id, tag, **kw):
    """Minimal intel item: the orchestration only reads ids, tags and payloads."""
    ns = SimpleNamespace(
        id=id,
        stakeholder_id=stakeholder_id,
        type=IntelTag(tag),
        categorized_type=IntelTag(kw.pop("categorized_type", tag)),
        metric_id=kw.pop("metric_id", None),
        suggested=kw.pop("suggested", None),
        holds=kw.pop("holds", None),
        ops=kw.pop("ops", []),
        concedes=kw.pop("concedes", None),
        asserts=kw.pop("asserts", None),
        description=f"desc:{id}",
    )
    ns.is_correct_intel = lambda: ns.type == ns.categorized_type
    return ns


def _target(target, level):
    return SimpleNamespace(target=target, level=level)


def _arch(evidence_basis=2, risk_and_control=2, value_horizon=2):
    return ConvincerArchetype(
        name="test", evidence_basis=evidence_basis,
        risk_and_control=risk_and_control, value_horizon=value_horizon,
    )


# ---------- builder previews ----------

def test_prediction_reports_the_cap_instead_of_the_asked_level(real):
    # Validation is down, so raising the step behind it cannot pay off yet.
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
    # Read on nominal: what the card sets, not what upstream lets it run at.
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "op": "gte", "level": 3, "on": "nominal"},
    )
    raiser = _item("d1", "data_dave", "driver", suggested=_target("data.validation", 3))

    # Nothing slotted: the boundary already fails on the starting graph.
    assert [w.violated for w in session.boundary_checks(real, state, [boundary], [], ["reliability_ruth"])] == [True]
    # The raising item fixes it, and it is checked even though the boundary itself is not slotted.
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


# ---------- objections ----------

def test_objections_fire_for_uncovered_drivers_and_violated_boundaries(real):
    state = GraphState.from_config(real)
    all_intel = [
        _item("d1", "data_dave", "driver", suggested=_target("data.labeling", 3)),
        _item("b1", "reliability_ruth", "boundary",
              holds={"component": "data.validation", "op": "gte", "level": 3}),
    ]

    objs = session.objections_for(real, state, all_intel, set(), ["data_dave", "reliability_ruth"], authored={})
    kinds = {(o.kind, o.stakeholder_id) for o in objs}

    assert ("stance", "data_dave") in kinds
    assert ("boundary", "reliability_ruth") in kinds
    assert all(o.text for o in objs)


def test_amend_needs_a_held_item_that_answers_the_objection(real):
    state = GraphState.from_config(real)
    driver = _item("d1", "data_dave", "driver", suggested=_target("data.labeling", 3))
    other = _item("d2", "model_monica", "driver", suggested=_target("model.registry", 3))
    objs = session.objections_for(real, state, [driver], set(), ["data_dave"], authored={})
    stance = next(o for o in objs if o.kind == "stance")

    # Someone else's Driver does not answer Dave's objection; his own does.
    assert session.answering_item_ids(stance, [other], set()) == set()
    assert session.answering_item_ids(stance, [driver], set()) == {"d1"}

    without = {o.option: o for o in session.options_for(stance, [other], set(), 3, 3)}
    assert without["amend"].available is False
    assert "no matching intel item" in without["amend"].reason
    with_item = {o.option: o for o in session.options_for(stance, [driver], set(), 3, 3)}
    assert with_item["amend"].available is True


def test_a_full_card_blocks_amend_and_the_addendum(real):
    state = GraphState.from_config(real)
    driver = _item("d1", "data_dave", "driver", suggested=_target("data.labeling", 3))
    objs = session.objections_for(real, state, [driver], set(), ["data_dave"], authored={})
    stance = next(o for o in objs if o.kind == "stance")

    full = {f"x{i}" for i in range(session.MAX_CARD_ITEMS)}
    opts = {o.option: o for o in session.options_for(stance, [driver], full, 3, 3)}
    assert opts["amend"].available is False and "card is full" in opts["amend"].reason
    assert opts["emergency_addendum"].available is False


# ---------- outcome ----------

def test_covering_the_room_turns_a_veto_into_a_pass(real):
    state = GraphState.from_config(real)
    dave = _item("d1", "data_dave", "driver", metric_id="data", suggested=_target("data.labeling", 3))
    monica = _item("d2", "model_monica", "driver", metric_id="model", suggested=_target("model.registry", 3))
    all_intel = [dave, monica]
    room = [("data_dave", "high"), ("model_monica", "low")]
    archetypes = {"data_dave": _arch(), "model_monica": _arch()}

    empty = session.card_view(real, state, all_intel, set(), room, archetypes, main_archetype=_arch())
    full = session.card_view(real, state, all_intel, {"d1", "d2"}, room, archetypes, main_archetype=_arch())

    assert empty.outcome == "VETO"
    assert full.outcome == "PASS"
    assert [r.band for r in full.reads] == ["green", "green"]


def test_a_violated_boundary_of_a_high_power_stakeholder_vetoes(real):
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "op": "gte", "level": 3},
    )
    room = [("reliability_ruth", "high")]
    view = session.card_view(real, state, [boundary], set(), room, {"reliability_ruth": _arch()})

    assert view.reads[0].boundary_violated is True
    assert view.outcome == "VETO"


def test_an_unslotted_trade_off_costs_buy_in(real):
    state = GraphState.from_config(real)
    trade = _item("t1", "efficiency_emilia", "trade_off",
                  concedes=SimpleNamespace(loss=4, target="data.labeling"))
    room = [("efficiency_emilia", "low")]
    archetypes = {"efficiency_emilia": _arch()}

    without = session.card_view(real, state, [trade], set(), room, archetypes)
    with_it = session.card_view(real, state, [trade], {"t1"}, room, archetypes)

    assert without.uncompensated_losses["efficiency_emilia"] > 0
    assert with_it.uncompensated_losses["efficiency_emilia"] == 0
    assert with_it.reads[0].buy_in > without.reads[0].buy_in


def test_a_rebuild_has_to_change_two_items(real):
    assert session.rebuild_is_material({"a", "b", "c"}, {"a", "b", "d"}) is False
    assert session.rebuild_is_material({"a", "b", "c"}, {"a", "d", "e"}) is True
