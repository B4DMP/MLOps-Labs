"""Tests for scoring.py and objections.py (plan 06)."""

from __future__ import annotations

import pytest

from conftest import make_archetype as _arch, make_concession as _concedes, make_intel_item as _item


# ---------------------------------------------------------------------------
# fit()
# ---------------------------------------------------------------------------

class TestFit:
    def test_perfect_match(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import fit
        arch = _arch(2, 3, 4)
        assert fit(arch, arch) == pytest.approx(1.0)

    def test_max_distance(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import fit
        st = _arch(0, 0, 0)
        chosen = _arch(5, 5, 5)
        assert fit(st, chosen) == pytest.approx(0.0)

    def test_no_archetype_returns_neutral(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import fit
        st = _arch(2, 2, 2)
        assert fit(st, None) == pytest.approx(0.5)

    def test_secondary_used_when_closer(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import fit, SECONDARY_MALUS
        st = _arch(0, 0, 0)
        main = _arch(5, 5, 5)    # very far
        secondary = _arch(0, 0, 1)  # close
        result = fit(st, main, secondary)
        # secondary distance = mean(0,0,1)/5 + SECONDARY_MALUS ≈ 0.067 + 0.15 = 0.217
        # main distance = 1.0 → fit(main) = 0
        # fit = 1 - min(1.0, 0.217) = 0.783
        assert result > fit(st, main)
        assert result == pytest.approx(1 - (1 / 15 + SECONDARY_MALUS), abs=1e-6)


# ---------------------------------------------------------------------------
# coverage()
# ---------------------------------------------------------------------------

class TestCoverage:
    def test_no_drivers_is_full_coverage(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import coverage
        items = [_item("b1", "st1", "boundary")]
        assert coverage("st1", items, set()) == pytest.approx(1.0)

    def test_all_slotted(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import coverage
        items = [_item("d1", "st1", "driver"), _item("d2", "st1", "driver")]
        assert coverage("st1", items, {"d1", "d2"}) == pytest.approx(1.0)

    def test_partial_by_metric(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import coverage
        items = [
            _item("d1", "st1", "driver", metric_id="m1"),
            _item("d2", "st1", "driver", metric_id="m1"),  # same metric as d1
        ]
        # slot only d1; d2 gets partial credit via metric
        assert coverage("st1", items, {"d1"}) == pytest.approx(0.75)  # (1.0 + 0.5) / 2

    def test_none_slotted(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import coverage
        items = [_item("d1", "st1", "driver"), _item("d2", "st1", "driver")]
        assert coverage("st1", items, set()) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# emotions_norm()
# ---------------------------------------------------------------------------

class TestEmotionsNorm:
    def test_empty_returns_neutral(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import emotions_norm
        assert emotions_norm({}) == pytest.approx(0.5)

    def test_mean(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import emotions_norm
        assert emotions_norm({"a": 0.2, "b": 0.8}) == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# loss()
# ---------------------------------------------------------------------------

class TestLoss:
    def test_no_tradeoffs(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import loss
        items = [_item("d1", "st1", "driver")]
        assert loss("st1", items, set()) == pytest.approx(0.0)

    def test_uncompensated_tradeoff(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import loss
        items = [_item("t1", "st1", "trade_off", concedes=_concedes(loss=5))]
        assert loss("st1", items, set()) == pytest.approx(1.0)

    def test_slotted_tradeoff_not_counted(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import loss
        items = [_item("t1", "st1", "trade_off", concedes=_concedes(loss=5))]
        assert loss("st1", items, {"t1"}) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# buy_in()
# ---------------------------------------------------------------------------

class TestBuyIn:
    def test_all_perfect(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import buy_in
        result = buy_in(1.0, 1.0, 1.0, 0.0)
        assert result == pytest.approx(min(1.0, 0.7 + 0.3 + 0.05))

    def test_clamp_to_zero(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import buy_in
        result = buy_in(0.0, 0.0, 0.0, 1.0, loss_w=1.0)
        assert result == pytest.approx(0.0)

    def test_formula(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import buy_in, LOSS_W
        cov, emo, fit_v, loss_v = 0.6, 0.7, 0.8, 0.2
        expected = 0.7 * cov + 0.3 * emo + 0.1 * (fit_v - 0.5) - LOSS_W * loss_v
        assert buy_in(cov, emo, fit_v, loss_v) == pytest.approx(max(0.0, min(1.0, expected)))


# ---------------------------------------------------------------------------
# outcome()
# ---------------------------------------------------------------------------

class TestOutcome:
    def test_pass(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import outcome
        room = [("s1", "high", 0.9, False), ("s2", "low", 0.8, False)]
        assert outcome(room) == "PASS"

    def test_veto_by_buy_in(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import outcome, VETO_THRESHOLD
        room = [("s1", "high", VETO_THRESHOLD - 0.01, False)]
        assert outcome(room) == "VETO"

    def test_veto_by_boundary(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import outcome
        room = [("s1", "high", 0.9, True)]  # boundary violated
        assert outcome(room) == "VETO"

    def test_soft_pass(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import outcome, OBJECTION_THRESHOLD
        room = [("s1", "high", 0.9, False), ("s2", "low", OBJECTION_THRESHOLD - 0.01, False)]
        assert outcome(room) == "SOFT_PASS"

    def test_low_power_boundary_soft_pass(self):
        from mlops_serious_game.application.pitch_debate_service.scoring import outcome
        room = [("s1", "high", 0.9, False), ("s2", "low", 0.9, True)]
        assert outcome(room) == "SOFT_PASS"


# ---------------------------------------------------------------------------
# fire_objections()
# ---------------------------------------------------------------------------

class TestFireObjections:
    def _authored(self):
        return {}

    def test_boundary_objection_fires(self):
        from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
        items = [_item("b1", "st1", "boundary")]
        result = fire_objections(["st1"], items, set(), {"b1"}, set(), self._authored())
        assert len(result) == 1
        assert result[0].kind == "boundary"
        assert result[0].hard is True

    def test_correction_objection_fires(self):
        from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
        # item tagged as driver but true type is boundary
        item = _item("d1", "st1", "boundary", categorized_type="driver")
        result = fire_objections(["st1"], [item], {"d1"}, set(), set(), self._authored())
        assert any(o.kind == "correction" for o in result)

    def test_stance_objection_fires_on_uncovered_driver(self):
        from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
        items = [_item("d1", "st1", "driver")]
        result = fire_objections(["st1"], items, set(), set(), set(), self._authored())
        assert any(o.kind == "stance" for o in result)

    def test_technical_objection_fires_on_a_capped_card_item(self):
        """fire_objections's own docstring names five kinds (boundary, technical, stance, price,
        correction); before this, only three had any test in the whole suite."""
        from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
        items = [_item("d1", "st1", "driver")]
        result = fire_objections(["st1"], items, {"d1"}, set(), {"d1"}, self._authored())
        assert [o.kind for o in result] == ["technical"]

    def test_price_objection_fires_on_an_uncompensated_trade_off(self):
        from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
        items = [_item("t1", "st1", "trade_off", concedes=_concedes(loss=5))]
        result = fire_objections(["st1"], items, set(), set(), set(), self._authored())
        assert [o.kind for o in result] == ["price"]

    def test_max_per_stakeholder_respected(self):
        from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
        # boundary + stance + price all fire for st1
        items = [
            _item("b1", "st1", "boundary"),
            _item("d1", "st1", "driver"),
            _item("t1", "st1", "trade_off", concedes=_concedes(loss=3)),
        ]
        result = fire_objections(["st1"], items, set(), {"b1"}, set(), self._authored(), max_per_stakeholder=2)
        st1_objs = [o for o in result if o.stakeholder_id == "st1"]
        assert len(st1_objs) <= 2

    def test_no_objections_when_all_covered(self):
        from mlops_serious_game.application.pitch_debate_service.objections import fire_objections
        items = [_item("d1", "st1", "driver")]
        result = fire_objections(["st1"], items, {"d1"}, set(), set(), self._authored())
        assert result == []


# ---------------------------------------------------------------------------
# dialogue_options_for()
# ---------------------------------------------------------------------------

class TestDialogueOptionsFor:
    def _boundary_obj(self):
        from mlops_serious_game.application.pitch_debate_service.objections import Objection
        return Objection(kind="boundary", stakeholder_id="st1", text="obj", hard=True)

    def _stance_obj(self):
        from mlops_serious_game.application.pitch_debate_service.objections import Objection
        return Objection(kind="stance", stakeholder_id="st1", text="obj", hard=False)

    def _correction_obj(self):
        from mlops_serious_game.application.pitch_debate_service.objections import Objection
        return Objection(kind="correction", stakeholder_id="st1", item_id="d1", text="obj", hard=False)

    def test_amend_available_when_answer_held(self):
        from mlops_serious_game.application.pitch_debate_service.objections import dialogue_options_for
        opts = dialogue_options_for(self._boundary_obj(), {"b1"}, 2, 3, 1)
        amend = next(o for o in opts if o.option == "amend")
        assert amend.available is True

    def test_amend_unavailable_when_no_answer(self):
        from mlops_serious_game.application.pitch_debate_service.objections import dialogue_options_for
        opts = dialogue_options_for(self._boundary_obj(), set(), 2, 3, 1)
        amend = next(o for o in opts if o.option == "amend")
        assert amend.available is False

    def test_emergency_addendum_needs_ep(self):
        from mlops_serious_game.application.pitch_debate_service.objections import dialogue_options_for
        opts = dialogue_options_for(self._stance_obj(), set(), escalation_points=0, amendment_budget=3, card_size=1)
        ea = next(o for o in opts if o.option == "emergency_addendum")
        assert ea.available is False

    def test_concede_correction_only_for_correction(self):
        from mlops_serious_game.application.pitch_debate_service.objections import dialogue_options_for
        opts_stance = dialogue_options_for(self._stance_obj(), set(), 2, 3, 1)
        cc_stance = next(o for o in opts_stance if o.option == "concede_correction")
        assert cc_stance.available is False

        opts_corr = dialogue_options_for(self._correction_obj(), set(), 2, 3, 1)
        cc_corr = next(o for o in opts_corr if o.option == "concede_correction")
        assert cc_corr.available is True

    def test_reframe_always_available(self):
        from mlops_serious_game.application.pitch_debate_service.objections import dialogue_options_for
        for obj in (self._boundary_obj(), self._stance_obj(), self._correction_obj()):
            opts = dialogue_options_for(obj, set(), 2, 3, 1)
            rf = next(o for o in opts if o.option == "reframe")
            assert rf.available is True

    def test_stonewall_always_available(self):
        from mlops_serious_game.application.pitch_debate_service.objections import dialogue_options_for
        opts = dialogue_options_for(self._boundary_obj(), set(), 0, 0, 5)
        sw = next(o for o in opts if o.option == "stonewall")
        assert sw.available is True
