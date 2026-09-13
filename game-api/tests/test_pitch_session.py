"""Pitch phase orchestration on the real graph (plan 06): builder previews, objections, outcome."""

from conftest import (
    make_archetype as _arch,
    make_concession as _concedes,
    make_intel_item as _item,
    make_target as _target,
)
from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.pitch_debate_service import session
from mlops_serious_game.domain.graph import GraphOp, GraphState, Knowledge, SeenEntry
from mlops_serious_game.domain.requirement import IntelTag


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


def test_a_pure_boundary_with_no_suggested_still_gets_a_fog_target_from_holds(real):
    """A Boundary authored with only `holds` (no `suggested`/`ops` duplicating its component) must
    still resolve a fog target via session._boundary_target's fallback to `holds.component` —
    otherwise its target is None, the unknown-target branch above never triggers, and a true
    violation on a component the player has never observed leaks straight through (D11)."""
    state = GraphState.from_config(real)
    boundary = _item(
        "b1", "reliability_ruth", "boundary",
        holds={"component": "data.validation", "op": "gte", "level": 3},
    )
    w = session.boundary_checks(real, state, [boundary], [], ["reliability_ruth"], knowledge=Knowledge())[0]
    assert (w.target, w.checkable, w.violated) == ("data.validation", False, False)


def test_the_builder_only_names_boundaries_the_player_holds_and_filed_as_boundaries(real):
    """A line the player never found, or filed as something else, must not be revealed by the
    builder's warnings. The outcome still counts it; only the screen stays quiet."""
    state = GraphState.from_config(real)
    holds = {"component": "data.validation", "op": "gte", "level": 3, "on": "nominal"}
    found = _item("b1", "reliability_ruth", "boundary", holds=holds)
    unfound = _item("b2", "data_dave", "boundary", holds=holds)
    misfiled = _item("b3", "reliability_ruth", "boundary", categorized_type="driver", holds=holds)
    room = ["reliability_ruth", "data_dave"]

    warnings = session.boundary_checks(real, state, [found, unfound, misfiled], [], room)
    assert len(warnings) == 3  # ground truth is untouched

    shown = session.player_boundary_warnings(real, warnings, held=[found, misfiled])

    assert [w.item_id for w in shown] == ["b1"]
    assert shown[0].target_name == real.component("data.validation").name
    assert shown[0].line == "desc:b1"


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
                  concedes=_concedes(loss=4, target="data.labeling"))
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


def test_concede_correction_marks_the_item_conceded_and_costs_a_little_emotion():
    state = session.open_objection_round(
        session.start_pitch(["data_dave"]), [_objection("correction", item_id="d1")]
    )
    res = session.answer_objection(state, state.objections[0].id, "concede_correction", 3, {"concede_correction"})
    assert res.cleared is True
    assert res.state.conceded_item_ids == ["d1"]
    assert res.state.emotion_deltas["data_dave"] < 0


def test_the_addendum_needs_an_escalation_point():
    state = session.open_objection_round(session.start_pitch(["data_dave"]), [_objection()])
    broke = session.answer_objection(state, state.objections[0].id, "emergency_addendum", 0, {"emergency_addendum"})
    rich = session.answer_objection(state, state.objections[0].id, "emergency_addendum", 1, {"emergency_addendum"})
    assert broke.rejected == "no Escalation Points left"
    assert rich.spent_escalation_point and rich.state.emotion_deltas["data_dave"] < 0


def test_rebuild_costs_the_room_patience_and_reopens_the_card():
    room = ["data_dave", "reliability_ruth"]
    state = session.open_objection_round(session.start_pitch(room), [_objection()])
    rebuilt, _, events = session.rebuild(state, room)
    assert [e.cause for e in events] == ["patience.rebuild", "patience.rebuild"]

    assert rebuilt.stage == "PREPARE" and rebuilt.objections == []
    assert set(rebuilt.patience.values()) == {session.DEFAULT_PATIENCE - 1}
    assert session.set_card(rebuilt, ["a", "b"])[1] is None


def test_stalemate_only_when_patience_and_points_are_both_gone():
    room = [("data_dave", "high")]
    state = session.start_pitch(["data_dave"]).model_copy(update={"outcome": "VETO"})
    assert session.is_stalemate(state, room, escalation_points=1) is False
    out_of_patience = state.model_copy(update={"patience": {"data_dave": 0}})
    assert session.is_stalemate(out_of_patience, room, escalation_points=0) is True


