"""Play profiles and the per-grudge penalty count (docs/plans/shorter-playthrough-and-grade-spread.md)."""

from types import SimpleNamespace

from mlops_serious_game.application.pitch_debate_service import card_search as auto_card
from mlops_serious_game.application.playtest_service.profiles import BAD, MEDIUM, PERFECT, profile_named
from mlops_serious_game.application.results_service.service import _distinct_fired_grudges

from test_playtest import _world


def _event(cause: str, subject: str):
    return SimpleNamespace(cause=cause, subject_id=subject)


def test_an_unknown_profile_plays_perfectly():
    assert profile_named(None) is PERFECT
    assert profile_named("nonsense") is PERFECT
    assert profile_named("bad") is BAD


def test_profiles_get_worse_in_every_dimension():
    assert PERFECT.is_perfect and not MEDIUM.is_perfect
    assert PERFECT.intel_coverage > MEDIUM.intel_coverage > BAD.intel_coverage
    assert PERFECT.intel_accuracy > MEDIUM.intel_accuracy > BAD.intel_accuracy


def test_a_grudge_that_fires_twice_is_one_grudge():
    events = [_event("grudge.written", "ruth"), _event("grudge.fired", "ruth"), _event("grudge.fired", "ruth")]
    assert _distinct_fired_grudges(events) == 1


def test_a_grudge_that_never_fired_costs_nothing():
    assert _distinct_fired_grudges([_event("grudge.written", "ruth")]) == 0


def test_two_grudges_on_one_stakeholder_count_twice_when_both_fired():
    events = [_event("grudge.written", "ruth")] * 2 + [_event("grudge.fired", "ruth")] * 3
    assert _distinct_fired_grudges(events) == 2


def test_aiming_for_a_veto_never_returns_a_better_card_than_aiming_for_a_pass():
    world = _world()
    aimed_low = auto_card.search_card(seed="s", budget=60, prefer="veto", **world)
    aimed_high = auto_card.search_card(seed="s", budget=60, prefer="pass", **world)
    rank = {"VETO": 0, "SOFT_PASS": 1, "PASS": 2}
    assert rank[aimed_low.outcome] <= rank[aimed_high.outcome]


def test_the_best_search_is_never_worse_than_a_random_acceptable_card():
    world = _world(112)
    best = auto_card.search_card(seed="s", budget=60, prefer="best", **world)
    random_pick = auto_card.search_card(seed="s", budget=60, prefer="pass", **world)
    rank = {"VETO": 0, "SOFT_PASS": 1, "PASS": 2}
    assert rank[best.outcome] >= rank[random_pick.outcome]
    assert best.min_buy_in >= random_pick.min_buy_in
