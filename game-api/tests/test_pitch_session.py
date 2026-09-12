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


def test_correction_fires_on_the_players_tag_not_on_ground_truth(real):
    state = GraphState.from_config(real)
    truth = _item("d1", "data_dave", "driver", suggested=_target("data.labeling", 3))
    mis_filed = _item("d1", "data_dave", "driver", categorized_type="boundary",
                      suggested=_target("data.labeling", 3))

    # Ground truth alone carries no player tag, so nothing is mis-tagged.
    truth.categorized_type = None
    plain = session.objections_for(real, state, [truth], {"d1"}, ["data_dave"], authored={})
    assert [o.kind for o in plain if o.kind == "correction"] == []
    truth.categorized_type = IntelTag.DRIVER

    # The player's own copy says boundary where the item is a driver.
    filed = session.objections_for(
        real, state, [truth], {"d1"}, ["data_dave"], authored={}, held_items=[mis_filed]
    )
    assert [o.kind for o in filed if o.kind == "correction"] == ["correction"]


# ---------- the pitch as a state machine ----------

def _objection(kind="stance", st_id="data_dave", item_id="d1"):
    from mlops_serious_game.application.pitch_debate_service.objections import Objection
    return Objection(kind=kind, stakeholder_id=st_id, item_id=item_id, text="no")


def test_card_size_and_locking_are_enforced():
    state = session.start_pitch(["data_dave"])
    assert session.set_card(state, [])[1] == "a card holds 1 to 5 items"
    assert session.set_card(state, [f"i{i}" for i in range(6)])[1]

    ok, err = session.set_card(state, ["i1", "i2", "i2"], main_archetype="analyst")
    assert err is None and ok.card_item_ids == ["i1", "i2"] and ok.main_archetype == "analyst"

    objecting = session.open_objection_round(ok, [_objection()])
    assert session.set_card(objecting, ["i3"])[1] == "the card is locked once the room starts objecting"


def test_amend_puts_the_item_on_the_card_and_spends_budget():
    state = session.open_objection_round(session.start_pitch(["data_dave"]), [_objection()])
    obj_id = state.objections[0].id

    res = session.answer_objection(state, obj_id, "amend", 3, {"amend"}, item_id="d1")

    assert res.rejected is None and res.cleared
    assert res.state.card_item_ids == ["d1"]
    assert res.state.amendments_left == session.DEFAULT_MAX_AMENDMENTS - 1
    assert res.state.open_objections() == []


def test_an_option_the_menu_did_not_offer_is_refused():
    state = session.open_objection_round(session.start_pitch(["data_dave"]), [_objection()])
    res = session.answer_objection(state, state.objections[0].id, "amend", 3, {"stonewall"}, item_id="d1")
    assert res.rejected and res.state.card_item_ids == []


def test_stonewall_costs_emotion_with_one_side_and_gains_with_the_other():
    state = session.open_objection_round(session.start_pitch(["data_dave", "reliability_ruth"]), [_objection()])
    res = session.answer_objection(
        state, state.objections[0].id, "stonewall", 3, {"stonewall"}, opposing_st_id="reliability_ruth"
    )
    assert res.state.emotion_deltas["data_dave"] < 0 < res.state.emotion_deltas["reliability_ruth"]


def test_reframe_only_clears_a_stance_objection():
    state = session.open_objection_round(
        session.start_pitch(["data_dave"]), [_objection("stance"), _objection("boundary")]
    )
    soft = session.answer_objection(state, state.objections[0].id, "reframe", 3, {"reframe"})
    hard = session.answer_objection(state, state.objections[1].id, "reframe", 3, {"reframe"})
    assert soft.cleared is True
    assert hard.cleared is False


def test_the_addendum_needs_an_escalation_point():
    state = session.open_objection_round(session.start_pitch(["data_dave"]), [_objection()])
    broke = session.answer_objection(state, state.objections[0].id, "emergency_addendum", 0, {"emergency_addendum"})
    rich = session.answer_objection(state, state.objections[0].id, "emergency_addendum", 1, {"emergency_addendum"})
    assert broke.rejected == "no Escalation Points left"
    assert rich.spent_escalation_point and rich.state.emotion_deltas["data_dave"] < 0


def test_rebuild_costs_the_room_patience_and_reopens_the_card():
    room = ["data_dave", "reliability_ruth"]
    state = session.open_objection_round(session.start_pitch(room), [_objection()])
    rebuilt, _ = session.rebuild(state, room)

    assert rebuilt.stage == "PREPARE" and rebuilt.objections == []
    assert set(rebuilt.patience.values()) == {session.DEFAULT_PATIENCE - 1}
    assert session.set_card(rebuilt, ["a", "b"])[1] is None


def test_stalemate_only_when_patience_and_points_are_both_gone():
    room = [("data_dave", "high")]
    state = session.start_pitch(["data_dave"]).model_copy(update={"outcome": "VETO"})
    assert session.is_stalemate(state, room, escalation_points=1) is False
    out_of_patience = state.model_copy(update={"patience": {"data_dave": 0}})
    assert session.is_stalemate(out_of_patience, room, escalation_points=0) is True


def test_veto_breaker_pushes_the_card_through_at_a_price():
    state = session.start_pitch(["data_dave"]).model_copy(update={"outcome": "VETO"})
    res = session.veto_breaker(state, 1, ["data_dave"])
    assert res.state.outcome == "PASS" and res.state.stage == "DONE"
    assert res.state.patience["data_dave"] == 0
    assert res.state.emotion_deltas["data_dave"] <= session.EMOTION_VETO_BREAKER


def test_a_rebuild_has_to_change_two_items(real):
    assert session.rebuild_is_material({"a", "b", "c"}, {"a", "b", "d"}) is False
    assert session.rebuild_is_material({"a", "b", "c"}, {"a", "d", "e"}) is True


def test_the_round_shifts_stored_emotions_and_clamps_them():
    """What the player says in the objection round has to reach the score, not only the database."""
    stored = {"data_dave": {"trust": 0.5, "anger": 0.2}, "reliability_ruth": {"trust": 0.95, "anger": 0.9}}
    shifted = session.shift_emotions(stored, {"data_dave": -0.1, "reliability_ruth": 0.3})

    assert shifted["data_dave"] == {"trust": 0.4, "anger": 0.1}
    assert shifted["reliability_ruth"] == {"trust": 1.0, "anger": 1.0}
    assert session.shift_emotions(stored, {}) == stored


def test_a_stonewalled_stakeholder_reads_lower_before_the_card_is_committed(real):
    """Buy-in scored mid round has to move with the answers, or the dialogue decides nothing."""
    state = GraphState.from_config(real)
    room = [("data_dave", "high")]
    archetypes = {"data_dave": _arch()}
    stored = {"data_dave": {"trust": 0.6, "anger": 0.4}}

    calm = session.card_view(real, state, [], set(), room, archetypes, emotion_values=stored)
    angry = session.card_view(
        real, state, [], set(), room, archetypes,
        emotion_values=session.shift_emotions(stored, {"data_dave": session.EMOTION_STONEWALL}),
    )
    assert angry.reads[0].buy_in < calm.reads[0].buy_in