def test_stalemate_needs_a_high_power_stakeholder_out_of_patience():
    """A low power holdout run out of patience does not end the challenge (docstring on is_stalemate)."""
    room = [("data_dave", "low")]
    state = session.start_pitch(["data_dave"]).model_copy(
        update={"outcome": "VETO", "patience": {"data_dave": 0}}
    )
    assert session.is_stalemate(state, room, escalation_points=0) is False


def test_veto_breaker_pushes_the_card_through_at_a_price():
    state = session.start_pitch(["data_dave"]).model_copy(update={"outcome": "VETO"})
    res = session.veto_breaker(state, 1, ["data_dave"])
    assert res.state.outcome == "PASS" and res.state.stage == "DONE"
    assert res.state.patience["data_dave"] == 0
    assert res.state.emotion_deltas["data_dave"] <= session.EMOTION_VETO_BREAKER


def test_concede_lets_the_opposing_position_win_at_a_price():
    """D41 'Let them have it': the winning side gains, whoever's card was dropped loses, no cost paid."""
    state = session.start_pitch(["data_dave", "reliability_ruth"]).model_copy(update={"outcome": "VETO"})
    updated, events = session.concede_pitch(state, winning_st_id="reliability_ruth", losing_st_ids=["data_dave"])
    assert updated.stage == "DONE" and updated.outcome == "CONCEDED"
    assert updated.emotion_deltas["reliability_ruth"] == session.EMOTION_CONCEDE_WIN
    assert updated.emotion_deltas["data_dave"] == session.EMOTION_CONCEDE_LOSE
    assert {e.cause for e in events} == {"emotion.concede_win", "emotion.concede_lose", "outcome.conceded"}


# ---------- Reframe: Hit / Partial / Miss and the room listening (D48, plan 11) ----------

def test_reframe_hit_clears_a_stance_objection_and_warms_the_room():
    state = session.open_objection_round(session.start_pitch(["data_dave"]), [_objection("stance")])
    close = _arch(2, 2, 2)
    reframe = session.ReframeContext(chosen=close, stakeholder_archetype=close, room=[])

    res = session.answer_objection(state, state.objections[0].id, "reframe", 3, {"reframe"}, reframe=reframe)

    assert res.reframe_result == "hit"
    assert res.cleared is True
    assert res.state.emotion_deltas["data_dave"] > 0
    assert res.state.hardened_item_ids == []
    assert [e.cause for e in res.events] == ["emotion.reframe_hit"]


def test_reframe_miss_hardens_the_item_so_only_amend_clears_it_next_time():
    state = session.open_objection_round(session.start_pitch(["data_dave"]), [_objection("stance", item_id="d1")])
    far = _arch(0, 0, 0)
    reframe = session.ReframeContext(chosen=_arch(5, 5, 5), stakeholder_archetype=far, room=[])

    res = session.answer_objection(state, state.objections[0].id, "reframe", 3, {"reframe"}, reframe=reframe)

    assert res.reframe_result == "miss"
    assert res.cleared is False
    assert res.state.emotion_deltas["data_dave"] < 0
    assert res.state.hardened_item_ids == ["d1"]
    assert [e.cause for e in res.events] == ["emotion.reframe_miss"]

    # Hardened: even with a perfect archetype next time, Reframe is no longer on the menu.
    reopened = session.open_objection_round(res.state, [_objection("stance", item_id="d1")])
    opts = {
        o.option: o for o in session.options_for(
            reopened.objections[0], [], set(), 3, 3, frozenset(reopened.hardened_item_ids)
        )
    }
    assert opts["reframe"].available is False


def test_reframe_partial_clears_stance_with_no_emotion_change():
    # distance = (2+2+2)/15 = 0.4 -> fit = 0.6, inside [reframe_partial=0.4, reframe_hit=0.7).
    state = session.open_objection_round(session.start_pitch(["data_dave"]), [_objection("stance")])
    reframe = session.ReframeContext(chosen=_arch(2, 2, 2), stakeholder_archetype=_arch(4, 4, 4), room=[])

    res = session.answer_objection(state, state.objections[0].id, "reframe", 3, {"reframe"}, reframe=reframe)

    assert res.reframe_result == "partial"
    assert res.cleared is True
    assert res.state.emotion_deltas == {}
    assert res.events == []


