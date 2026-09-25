"""Tests for the results pillars and grade (docs/plans/results-screen.md, D2).

Pure functions on hand-built inputs: no database, no played game. Each test pins a decision the
scoring makes rather than just exercising the arithmetic, so a later retune has to argue with the
decision rather than quietly change behaviour.
"""

import pytest

from mlops_serious_game.application.results_service import compute as c


# ── Pipeline health ──────────────────────────────────────────────────────────


def test_locked_stages_are_excluded_not_counted_as_zero():
    """A stage the game never opened is not one the player failed to maintain."""
    both_reached = c.pipeline_health([{"health": 80, "locked": False}, {"health": 40, "locked": False}])
    one_locked = c.pipeline_health([{"health": 80, "locked": False}, {"health": 40, "locked": True}])

    assert both_reached.score == pytest.approx(0.6)
    assert one_locked.score == pytest.approx(0.8)
    assert one_locked.detail["stages_reached"] == 1


def test_no_stage_reached_scores_zero_without_dividing_by_zero():
    pillar = c.pipeline_health([{"health": 80, "locked": True}])
    assert pillar.score == 0.0
    assert "reason" in pillar.detail


def test_spiral_run_scores_improvement_over_what_it_inherited():
    """The whole point of the baseline: an iteration must not be graded on the previous one's work."""
    absolute = c.pipeline_health([{"health": 60, "locked": False}])
    relative = c.pipeline_health([{"health": 60, "locked": False}], baseline_stages=[{"health": 40, "locked": False}])

    assert absolute.score == pytest.approx(0.6)
    assert absolute.relative is False
    # 0.4 -> 0.6 closes a third of the 0.6 that was left to win.
    assert relative.score == pytest.approx(1 / 3)
    assert relative.relative is True


def test_a_spiral_run_that_changed_nothing_scores_zero_not_its_inheritance():
    """Without this, a long spiral chain trends to full marks for doing nothing."""
    pillar = c.pipeline_health([{"health": 90, "locked": False}], baseline_stages=[{"health": 90, "locked": False}])
    assert pillar.score == 0.0


def test_spiral_run_inheriting_a_perfect_system_is_not_punished():
    """No headroom left means there was nothing to win, so holding it is full marks, not a
    division by zero."""
    pillar = c.pipeline_health([{"health": 100, "locked": False}], baseline_stages=[{"health": 100, "locked": False}])
    assert pillar.score == 1.0


# ── Stakeholder relations ────────────────────────────────────────────────────


ROOM = [("boss", "high", "high"), ("bystander", "low", "low")]


def test_relations_weight_by_power_times_interest():
    """Leaving the high-power, high-interest stakeholder cold must cost more than the peripheral one."""
    boss_cold = c.stakeholder_relations({"boss": {"trust": 0.0}, "bystander": {"trust": 1.0}}, ROOM)
    bystander_cold = c.stakeholder_relations({"boss": {"trust": 1.0}, "bystander": {"trust": 0.0}}, ROOM)

    assert boss_cold.score < bystander_cold.score


def test_a_stakeholder_with_no_reading_is_skipped_not_scored_zero():
    """No emotion entry means they were never in the room, not that they felt nothing."""
    pillar = c.stakeholder_relations({"boss": {"trust": 0.8}}, ROOM)
    assert pillar.score == pytest.approx(0.8)
    assert "bystander" not in pillar.detail["per_stakeholder"]


def test_fired_grudges_cost_even_when_the_room_ended_warm():
    """A grudge that fired is friction the player shipped; ending warm does not undo it."""
    clean = c.stakeholder_relations({"boss": {"trust": 0.9}, "bystander": {"trust": 0.9}}, ROOM)
    grudging = c.stakeholder_relations(
        {"boss": {"trust": 0.9}, "bystander": {"trust": 0.9}}, ROOM, fired_grudges=2
    )

    assert grudging.score == pytest.approx(clean.score - 2 * c.GRUDGE_PENALTY)
    assert grudging.detail["fired_grudges"] == 2


def test_grudge_penalty_cannot_drive_the_score_negative():
    pillar = c.stakeholder_relations({"boss": {"trust": 0.1}}, ROOM, fired_grudges=99)
    assert pillar.score == 0.0


