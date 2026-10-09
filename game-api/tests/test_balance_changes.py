"""Grade and room balance changes (docs/plans/shorter-playthrough-and-grade-spread.md). Pure, no database."""

from types import SimpleNamespace

import pytest

from mlops_serious_game.application.graph_service.pipeline import (
    PASS,
    SOFT_PASS,
    STALEMATE,
    VETO_BROKEN,
    split_amended,
)
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.application.pitch_debate_service.scoring import emotions_norm
from mlops_serious_game.application.results_service import compute as c
from mlops_serious_game.domain.emotion import recover_toward_neutral, valence_mean
from mlops_serious_game.domain.grudge import Grudge


# ── 1. Mood is read with stress and perceived risk inverted ──────────────────


def test_a_calm_trusting_stakeholder_reads_better_than_a_stressed_one():
    calm = {"trust": 0.8, "stress": 0.1, "perceived_risk": 0.1, "fairness": 0.8}
    tense = {"trust": 0.8, "stress": 0.9, "perceived_risk": 0.9, "fairness": 0.8}
    assert valence_mean(calm) > valence_mean(tense)
    assert emotions_norm(calm) > emotions_norm(tense)


def test_neutral_stays_neutral_and_nothing_reads_as_none():
    assert valence_mean({"trust": 0.5, "stress": 0.5}) == pytest.approx(0.5)
    assert valence_mean({}) is None
    assert emotions_norm({}) == 0.5


def test_relations_pillar_rewards_calm_not_stress():
    room = [("a", "high", "high")]
    calm = c.stakeholder_relations({"a": {"trust": 0.5, "stress": 0.1}}, room)
    tense = c.stakeholder_relations({"a": {"trust": 0.5, "stress": 0.9}}, room)
    assert calm.score > tense.score


# ── 3. Decisions are graded against what the room allows ─────────────────────


def test_a_soft_pass_in_a_room_with_no_clean_pass_is_full_marks():
    pillar = c.decision_quality(["SOFT_PASS", "SOFT_PASS"], pars=["SOFT_PASS", "SOFT_PASS"])
    assert pillar.score == 1.0


def test_a_soft_pass_in_a_room_that_allowed_a_pass_is_still_half():
    assert c.decision_quality(["SOFT_PASS"], pars=["PASS"]).score == 0.5
    assert c.decision_quality(["SOFT_PASS"]).score == 0.5, "no par given means PASS, as before"


def test_a_pass_never_scores_above_full_marks_and_a_veto_is_still_zero():
    assert c.decision_quality(["PASS"], pars=["SOFT_PASS"]).score == 1.0
    assert c.decision_quality(["VETO"], pars=["SOFT_PASS"]).score == 0.0


def test_a_tabled_challenge_scores_nothing():
    assert c.OUTCOME_CAUSES["outcome.stalemate"] == "STALEMATE"
    assert c.decision_quality(["STALEMATE"]).score == 0.0


# ── 4. Make amends ───────────────────────────────────────────────────────────


def _read(st, power, buy_in, boundary=False):
    return SimpleNamespace(stakeholder_id=st, power=power, buy_in=buy_in, boundary_violated=boundary)


def test_a_satisfied_stakeholder_lets_their_grudge_go():
    grudges = [Grudge(stakeholder_id="ruth"), Grudge(stakeholder_id="emilia")]
    kept, cleared = split_amended(grudges, [_read("ruth", "low", 0.6), _read("emilia", "low", 0.1)], PASS)
    assert [g.stakeholder_id for g in cleared] == ["ruth"]
    assert [g.stakeholder_id for g in kept] == ["emilia"]


def test_the_line_to_clear_is_each_stakeholders_own():
    # 0.35 clears a low-power stakeholder (line 0.3) but not a high-power one (line 0.4).
    grudges = [Grudge(stakeholder_id="low_one"), Grudge(stakeholder_id="high_one")]
    reads = [_read("low_one", "low", 0.35), _read("high_one", "high", 0.35)]
    _, cleared = split_amended(grudges, reads, SOFT_PASS)
    assert [g.stakeholder_id for g in cleared] == ["low_one"]


def test_a_crossed_boundary_never_amends():
    kept, cleared = split_amended([Grudge(stakeholder_id="ruth")], [_read("ruth", "low", 0.9, boundary=True)], PASS)
    assert cleared == [] and len(kept) == 1