def test_reframe_room_listening_turns_other_high_power_seats_colder():
    """Q37: a Reframe moves emotion by hit/partial/miss on every objection kind, and the room's
    other high-power stakeholders react to the framing itself, even on a boundary objection."""
    state = session.open_objection_round(session.start_pitch(["data_dave", "reliability_ruth"]), [_objection("boundary")])
    chosen = _arch(5, 5, 5)
    far = _arch(0, 0, 0)
    reframe = session.ReframeContext(
        chosen=chosen, stakeholder_archetype=chosen,
        room=[("data_dave", "high", chosen), ("reliability_ruth", "high", far)],
    )

    res = session.answer_objection(state, state.objections[0].id, "reframe", 3, {"reframe"}, reframe=reframe)

    assert res.cleared is False  # a boundary objection never clears via Reframe
    assert res.reframe_result == "hit"
    assert res.state.emotion_deltas["data_dave"] > 0
    assert res.state.emotion_deltas["reliability_ruth"] < 0
    causes = {e.cause for e in res.events}
    assert causes == {"emotion.reframe_hit", "emotion.room_listening"}


def test_opener_archetypes_dedupes_the_players_own_guesses_in_room_order():
    assert session.opener_archetypes({}) == []
    assert session.opener_archetypes({
        "data_dave": "analyst", "reliability_ruth": "skeptic", "model_monica": "analyst",
    }) == ["analyst", "skeptic"]
    # A stakeholder with no guess yet just contributes nothing.
    assert session.opener_archetypes({"data_dave": "analyst", "reliability_ruth": None}) == ["analyst"]


def test_sound_out_available_only_above_the_last_point():
    assert session.sound_out_available(3) is True
    assert session.sound_out_available(2) is True
    assert session.sound_out_available(1) is False
    assert session.sound_out_available(0) is False


def test_sound_out_reply_reads_off_band_and_boundary():
    green = session.StakeholderRead(
        stakeholder_id="d1", power="high", coverage=1, loss=0, fit=1, emotions=1, buy_in=0.9, band="green",
    )
    amber = green.model_copy(update={"band": "amber", "buy_in": 0.5})
    red = green.model_copy(update={"band": "red", "buy_in": 0.1})
    violated = green.model_copy(update={"boundary_violated": True})

    assert session.sound_out_reply(green) == "on_board"
    assert session.sound_out_reply(amber) == "lukewarm"
    assert session.sound_out_reply(red) == "would_object"
    assert session.sound_out_reply(violated) == "would_object"


def test_sound_out_spends_one_patience_and_logs_both_the_cost_and_the_reply():
    state = session.start_pitch(["data_dave"])
    read = session.StakeholderRead(
        stakeholder_id="data_dave", power="high", coverage=0.2, loss=0, fit=0.5, emotions=0.5,
        buy_in=0.2, band="red",
    )
    updated, reply, events = session.sound_out(state, "data_dave", read, objection_kind="stance", names={"data_dave": "Data Dave"})

    assert reply == "would_object"
    assert updated.patience["data_dave"] == session.DEFAULT_PATIENCE - 1
    assert [e.cause for e in events] == ["patience.sound_out", "objection.sound_out_would_object_kind"]
    assert events[1].params == {"st": "Data Dave", "kind": "stance"}


def test_sound_out_causes_all_render():
    """The dict-keyed cause lookup in `session.sound_out` isn't caught by the `cause="..."`
    literal scan `missing_causes` runs (test_event_log.py), so render each one directly here."""
    from mlops_serious_game.domain.event_causes import EventCauseFactory

    assert EventCauseFactory.render("patience.sound_out", {"st": "Data Dave"})
    assert EventCauseFactory.render("objection.sound_out_on_board", {"st": "Data Dave"})
    assert EventCauseFactory.render("objection.sound_out_lukewarm", {"st": "Data Dave"})
    assert EventCauseFactory.render("objection.sound_out_would_object", {"st": "Data Dave"})
    assert EventCauseFactory.render("objection.sound_out_would_object_kind", {"st": "Data Dave", "kind": "stance"})


def test_sound_out_never_drops_patience_below_zero():
    state = session.start_pitch(["data_dave"]).model_copy(update={"patience": {"data_dave": 0}})
    read = session.StakeholderRead(
        stakeholder_id="data_dave", power="high", coverage=1, loss=0, fit=1, emotions=1, buy_in=0.9, band="green",
    )
    updated, reply, _ = session.sound_out(state, "data_dave", read)
    assert updated.patience["data_dave"] == 0
    assert reply == "on_board"


def test_default_patience_is_three():
    assert session.DEFAULT_PATIENCE == 3
    state = session.start_pitch(["data_dave"])
    assert state.patience["data_dave"] == 3
    assert state.patience_word("data_dave") == "full"
    assert state.model_copy(update={"patience": {"data_dave": 1}}).patience_word("data_dave") == "impatient"
    assert state.model_copy(update={"patience": {"data_dave": 0}}).patience_word("data_dave") == "at their limit"


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