def test_an_empty_room_scores_zero_rather_than_dividing_by_zero():
    assert c.stakeholder_relations({}, []).score == 0.0


# ── Intel accuracy ───────────────────────────────────────────────────────────


def test_accuracy_and_coverage_multiply_rather_than_average():
    """Tagging three notes perfectly out of thirty is not an A, which averaging would give."""
    perfect_but_narrow = c.intel_accuracy(tagged_correct=3, tagged_total=3, gathered=3, available=30)
    assert perfect_but_narrow.score == pytest.approx(0.1)
    assert perfect_but_narrow.detail["accuracy"] == 1.0
    assert perfect_but_narrow.detail["coverage"] == pytest.approx(0.1)


def test_gathering_everything_and_reading_it_all_wrong_scores_zero():
    pillar = c.intel_accuracy(tagged_correct=0, tagged_total=20, gathered=20, available=20)
    assert pillar.score == 0.0


def test_intel_accuracy_handles_a_run_with_nothing_gathered():
    pillar = c.intel_accuracy(tagged_correct=0, tagged_total=0, gathered=0, available=0)
    assert pillar.score == 0.0


# ── Decision quality ─────────────────────────────────────────────────────────


def test_outcomes_score_pass_soft_pass_and_veto():
    assert c.decision_quality(["PASS", "PASS"]).score == pytest.approx(1.0)
    assert c.decision_quality(["SOFT_PASS", "SOFT_PASS"]).score == pytest.approx(0.5)
    assert c.decision_quality(["VETO", "VETO"]).score == 0.0
    assert c.decision_quality(["PASS", "VETO"]).score == pytest.approx(0.5)


def test_an_unplayed_challenge_is_skipped_not_treated_as_a_veto():
    assert c.decision_quality(["PASS", "NOT_REACHED"]).score == pytest.approx(1.0)


def test_no_outcome_at_all_scores_zero_with_a_reason():
    pillar = c.decision_quality([])
    assert pillar.score == 0.0
    assert "reason" in pillar.detail


def test_escalation_nudges_the_score_down_without_erasing_it():
    """Escalation is a legitimate tool, so spending it should cost a little, not everything."""
    pillar = c.decision_quality(["PASS", "PASS"], escalation_spent=3)
    assert pillar.score == pytest.approx(1.0 - 3 * c.ESCALATION_PENALTY)
    assert pillar.score > 0.8


# ── Gate 7 (GDD.txt "CAPTURE Gate 7") ────────────────────────────────────────


def test_metric_compliance_counts_metrics_at_or_above_the_threshold():
    metrics = [{"id": "model", "ratio": 0.6}, {"id": "data", "ratio": 0.4}]
    pillar = c.metric_compliance(metrics, ratio_threshold=0.5)
    assert pillar.score == pytest.approx(0.5)
    assert pillar.detail["compliant"] == ["model"]


def test_metric_compliance_with_no_metrics_scores_zero_with_a_reason():
    pillar = c.metric_compliance([])
    assert pillar.score == 0.0
    assert "reason" in pillar.detail


def test_change_scope_counts_absent_or_below_as_still_planned():
    rows = [
        {"nominal_automation": 0, "has_debt": False},  # broken: still planned
        {"nominal_automation": 1, "has_debt": False},  # absent: still planned
        {"nominal_automation": 2, "has_debt": False},  # manual: realized
    ]
    assert c.change_scope(rows).score == pytest.approx(2 / 3)


def test_change_scope_weights_a_debt_carrying_gap_more_heavily():
    """A target that was fought over (soft failure / overridden veto) and still didn't land
    signals more than one nobody ever contested."""
    plain_gap = c.change_scope([
        {"nominal_automation": 1, "has_debt": False}, {"nominal_automation": 2, "has_debt": False},
    ])
    contested_gap = c.change_scope([
        {"nominal_automation": 1, "has_debt": True}, {"nominal_automation": 2, "has_debt": False},
    ])
    assert contested_gap.score > plain_gap.score


def test_change_scope_with_no_observed_targets_scores_zero_with_a_reason():
    pillar = c.change_scope([])
    assert pillar.score == 0.0
    assert "reason" in pillar.detail


