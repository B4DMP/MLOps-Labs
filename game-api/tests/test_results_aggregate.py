"""Tests for the campaign-level results aggregation (docs/plans/results-screen.md, section 5).

Pure, on hand-built payloads. What is pinned is how it treats *missing* readings, because the
plausible mistake here is averaging an absent reading in as a bad one and dragging a whole
campaign down for reasons unrelated to how anyone played.
"""

import pytest

from mlops_serious_game.application.results_service import aggregate as agg


def _payload(grade="B", overall=0.6, *, decisions=None, pillars=None, knowledge=None, intel=None,
             spiral=False, metrics=None, mood=None):
    return {
        "grade": {"grade": grade, "overall": overall, "label": "x"},
        "is_spiral": spiral,
        "pillars": pillars if pillars is not None else [
            {"id": "pipeline_health", "score": 0.6, "detail": {}},
            {"id": "stakeholder_relations", "score": 0.5, "detail": {}},
            {"id": "intel_accuracy", "score": 0.4, "detail": {"accuracy": 0.8, "coverage": 0.5}},
            {"id": "decision_quality", "score": 0.7, "detail": {}},
        ],
        "decisions": decisions or [],
        "knowledge": knowledge or {"intro": {"percent": None}, "outro_per_run": [], "delta": None, "delta_percent": None},
        "intel": intel or {"per_stakeholder": []},
        "metrics": metrics or {"metrics": []},
        "mood": mood or {"steps": 0, "series": {}},
    }


# ── describe ─────────────────────────────────────────────────────────────────


def test_describe_reports_the_usual_statistics():
    result = agg.describe([0.2, 0.4, 0.6])
    assert result["n"] == 3
    assert result["mean"] == pytest.approx(0.4)
    assert result["median"] == pytest.approx(0.4)
    assert (result["min"], result["max"]) == (0.2, 0.6)
    assert result["stdev"] == pytest.approx(0.2)


def test_describe_skips_missing_readings_rather_than_counting_them_as_zero():
    """An absent reading is not a bad one."""
    assert agg.describe([0.5, None, 0.5])["mean"] == pytest.approx(0.5)
    assert agg.describe([0.5, None, 0.5])["n"] == 2


def test_a_single_reading_has_no_spread_rather_than_a_spread_of_zero():
    """Zero would claim everyone played identically."""
    result = agg.describe([0.7])
    assert result["mean"] == pytest.approx(0.7)
    assert result["stdev"] is None


def test_describe_of_nothing_is_empty_not_an_error():
    result = agg.describe([])
    assert result["n"] == 0 and result["mean"] is None


# ── Grades and pillars ───────────────────────────────────────────────────────


def test_the_grade_distribution_lists_every_grade_even_when_empty():
    """An empty band must show as a zero, not disappear from the chart."""
    dist = agg.grade_distribution([_payload("A"), _payload("A"), _payload("E")])
    assert list(dist) == ["S", "A", "B", "C", "D", "E"]
    assert dist == {"S": 0, "A": 2, "B": 0, "C": 0, "D": 0, "E": 1}


def test_pillar_statistics_are_per_pillar():
    payloads = [_payload(), _payload(pillars=[{"id": "pipeline_health", "score": 1.0, "detail": {}}])]
    pillars = agg.aggregate_results(payloads)["pillars"]

    assert pillars["pipeline_health"]["mean"] == pytest.approx(0.8)
    # The second payload had no relations pillar at all: only one reading, not a zero.
    assert pillars["stakeholder_relations"]["n"] == 1
    assert pillars["stakeholder_relations"]["mean"] == pytest.approx(0.5)


# ── Outcomes and challenges ──────────────────────────────────────────────────


def _decision(name, outcome):
    return {"name": name, "outcome": outcome}


def test_outcome_mix_keeps_unfinished_apart_from_vetoed():
    """A run that stopped is not a proposal that failed."""
    mix = agg.outcome_mix([
        _payload(decisions=[_decision("a", "PASS"), _decision("b", "VETO"), _decision("c", None)]),
        _payload(decisions=[_decision("a", "SOFT_PASS")]),
    ])
    assert mix == {"PASS": 1, "SOFT_PASS": 1, "VETO": 1, "unfinished": 1}


