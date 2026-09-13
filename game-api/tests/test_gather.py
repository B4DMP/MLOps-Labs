"""Gather: engagement cards buy conversations, not batches (D49, plan 11)."""

from types import SimpleNamespace

from conftest import make_intel_item as _item

from mlops_serious_game.application.pitch_debate_service import gather
from mlops_serious_game.domain.requirement import ConfidenceType, IntelTag


def _req(req_id, tag):
    return SimpleNamespace(id=req_id, type=tag)


def _conv(card_id="eng_1", stakeholder_id="dave", turns_left=3, **kw):
    return gather.GatherConversation(card_id=card_id, stakeholder_id=stakeholder_id, turns_left=turns_left, **kw)


# ---------- gather_options_for ----------

def test_open_question_unavailable_once_everything_in_scope_is_known():
    conv = _conv()
    pool = [_req("h1", IntelTag.DRIVER)]
    held = [_item("h1", "dave", "driver", intel_type=ConfidenceType.VERIFIED)]
    opts = gather.gather_options_for(conv, held, pool, [], True, [], [], seed="s")
    open_q = next(o for o in opts if o.option == "open_question")
    assert open_q.available is False
    assert "nothing left" in open_q.reason


def test_test_hypothesis_fans_out_up_to_three_unconfirmed_items_in_stable_order():
    conv = _conv()
    held = [_item(f"h{i}", "dave", "driver", intel_type=ConfidenceType.UNCONFIRMED) for i in range(5)]
    opts = gather.gather_options_for(conv, held, [], [], True, [], [], seed="fixed-seed")
    tests = [o for o in opts if o.option == "test_hypothesis"]
    assert len(tests) == 3
    assert all(o.available for o in tests)
    # Same seed, same items -> same picks and order every time (no randomness).
    opts2 = gather.gather_options_for(conv, held, [], [], True, [], [], seed="fixed-seed")
    assert [o.item_id for o in opts2 if o.option == "test_hypothesis"] == [o.item_id for o in tests]


def test_test_hypothesis_reads_the_players_own_tag_not_the_true_one():
    conv = _conv()
    # Truly a Driver, but the player filed it as a Boundary - a Boundary-only card must still see it.
    held = [_item("h1", "dave", "driver", categorized_type="boundary", intel_type=ConfidenceType.UNCONFIRMED)]
    opts = gather.gather_options_for(conv, held, [], ["boundary"], True, [], [], seed="s")
    tests = [o for o in opts if o.option == "test_hypothesis"]
    assert [o.item_id for o in tests] == ["h1"]


def test_trial_balloon_offers_every_archetype_not_yet_ruled_out():
    conv = _conv()
    opts = gather.gather_options_for(
        conv, [], [], [], False, ruled_out_archetypes=["skeptic"],
        all_archetype_names=["skeptic", "analyst", "visionary"], seed="s",
    )
    balloons = [o for o in opts if o.option == "trial_balloon"]
    assert sorted(o.archetype for o in balloons) == ["analyst", "visionary"]


def test_trial_balloon_unavailable_once_verified_or_all_ruled_out():
    conv = _conv()
    verified = gather.gather_options_for(conv, [], [], [], True, [], ["a"], seed="s")
    all_ruled_out = gather.gather_options_for(conv, [], [], [], False, ["a"], ["a"], seed="s")
    assert next(o for o in verified if o.option == "trial_balloon").available is False
    assert next(o for o in all_ruled_out if o.option == "trial_balloon").available is False


def test_one_on_one_needs_a_boundary_and_a_trade_off_or_driver_and_only_deep_dive_offers_it():
    conv = _conv()
    boundary_only = [_item("b1", "dave", "boundary")]
    pair = boundary_only + [_item("d1", "dave", "driver")]
    assert gather.one_on_one_pair(boundary_only, "dave") is None
    assert gather.one_on_one_pair(pair, "dave") == (boundary_only[0], pair[1])

    opts = gather.gather_options_for(conv, pair, [], [], True, [], [], seed="s", one_on_one_eligible=True)
    assert next(o for o in opts if o.option == "one_on_one").available is True

    opts_used = gather.gather_options_for(
        _conv(one_on_one_used=True), pair, [], [], True, [], [], seed="s", one_on_one_eligible=True,
    )
    used_spec = next(o for o in opts_used if o.option == "one_on_one")
    assert used_spec.available is False and "already used" in used_spec.reason


# ---------- turn resolution ----------

def test_open_question_reveals_next_in_stable_order_and_spends_a_turn():
    conv = _conv(turns_left=2)
    pool = [_req("r1", IntelTag.DRIVER), _req("r2", IntelTag.DRIVER)]
    out = gather.resolve_open_question(conv, pool, set(), [], seed="s", stakeholder_name="Dave")
    assert out.result == "revealed"
    assert out.item_id in {"r1", "r2"}
    assert out.conversation.turns_left == 1
    assert out.conversation.discovered_item_ids == [out.item_id]
    assert out.events[0].cause == "intel.revealed"

    # Same seed, same pool -> same item every time.
    out2 = gather.resolve_open_question(conv, pool, set(), [], seed="s", stakeholder_name="Dave")
    assert out2.item_id == out.item_id


def test_open_question_on_an_empty_pool_still_spends_the_turn():
    conv = _conv(turns_left=1)
    out = gather.resolve_open_question(conv, [], set(), [], seed="s", stakeholder_name="Dave")
    assert out.result == "nothing_left"
    assert out.conversation.turns_left == 0
    assert out.events == []