def test_drift_magnitude_is_the_debt_weighted_share_of_targets_carrying_debt():
    rows = [{"nominal_automation": 2, "has_debt": True}, {"nominal_automation": 2, "has_debt": False}]
    pillar = c.drift_magnitude(rows)
    # The debt-carrying row counts double (GATE7_DEBT_WEIGHT): 2 / (2 + 1).
    assert pillar.score == pytest.approx(2 / 3)
    assert pillar.detail["targets_with_debt"] == 1


def test_gate7_retirement_fires_on_unviable_satisfaction_or_compliance_before_anything_else():
    """7e overrides even a spotless graph: an unhappy room or missed KPIs make the system not
    worth continuing regardless of how little is left unbuilt."""
    result = c.gate7_outcome(
        stakeholder_satisfaction=0.1, metric_compliance_score=0.9,
        change_scope_score=0.0, drift_magnitude_score=0.0,
    )
    assert result.code == "7e"
    assert result.allowed_modes == ["fresh"]

    result = c.gate7_outcome(
        stakeholder_satisfaction=0.9, metric_compliance_score=0.1,
        change_scope_score=0.0, drift_magnitude_score=0.0,
    )
    assert result.code == "7e"


def test_gate7_major_iteration_fires_on_large_change_scope_when_viable():
    result = c.gate7_outcome(
        stakeholder_satisfaction=0.8, metric_compliance_score=0.8,
        change_scope_score=0.9, drift_magnitude_score=0.0,
    )
    assert result.code == "7a"
    assert result.allowed_modes == ["fresh"]


def test_gate7_continuous_monitoring_is_the_clean_win():
    result = c.gate7_outcome(
        stakeholder_satisfaction=0.9, metric_compliance_score=0.9,
        change_scope_score=0.05, drift_magnitude_score=0.05,
    )
    assert result.code == "7d"
    assert result.result == "win"
    assert result.allowed_modes == ["fresh", "spiral"]


def test_gate7_model_update_fires_on_high_drift_when_otherwise_sound():
    result = c.gate7_outcome(
        stakeholder_satisfaction=0.8, metric_compliance_score=0.8,
        change_scope_score=0.3, drift_magnitude_score=0.5,
    )
    assert result.code == "7c"
    assert result.result == "win_with_debt"
    assert result.allowed_modes == ["fresh", "spiral"]


def test_gate7_minor_iteration_is_the_middle_ground():
    result = c.gate7_outcome(
        stakeholder_satisfaction=0.8, metric_compliance_score=0.8,
        change_scope_score=0.3, drift_magnitude_score=0.2,
    )
    assert result.code == "7b"
    assert result.result == "win_with_debt"
    assert result.allowed_modes == ["fresh", "spiral"]


def test_gate7_readings_are_reported_for_the_results_screen():
    result = c.gate7_outcome(0.8, 0.8, 0.3, 0.2)
    assert result.readings == {
        "stakeholder_satisfaction": 0.8, "metric_compliance": 0.8,
        "change_scope": 0.3, "drift_magnitude": 0.2,
    }


# ── Reading outcomes off the event log ───────────────────────────────────────


class _Event:
    def __init__(self, phase_id, challenge_id, cause):
        self.phase_id = phase_id
        self.challenge_id = challenge_id
        self.cause = cause


def test_only_the_commit_that_ended_a_challenge_counts():
    """A challenge can be pitched more than once; the last commit is the one that happened."""
    outcomes = c.outcomes_from_events([
        _Event(1, 1, "outcome.veto"),
        _Event(1, 1, "outcome.pass"),
        _Event(2, 2, "outcome.soft_pass"),
    ])
    assert outcomes == ["PASS", "SOFT_PASS"]


def test_non_outcome_events_are_ignored():
    assert c.outcomes_from_events([_Event(1, 1, "emotion.reframe_hit")]) == []


# ── Grade ────────────────────────────────────────────────────────────────────


def _pillar(pillar_id: str, score: float) -> c.Pillar:
    return c.Pillar(id=pillar_id, score=score)


def test_overall_is_the_weighted_blend():
    pillars = [_pillar(name, 1.0) for name in c.DEFAULT_PILLAR_WEIGHTS]
    assert c.overall_score(pillars) == pytest.approx(1.0)

    half = [_pillar(name, 0.5) for name in c.DEFAULT_PILLAR_WEIGHTS]
    assert c.overall_score(half) == pytest.approx(0.5)