@pytest.mark.parametrize("outcome", [VETO_BROKEN, STALEMATE])
def test_nothing_is_amended_by_an_override_or_a_stalemate(outcome):
    kept, cleared = split_amended([Grudge(stakeholder_id="ruth")], [_read("ruth", "low", 0.9)], outcome)
    assert cleared == [] and len(kept) == 1


# ── 5. Time heals ────────────────────────────────────────────────────────────


def test_emotions_recover_a_share_of_the_way_to_neutral():
    healed = recover_toward_neutral({"trust": 0.1, "stress": 0.9, "fairness": 0.5}, 0.25)
    assert healed == {"trust": 0.2, "stress": 0.8, "fairness": 0.5}


def test_no_recovery_changes_nothing():
    values = {"trust": 0.1}
    assert recover_toward_neutral(values, 0.0) == values


# ── 6. Table it ──────────────────────────────────────────────────────────────


def test_tabling_ends_the_challenge_in_a_stalemate_without_a_card():
    state = pitch.start_pitch(["ruth"]).model_copy(update={"stage": "DONE", "outcome": "VETO"})
    updated, events = pitch.table_it(state)
    assert (updated.stage, updated.outcome) == ("DONE", "STALEMATE")
    assert [e.cause for e in events] == ["outcome.stalemate"]
    assert not getattr(updated, "overridden_stakeholder_id", None), "no stakeholder is overridden"


# ── Pipeline: how much of the damage was won back ────────────────────────────


def test_a_challenge_that_left_the_stage_as_damaged_scores_nothing_and_a_full_repair_scores_one():
    assert c.pipeline_progress([(60, 60)]).score == 0.0
    assert c.pipeline_progress([(60, 100)]).score == 1.0
    assert c.pipeline_progress([(60, 80)]).score == pytest.approx(0.5)


def test_making_things_worse_does_not_score_below_zero():
    assert c.pipeline_progress([(60, 30)]).score == 0.0


def test_a_stage_the_challenge_never_hurt_scores_what_it_ended_at():
    assert c.pipeline_progress([(100, 100)]).score == 1.0
    assert c.pipeline_progress([(98, 70)]).score == pytest.approx(0.7)


def test_only_the_challenges_played_count_so_a_short_run_is_graded_like_a_long_one():
    long_run = c.pipeline_progress([(60, 80)] * 5)
    short_run = c.pipeline_progress([(60, 80)] * 2)
    assert long_run.score == pytest.approx(short_run.score)
    assert c.pipeline_progress([]).score == 0.0


def test_a_room_that_can_never_reach_full_health_is_graded_against_what_it_can_reach():
    """A stage that starts with an anti-pattern no single challenge clears tops out below 100: its
    the stage's health before the event is the ceiling, so a full repair still scores one (115 and 118: 88)."""
    assert c.pipeline_progress([(73, 88)]).score == pytest.approx(0.556, abs=0.001)
    assert c.pipeline_progress([(73, 88, 88)]).score == 1.0
    assert c.pipeline_progress([(73, 80, 88)]).score == pytest.approx(7 / 15)
    assert c.pipeline_progress([(73, 60, 88)]).score == 0.0


def test_a_room_with_no_headroom_under_its_par_scores_what_it_ended_at_of_that_par():
    assert c.pipeline_progress([(86, 88, 88)]).score == 1.0
    assert c.pipeline_progress([(86, 44, 88)]).score == pytest.approx(0.5)


# ── Relations from the whole run ─────────────────────────────────────────────

ROOM = [("a", "high", "high")]


def _mood(stress):
    return {"a": {"trust": 0.5, "stress": stress}}


def test_a_repaired_start_reads_better_than_an_unrepaired_end_alone():
    history = [_mood(0.9), _mood(0.2)]
    with_history = c.stakeholder_relations(_mood(0.2), ROOM, history=history)
    only_the_end = c.stakeholder_relations(_mood(0.2), ROOM)
    assert with_history.score < only_the_end.score, "the bad first challenge still counts"
    assert with_history.score > c.stakeholder_relations(_mood(0.9), ROOM).score, "but the recovery does too"


def test_the_last_challenge_counts_twice():
    low, high = _mood(0.9), _mood(0.1)
    detail = c.stakeholder_relations(high, ROOM, history=[low, high]).detail
    assert detail["weighted_mood"] == pytest.approx((c.valence_mean(low["a"]) + 2 * c.valence_mean(high["a"])) / 3, abs=1e-3)


def test_no_history_changes_nothing():
    assert c.stakeholder_relations(_mood(0.3), ROOM).score == c.stakeholder_relations(_mood(0.3), ROOM, history=[]).score