def test_open_question_rejected_with_no_turns_left():
    out = gather.resolve_open_question(_conv(turns_left=0), [_req("r1", IntelTag.DRIVER)], set(), [], "s", "Dave")
    assert out.result == "rejected"


def test_hypothesis_right_tag_infers_wrong_tag_refutes():
    conv = _conv(turns_left=2)
    right = _item("h1", "dave", "driver", categorized_type="driver")
    wrong = _item("h2", "dave", "driver", categorized_type="boundary")
    held_by_id = {"h1": right, "h2": wrong}

    hit = gather.resolve_test_hypothesis(conv, held_by_id, "h1", "Dave")
    assert hit.result == "inferred" and hit.item_id == "h1"
    assert hit.conversation.tested_item_ids == ["h1"]
    assert hit.conversation.turns_left == 1
    assert hit.events[0].cause == "intel.inferred"

    miss = gather.resolve_test_hypothesis(conv, held_by_id, "h2", "Dave")
    assert miss.result == "refuted" and miss.item_id == "h2"
    assert miss.emotion_delta == gather.EMOTION_REFUTED
    assert miss.events[0].cause == "intel.refuted"


def test_hypothesis_cannot_retest_the_same_item_twice_in_one_conversation():
    conv = _conv(tested_item_ids=["h1"])
    held_by_id = {"h1": _item("h1", "dave", "driver", categorized_type="driver")}
    out = gather.resolve_test_hypothesis(conv, held_by_id, "h1", "Dave")
    assert out.result == "rejected"


def test_generic_question_reveals_nothing_to_the_dossier():
    conv = _conv(turns_left=1)
    pool = [_req("r1", IntelTag.FACT)]
    out = gather.resolve_generic_question(conv, pool, set(), "s", "Dave")
    assert out.result == "gist"
    assert out.item_id == "r1"
    assert out.conversation.discovered_item_ids == []  # nothing enters the dossier
    assert out.conversation.turns_left == 0


def test_generic_question_uses_gist_of_to_fill_the_event_text():
    """D52: the pure module never knows about gists content or metric names - it just calls
    whatever `gist_of` the caller (gather_handler.py) hands it, on whichever item it picked."""
    conv = _conv(turns_left=1)
    pool = [_req("r1", IntelTag.FACT)]
    out = gather.resolve_generic_question(conv, pool, set(), "s", "Dave", gist_of=lambda item: f"gist for {item.id}")
    assert out.events[0].params["gist"] == "gist for r1"

    # No gist_of given: defaults to an empty string rather than raising.
    default_out = gather.resolve_generic_question(_conv(turns_left=1), pool, set(), "s", "Dave")
    assert default_out.events[0].params["gist"] == ""


def test_gist_or_fallback_prefers_the_authored_gist_then_the_metric_template():
    from mlops_serious_game.domain.requirement import gist_or_fallback

    with_gist = _item("h1", "dave", "driver")
    with_gist.gist = "Data quality keeps coming up whenever you talk to him."
    assert gist_or_fallback(with_gist, "Data Dave", "Data Quality") == with_gist.gist

    without_gist = _item("h2", "dave", "driver")
    without_gist.gist = None
    assert gist_or_fallback(without_gist, "Data Dave", "Data Quality") == "Data Dave keeps bringing up Data Quality."
    assert gist_or_fallback(without_gist, "Data Dave", None) == "Data Dave keeps bringing up their part of the project."


def test_trial_balloon_match_verifies_miss_rules_out():
    conv = _conv(turns_left=2)
    match = gather.resolve_trial_balloon(conv, "analyst", "analyst", "Dave")
    assert match.result == "archetype_matched"
    assert match.emotion_delta == gather.EMOTION_TRIAL_BALLOON_MATCH

    miss = gather.resolve_trial_balloon(conv, "skeptic", "analyst", "Dave")
    assert miss.result == "archetype_ruled_out"
    assert miss.archetype == "skeptic"
    assert miss.emotion_delta == gather.EMOTION_TRIAL_BALLOON_MISS
    # Never reveals the true tag.
    assert "analyst" not in miss.events[0].params.values()


def test_one_on_one_right_pair_hits_wrong_pair_misses_and_only_fires_once():
    conv = _conv(turns_left=2)
    boundary = _item("b1", "dave", "boundary", categorized_type="boundary")
    driver = _item("d1", "dave", "driver", categorized_type="driver")
    hit = gather.resolve_one_on_one(conv, boundary, driver, "Dave")
    assert hit.result == "one_on_one_hit"
    assert hit.conversation.one_on_one_used is True

    again = gather.resolve_one_on_one(hit.conversation, boundary, driver, "Dave")
    assert again.result == "rejected"

    misfiled_driver = _item("d2", "dave", "driver", categorized_type="boundary")
    miss = gather.resolve_one_on_one(conv, boundary, misfiled_driver, "Dave")
    assert miss.result == "one_on_one_miss"
    assert miss.emotion_delta == gather.EMOTION_ONE_ON_ONE_MISS


def test_close_conversation_logs_lost_turns_only_when_any_remain():
    lost = gather.close_conversation(_conv(turns_left=2), "Dave")
    assert lost.conversation.closed is True
    assert lost.events[0].cause == "card.turn_lost"
    assert lost.events[0].params["n"] == "2"

    none_lost = gather.close_conversation(_conv(turns_left=0), "Dave")
    assert none_lost.events == []