def test_a_missing_pillar_renormalises_rather_than_capping_the_player():
    """With no outcome recorded, the remaining pillars should still reach a full grade."""
    pillars = [_pillar("pipeline_health", 1.0), _pillar("stakeholder_relations", 1.0)]
    assert c.overall_score(pillars) == pytest.approx(1.0)


def test_unknown_pillar_ids_carry_no_weight():
    assert c.overall_score([_pillar("something_else", 1.0)]) == 0.0


@pytest.mark.parametrize(
    "overall, expected",
    [(1.0, "S"), (0.85, "S"), (0.849, "A"), (0.72, "A"), (0.58, "B"), (0.44, "C"), (0.30, "D"), (0.0, "E")],
)
def test_grade_bands_at_their_edges(overall, expected):
    """Band edges are inclusive on the lower bound, so a score exactly on a threshold gets the
    better grade."""
    assert c.grade_for(overall).grade == expected


def test_the_lowest_band_always_answers():
    assert c.grade_for(0.0).grade == "E"
    assert c.grade_for(-0.0).label == "Overwhelmed"


def test_the_curve_is_generous_enough_to_reward_a_partial_run():
    """A player who half-managed every pillar should not be told they failed: no run can
    realistically max the graph."""
    pillars = [_pillar(name, 0.6) for name in c.DEFAULT_PILLAR_WEIGHTS]
    assert c.grade_for(c.overall_score(pillars)).grade == "B"


# ── Metrics ──────────────────────────────────────────────────────────────────


def test_metric_summary_reports_final_value_gain_and_series():
    summary = c.metric_summary(
        metric_ids=["model", "automation"],
        trajectory=[[10, 5], [20, 5], [30, 15]],
        max_values={"model": 50, "automation": 50},
    )
    model = next(m for m in summary["metrics"] if m["id"] == "model")

    assert model["value"] == 30
    assert model["gained"] == 20
    assert model["ratio"] == pytest.approx(0.6)
    assert model["series"] == [10, 20, 30]
    assert summary["challenges"] == 3


def test_tutorial_metrics_stay_out_of_the_headline():
    summary = c.metric_summary(
        metric_ids=["model", "model_intro"],
        trajectory=[[10, 99]],
        max_values={"model": 50, "model_intro": 50},
        excluded=["model_intro"],
    )
    assert [m["id"] for m in summary["metrics"]] == ["model"]


def test_metric_summary_survives_an_empty_run():
    summary = c.metric_summary(metric_ids=["model"], trajectory=[], max_values={"model": 50})
    assert summary["metrics"][0]["value"] == 0
    assert summary["challenges"] == 0


# ── Knowledge delta ──────────────────────────────────────────────────────────


def test_knowledge_delta_reports_counts_and_percentages_only():
    """D3: the player sees that they moved, never which answers were wrong."""
    delta = c.knowledge_delta(intro_correct=3, outro_correct_per_run=[5], total_questions=7)

    assert delta["intro"]["correct"] == 3
    assert delta["delta"] == 2
    assert delta["delta_percent"] == pytest.approx(28.6, abs=0.1)
    serialised = repr(delta)
    assert "answer" not in serialised and "question_id" not in serialised


def test_the_delta_series_extends_across_runs():
    """Each run's outro is another point, so a replaying player keeps building the series."""
    delta = c.knowledge_delta(intro_correct=2, outro_correct_per_run=[4, 6], total_questions=7)

    assert [entry["correct"] for entry in delta["outro_per_run"]] == [4, 6]
    assert delta["delta"] == 4


def test_a_missing_outro_leaves_the_delta_unknown_rather_than_zero():
    """A campaign with the questionnaire disabled has no outro: that is 'not measured', not 'no
    improvement'."""
    delta = c.knowledge_delta(intro_correct=3, outro_correct_per_run=[None], total_questions=7)
    assert delta["delta"] is None
    assert delta["outro_per_run"][0]["percent"] is None


# ── Epilogue selection (D5/D12) ──────────────────────────────────────────────


