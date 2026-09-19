"""Tests for streamlined scoring.py under the redesign."""

from __future__ import annotations

import pytest

from mlops_serious_game.application.pitch_debate_service.scoring import (
    OBJECTION_THRESHOLD,
    VETO_THRESHOLD,
    buy_in,
    emotions_norm,
    outcome,
    shift_emotions,
)


class TestEmotionsNorm:
    def test_empty_returns_neutral(self):
        assert emotions_norm({}) == pytest.approx(0.5)

    def test_mean(self):
        assert emotions_norm({"a": 0.2, "b": 0.8}) == pytest.approx(0.5)

    def test_full_range(self):
        assert emotions_norm({"a": 1.0, "b": 1.0}) == pytest.approx(1.0)
        assert emotions_norm({"a": 0.0, "b": 0.0}) == pytest.approx(0.0)


class TestBuyIn:
    def test_alignment_and_emotions_combine(self):
        # norm_align = 1.0 (from alignment_val = 1.0), emotions_val = 1.0 -> 0.6 * 1.0 + 0.4 * 1.0 = 1.0
        assert buy_in(alignment_val=1.0, emotions_val=1.0, boundary_violated=True) == pytest.approx(1.0)
        # norm_align = 1.0, emotions_val = 0.5 -> 0.6 * 1.0 + 0.4 * 0.5 = 0.8
        assert buy_in(alignment_val=1.0, emotions_val=0.5, boundary_violated=True) == pytest.approx(0.8)

    def test_max_alignment_and_emotions(self):
        # norm_align = 1.0, emotions_val = 1.0 -> 0.6 * 1.0 + 0.4 * 1.0 = 1.0
        assert buy_in(alignment_val=1.0, emotions_val=1.0) == pytest.approx(1.0)

    def test_neutral_alignment_and_emotions(self):
        # norm_align = 0.5 (from alignment_val = 0.0), emotions_val = 0.5 -> 0.5
        assert buy_in(alignment_val=0.0, emotions_val=0.5) == pytest.approx(0.5)

    def test_negative_alignment(self):
        # norm_align = 0.0 (from alignment_val = -1.0), emotions_val = 0.5 -> 0.2
        assert buy_in(alignment_val=-1.0, emotions_val=0.5) == pytest.approx(0.2)


class TestOutcome:
    def test_pass_when_all_above_threshold(self):
        room = [("s1", "high", 0.9, False), ("s2", "low", 0.8, False)]
        assert outcome(room) == "PASS"

    def test_veto_by_high_power_buy_in(self):
        room = [("s1", "high", VETO_THRESHOLD - 0.01, False), ("s2", "low", 0.8, False)]
        assert outcome(room) == "VETO"

    def test_veto_by_high_power_boundary(self):
        room = [("s1", "high", 0.9, True)]
        assert outcome(room) == "VETO"

    def test_soft_pass_when_low_power_boundary_violated(self):
        room = [("s1", "high", 0.9, False), ("s2", "low", 0.9, True)]
        assert outcome(room) == "SOFT_PASS"

    def test_soft_pass_when_low_power_buy_in_low(self):
        room = [("s1", "high", 0.9, False), ("s2", "low", OBJECTION_THRESHOLD - 0.01, False)]
        assert outcome(room) == "SOFT_PASS"


class TestShiftEmotions:
    def test_shift_with_dimensional_deltas(self):
        base = {"st1": {"trust": 0.5, "stress": 0.5}}
        deltas = {"st1": {"trust": 0.2, "stress": -0.1}}
        shifted = shift_emotions(base, deltas)
        assert shifted["st1"]["trust"] == pytest.approx(0.7)
        assert shifted["st1"]["stress"] == pytest.approx(0.4)

    def test_shift_clamped_to_bounds(self):
        base = {"st1": {"trust": 0.9, "stress": 0.1}}
        deltas = {"st1": {"trust": 0.3, "stress": -0.5}}
        shifted = shift_emotions(base, deltas)
        assert shifted["st1"]["trust"] == 1.0
        assert shifted["st1"]["stress"] == 0.0