def test_challenges_rank_by_veto_rate_not_veto_count():
    """A challenge few people reached must not look easy, nor one everyone reached look hard, just
    because of how many saw it."""
    payloads = (
        [_payload(decisions=[_decision("popular", "PASS")]) for _ in range(9)]
        + [_payload(decisions=[_decision("popular", "VETO")])]      # 1 of 10 vetoed
        + [_payload(decisions=[_decision("rare", "VETO")])]         # 1 of 1 vetoed
    )
    ranked = agg.challenge_difficulty(payloads)

    assert [r["name"] for r in ranked] == ["rare", "popular"]
    assert ranked[0]["veto_rate"] == pytest.approx(1.0)
    assert ranked[1]["veto_rate"] == pytest.approx(0.1)


def test_an_unfinished_challenge_does_not_count_as_played():
    ranked = agg.challenge_difficulty([_payload(decisions=[_decision("x", None)])])
    assert ranked == []


def test_hardest_challenges_only_lists_ones_that_were_actually_vetoed():
    aggregated = agg.aggregate_results([_payload(decisions=[_decision("easy", "PASS")])])
    assert aggregated["hardest_challenges"] == []
    assert aggregated["challenges"][0]["name"] == "easy"


def test_hardest_challenges_are_capped():
    payloads = [_payload(decisions=[_decision(f"c{i}", "VETO")]) for i in range(10)]
    assert len(agg.aggregate_results(payloads, top=3)["hardest_challenges"]) == 3


# ── Intel ────────────────────────────────────────────────────────────────────


def test_intel_accuracy_and_coverage_come_from_the_pillar_detail():
    intel = agg.aggregate_results([_payload(), _payload()])["intel"]
    assert intel["accuracy"]["mean"] == pytest.approx(0.8)
    assert intel["coverage"]["mean"] == pytest.approx(0.5)


def test_coverage_by_stakeholder_shows_who_players_tend_to_neglect():
    payloads = [
        _payload(intel={"per_stakeholder": [
            {"id": "dave", "gathered": 4, "available": 4},
            {"id": "ruth", "gathered": 0, "available": 4},
        ]}),
        _payload(intel={"per_stakeholder": [
            {"id": "dave", "gathered": 2, "available": 4},
            {"id": "ruth", "gathered": 1, "available": 4},
        ]}),
    ]
    by_stakeholder = agg.intel_summary(payloads)["coverage_by_stakeholder"]
    assert by_stakeholder["dave"]["mean"] == pytest.approx(0.75)
    assert by_stakeholder["ruth"]["mean"] == pytest.approx(0.125)


def test_a_stakeholder_with_nothing_available_is_skipped_not_divided_by_zero():
    result = agg.intel_summary([_payload(intel={"per_stakeholder": [{"id": "x", "gathered": 0, "available": 0}]})])
    assert result["coverage_by_stakeholder"] == {}


# ── Knowledge ────────────────────────────────────────────────────────────────


def _knowledge(intro, outros, delta, delta_percent):
    return {
        "intro": {"percent": intro},
        "outro_per_run": [{"run": i + 1, "percent": p} for i, p in enumerate(outros)],
        "delta": delta,
        "delta_percent": delta_percent,
    }


def test_knowledge_delta_averages_only_the_players_who_were_measured():
    """A campaign with the questionnaire off has not measured anyone: that is not zero learning."""
    payloads = [
        _payload(knowledge=_knowledge(40.0, [70.0], 2, 30.0)),
        _payload(knowledge=_knowledge(None, [], None, None)),  # never measured
    ]
    summary = agg.knowledge_summary(payloads)

    assert summary["delta"]["n"] == 1
    assert summary["delta_percent"]["mean"] == pytest.approx(30.0)
    assert summary["intro_percent"]["mean"] == pytest.approx(40.0)