class TestEpilogue:
    """The epilogue is authored config, so these pin selection, not prose."""

    def test_every_grade_band_has_a_verdict_and_a_scoreboard(self):
        from mlops_serious_game.domain.epilogue_factory import EpilogueFactory

        for _, grade, _ in c.DEFAULT_GRADE_BANDS:
            verdict = EpilogueFactory.verdict_for(grade)
            assert verdict["closing"], f"band {grade} has no closing line"
            # The four criteria the briefing promises the player they are judged on.
            assert set(verdict["scoreboard"]) == {
                "availability", "waste", "residual_stock", "override_rate"
            }

    def test_a_spiral_run_does_not_claim_the_project_ended(self):
        """The player is about to be offered another cycle; the verdict has to read as an
        iteration closing, not a finale."""
        from mlops_serious_game.domain.epilogue_factory import EpilogueFactory

        fresh = EpilogueFactory.verdict_for("A", spiral=False)["closing"]
        spiral = EpilogueFactory.verdict_for("A", spiral=True)["closing"]
        assert fresh != spiral
        assert "cycle" in spiral.lower()

    def test_beats_are_selected_by_priority_and_capped(self):
        from mlops_serious_game.domain.epilogue_factory import epilogue_for

        beats = epilogue_for("E", {
            "stakeholder_mood": 0.1,
            "fired_grudges": 2,
            "broken_stage": True,
            "intel_accuracy": 0.2,
            "veto_count": 3,
        })["beats"]

        assert len(beats) == 3
        assert [b["id"] for b in beats] == ["stakeholder_hostile", "grudge_fired", "stage_broken"]

    def test_a_quiet_run_still_gets_a_closing_beat(self):
        """No condition met must not leave the panel empty."""
        from mlops_serious_game.domain.epilogue_factory import epilogue_for

        beats = epilogue_for("C", {})["beats"]
        assert len(beats) == 1
        assert beats[0]["id"] == "default"

    def test_a_missing_reading_does_not_fire_a_beat(self):
        """A fact the run has no value for must fail its condition, not pass it."""
        from mlops_serious_game.domain.epilogue_factory import EpilogueFactory

        assert EpilogueFactory._matches({"intel_accuracy_below": 0.4}, {}) is False
        assert EpilogueFactory._matches({"intel_accuracy_below": 0.4}, {"intel_accuracy": 0.2}) is True

    def test_a_good_run_gets_the_positive_beats(self):
        from mlops_serious_game.domain.epilogue_factory import epilogue_for

        ids = [b["id"] for b in epilogue_for("S", {
            "intel_accuracy": 0.9, "veto_count": 0, "fired_grudges": 0, "relations": 0.8,
        })["beats"]]
        assert "intel_sharp" in ids and "clean_run" in ids
        assert "stakeholder_hostile" not in ids

    def test_config_without_a_fallback_beat_is_rejected(self):
        """A config that can leave the player with no epilogue should fail at load, not at play."""
        from mlops_serious_game.domain.epilogue_factory import EpilogueConfigError, EpilogueFactory

        with pytest.raises(EpilogueConfigError):
            EpilogueFactory.load_dict({
                "verdict": {"C": {"closing": "x", "scoreboard": {}}},
                "beats": [{"id": "only", "priority": 1, "when": {"veto_count_at_least": 1}, "text": "t"}],
            })

    def test_config_missing_a_scoreboard_is_rejected(self):
        from mlops_serious_game.domain.epilogue_factory import EpilogueConfigError, EpilogueFactory

        with pytest.raises(EpilogueConfigError):
            EpilogueFactory.load_dict({
                "verdict": {"C": {"closing": "x"}},
                "beats": [{"id": "d", "priority": 0, "when": {}, "text": "t"}],
            })


# ── Detail sections (D7: counts only) ────────────────────────────────────────


def _item(owner, true_tag, tagged, confidence="verified"):
    return {"stakeholder_id": owner, "true_tag": true_tag, "tagged_tag": tagged, "confidence": confidence}


def test_intel_breakdown_counts_correct_and_wrong_per_stakeholder():
    result = c.intel_breakdown(
        [_item("monica", "driver", "driver"), _item("monica", "boundary", "driver")],
        {"monica": 5},
    )
    row = next(r for r in result["per_stakeholder"] if r["id"] == "monica")
    assert (row["gathered"], row["correct"], row["wrong"], row["available"]) == (2, 1, 1, 5)


def test_a_stakeholder_the_player_found_nothing_on_still_gets_a_row():
    """A row of zeros against a non-zero `available` is exactly the coverage gap worth showing."""
    result = c.intel_breakdown([], {"ruth": 4})
    assert result["per_stakeholder"] == [
        {"id": "ruth", "gathered": 0, "correct": 0, "wrong": 0, "available": 4}
    ]


def test_facts_group_under_the_environment_and_sort_last():
    result = c.intel_breakdown(
        [_item(None, "fact", "fact"), _item("alex", "driver", "driver")], {"alex": 1}
    )
    assert [r["id"] for r in result["per_stakeholder"]] == ["alex", c.ENVIRONMENT]


def test_the_confusion_matrix_says_which_distinction_the_player_keeps_missing():
    result = c.intel_breakdown(
        [_item("a", "boundary", "driver"), _item("a", "boundary", "driver"), _item("a", "driver", "driver")],
        {},
    )
    assert result["confusion"]["boundary"] == {"driver": 2}
    assert result["confusion"]["driver"] == {"driver": 1}


def test_intel_breakdown_never_carries_item_wording():
    """D7: the screen says *that* a boundary was read as a driver, never *which* note it was, so a
    second run is still worth playing."""
    leaky = _item("a", "boundary", "driver")
    leaky["fact"] = "SECRET WORDING"
    leaky["description"] = "SECRET WORDING"
    assert "SECRET WORDING" not in repr(c.intel_breakdown([leaky], {"a": 1}))


def test_confidence_states_are_counted_and_unknowns_fold_to_unconfirmed():
    result = c.intel_breakdown(
        [_item("a", "driver", "driver", "verified"), _item("a", "driver", "driver", "weird")],
        {},
    )
    assert result["confidence"] == {"verified": 1, "unconfirmed": 1}


def test_decision_rows_follow_play_order_and_leave_unfinished_challenges_unscored():
    rows = c.decision_rows(
        [
            {"phase_index": 1, "challenge_index": 10, "action_card": {"title": "Automate it"}, "attention_tokens": 4},
            {"phase_index": 2, "challenge_index": 11, "action_card": {}, "attention_tokens": 9},
        ],
        {(1, 10): "PASS"},
        {10: "The Platform Choice"},
    )
    assert [r["position"] for r in rows] == [1, 2]
    assert rows[0]["outcome"] == "PASS" and rows[0]["card_title"] == "Automate it"
    # Never reached a commit: not a veto, and no invented name.
    assert rows[1]["outcome"] is None and rows[1]["card_title"] is None
    assert rows[1]["name"] == "Challenge 11"


def test_mood_trajectory_gives_none_not_zero_for_a_stakeholder_not_in_the_room():
    """A line that dives to zero would claim they turned hostile, when they were simply absent."""
    trajectory = c.mood_trajectory([
        {"emotion_values": {"a": {"trust": 0.8}}},
        {"emotion_values": {"a": {"trust": 0.6}, "b": {"trust": 0.4}}},
    ])
    assert trajectory["steps"] == 2
    assert trajectory["series"]["a"] == [0.8, 0.6]
    assert trajectory["series"]["b"] == [None, 0.4]


def test_a_spiral_run_gains_are_measured_from_where_it_began_not_the_chain_start():
    """Iteration two must not take credit for what iteration one built. The trajectory starts with
    the inherited challenges, and `gained` runs from the last of them."""
    summary = c.metric_summary(
        metric_ids=["model"],
        trajectory=[[10], [30], [35], [42]],  # first two inherited, last two this run's own
        max_values={"model": 50},
        own_from=2,
    )
    model = summary["metrics"][0]
    assert model["value"] == 42
    assert model["gained"] == 12          # 42 - 30, not 42 - 10
    assert summary["own_from"] == 2
    assert model["series"] == [10, 30, 35, 42]  # the chart still shows the whole road


def test_a_fresh_run_gains_are_measured_from_its_first_reading():
    summary = c.metric_summary(metric_ids=["model"], trajectory=[[10], [30]], max_values={"model": 50})
    assert summary["metrics"][0]["gained"] == 20
    assert summary["own_from"] == 0