def test_replaying_players_give_the_campaign_a_learning_curve():
    """The reason every run's outro answers are stored."""
    payloads = [_payload(knowledge=_knowledge(30.0, [50.0, 80.0], 3, 50.0))]
    by_run = agg.knowledge_summary(payloads)["outro_percent_by_run"]

    assert by_run[1]["mean"] == pytest.approx(50.0)
    assert by_run[2]["mean"] == pytest.approx(80.0)


def test_the_latest_outro_is_the_one_used_for_the_headline():
    summary = agg.knowledge_summary([_payload(knowledge=_knowledge(30.0, [50.0, 80.0], 3, 50.0))])
    assert summary["latest_outro_percent"]["mean"] == pytest.approx(80.0)


# ── Everything together ──────────────────────────────────────────────────────


def test_fresh_and_spiral_runs_are_counted_separately():
    aggregated = agg.aggregate_results([_payload(), _payload(spiral=True), _payload(spiral=True)])
    assert (aggregated["runs"], aggregated["fresh_runs"], aggregated["spiral_runs"]) == (3, 1, 2)


def test_an_empty_campaign_aggregates_to_something_the_page_can_render():
    """No finished runs yet is the normal state of a new campaign, not an error."""
    aggregated = agg.aggregate_results([])
    assert aggregated["runs"] == 0
    assert aggregated["overall"]["mean"] is None
    assert aggregated["grades"] == {g: 0 for g in agg.GRADE_ORDER}
    assert aggregated["hardest_challenges"] == []


def test_metric_ratios_are_averaged_per_gauge():
    payloads = [
        _payload(metrics={"metrics": [{"id": "model", "ratio": 0.4}]}),
        _payload(metrics={"metrics": [{"id": "model", "ratio": 0.8}]}),
    ]
    assert agg.metric_summary(payloads)["model"]["mean"] == pytest.approx(0.6)


def test_metric_series_are_averaged_per_challenge_index():
    payloads = [
        _payload(metrics={"metrics": [{"id": "model", "ratio": 0.4, "series": [0.2, 0.4]}]}),
        _payload(metrics={"metrics": [{"id": "model", "ratio": 0.8, "series": [0.6, 0.8]}]}),
    ]
    series = agg.metric_series_summary(payloads)["model"]
    assert [point["mean"] for point in series] == [pytest.approx(0.4), pytest.approx(0.6)]


def test_a_run_that_ended_earlier_stops_contributing_rather_than_counting_as_zero():
    """The reading past a shorter run's last challenge is absent, not a bad one."""
    payloads = [
        _payload(metrics={"metrics": [{"id": "model", "ratio": 0.2, "series": [0.2]}]}),
        _payload(metrics={"metrics": [{"id": "model", "ratio": 0.8, "series": [0.6, 0.8]}]}),
    ]
    series = agg.metric_series_summary(payloads)["model"]
    assert (series[0]["n"], series[0]["mean"]) == (2, pytest.approx(0.4))
    assert (series[1]["n"], series[1]["mean"]) == (1, pytest.approx(0.8))


# ── Mood over time ───────────────────────────────────────────────────────────


def test_mood_series_are_averaged_per_challenge_index():
    payloads = [
        _payload(mood={"steps": 2, "series": {"dave": [0.3, 0.5]}}),
        _payload(mood={"steps": 2, "series": {"dave": [0.7, 0.9]}}),
    ]
    series = agg.mood_series_summary(payloads)["dave"]
    assert [point["mean"] for point in series] == [pytest.approx(0.5), pytest.approx(0.7)]


def test_a_stakeholder_absent_at_a_point_does_not_count_as_zero_mood():
    """Not in the room is not a bad reading."""
    payloads = [
        _payload(mood={"steps": 2, "series": {"dave": [0.4, None]}}),
        _payload(mood={"steps": 2, "series": {"dave": [0.6, 0.8]}}),
    ]
    series = agg.mood_series_summary(payloads)["dave"]
    assert (series[1]["n"], series[1]["mean"]) == (1, pytest.approx(0.8))
