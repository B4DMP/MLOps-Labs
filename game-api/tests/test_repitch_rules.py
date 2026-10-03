"""Re-pitch rules (docs/plans/intro-pitch-handholding.md, section 10): stakeholders react to what
changed for them, and a standing objection builds a capped, recoverable impatience meter.

Pure `evaluate_pitch` tests, no database. Ruth is fine with the base card; Dave objects until
`data.validation` is automated.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from conftest import make_intel_item as _item, make_target as _target
from mlops_serious_game.application.action_card_pitch_service import nodes
from mlops_serious_game.application.action_card_pitch_service.service import run_action_card_pitch_workflow
from mlops_serious_game.application.pitch_debate_service import session
from mlops_serious_game.application.pitch_debate_service.scoring import buy_in_band
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import GraphState

NEUTRAL = {
    d: 0.5 for d in ("fairness", "trust", "stress", "confidence", "perceived_risk", "interest", "sense_of_control")
}
RUTH, DAVE = "reliability_ruth", "data_dave"
ROOM = [(RUTH, "high"), (DAVE, "low")]


def _intel():
    return [
        _item("r1", RUTH, "driver", suggested=_target("ops.alerting", 3)),
        _item("d1", DAVE, "driver", suggested=_target("data.validation", 3)),
    ]


def _change(target, value):
    return session.AtomicChange(target=target, kind="raise_to", axis="automation", value=value)


BASE = [_change("ops.alerting", 3)]  # Ruth fine, Dave objecting
OTHER_UNHELPFUL = [_change("ops.alerting", 3), _change("data.ingestion", 2)]  # nothing new for either
ANSWERS_DAVE = [_change("ops.alerting", 3), _change("data.validation", 3)]


def _pitch(real, changes, previous=None, **kw):
    return session.evaluate_pitch(
        graph=real,
        state=GraphState.from_config(real),
        all_intel=_intel(),
        changes=changes,
        room=ROOM,
        current_emotions={RUTH: dict(NEUTRAL), DAVE: dict(NEUTRAL)},
        previous=previous,
        presentation_count=2 if previous else 1,
        **kw,
    )


def _read(view, st_id):
    return next(r for r in view.reads if r.stakeholder_id == st_id)


def _stand(real, rounds):
    """The base card pitched again `rounds` times with Dave's objection standing."""
    state, view, _ = _pitch(real, BASE)
    for _ in range(rounds):
        state, view, _ = _pitch(real, OTHER_UNHELPFUL, previous=state)
    return state, view


def test_first_pitch_has_no_repeat_context_and_no_impatience(real):
    state, view, _ = _pitch(real, BASE)
    assert state.repeat_context == {}
    assert state.impatience == {RUTH: 0, DAVE: 0}
    assert _read(view, DAVE).impatience == 0


def test_fine_and_unchanged_stakeholder_is_untouched_and_quiet(real):
    first, _, _ = _pitch(real, BASE)
    second, view, _ = _pitch(real, OTHER_UNHELPFUL, previous=first)

    assert second.repeat_context[RUTH] == "quiet"
    assert session.quiet_stakeholders(second) == {RUTH}
    assert second.emotion_deltas[RUTH] == {}
    assert second.impatience[RUTH] == 0
    assert _read(view, RUTH).emotion_values == NEUTRAL


def test_objecting_and_unchanged_stakeholder_gains_impatience(real):
    first, view1, _ = _pitch(real, BASE)
    second, view2, _ = _pitch(real, OTHER_UNHELPFUL, previous=first)

    assert second.repeat_context[DAVE] == "unchanged"
    assert second.impatience[DAVE] == 1
    # Same card-driven deltas as last time, plus the derived (never stored) offset.
    assert second.emotion_deltas[DAVE] == first.emotion_deltas[DAVE]
    r1, r2 = _read(view1, DAVE), _read(view2, DAVE)
    assert r2.impatience == 1
    assert r2.emotion_values["trust"] < r1.emotion_values["trust"]
    assert r2.emotion_values["stress"] > r1.emotion_values["stress"]
    assert r2.buy_in < r1.buy_in


def test_impatience_grows_less_each_step_and_holds_at_the_cap(real):
    cap = EmotionFactory.get_pitch_tuning().impatience_cap
    trust = []
    for rounds in range(1, cap + 3):
        state, view = _stand(real, rounds)
        trust.append(_read(view, DAVE).emotion_values["trust"])
        assert state.impatience[DAVE] == min(rounds, cap)
    drops = [-(b - a) for a, b in zip(trust, trust[1:])]
    assert drops[0] > drops[1] > 0  # second step hurts less than the first
    assert trust[cap - 1] == pytest.approx(trust[-1])  # nothing further past the cap


def test_answered_objection_releases_impatience_and_earns_relief(real):
    cap = EmotionFactory.get_pitch_tuning().impatience_cap
    stuck, _ = _stand(real, cap)
    assert stuck.impatience[DAVE] == cap

    answered, view, _ = _pitch(real, ANSWERS_DAVE, previous=stuck)
    fresh, _, _ = _pitch(real, ANSWERS_DAVE)

    assert answered.repeat_context[DAVE] == "answered"
    assert answered.impatience[DAVE] == 1
    assert _read(view, DAVE).impatience == 1
    relief = EmotionFactory.get_pitch_tuning().impatience_relief
    assert answered.emotion_deltas[DAVE]["trust"] > fresh.emotion_deltas[DAVE]["trust"]
    assert answered.emotion_deltas[DAVE]["fairness"] > fresh.emotion_deltas[DAVE]["fairness"]
    assert answered.emotion_deltas[DAVE]["trust"] - fresh.emotion_deltas[DAVE]["trust"] == pytest.approx(relief, rel=0.6)

    settled, _, _ = _pitch(real, BASE + [_change("data.validation", 3), _change("data.ingestion", 2)], previous=answered)
    assert settled.impatience[DAVE] == 0  # the last step fades on the next calm pitch


def test_changed_but_unanswered_objection_still_builds_impatience(real):
    first, _, _ = _pitch(real, BASE)
    # A card that moves Dave's reading without answering him (a violated boundary would do the same).
    dave_boundary = _item(
        "b1", DAVE, "boundary",
        holds={"component": "data.ingestion", "axis": "automation", "op": "gte", "level": 3, "on": "nominal"},
    )
    second, _, _ = session.evaluate_pitch(
        graph=real,
        state=GraphState.from_config(real),
        all_intel=_intel() + [dave_boundary],
        changes=OTHER_UNHELPFUL,
        room=ROOM,
        current_emotions={RUTH: dict(NEUTRAL), DAVE: dict(NEUTRAL)},
        previous=first,
        presentation_count=2,
    )
    assert second.repeat_context[DAVE] == "changed_unanswered"
    assert second.impatience[DAVE] == 1


def test_free_repeat_skips_the_step_but_keeps_the_context(real):
    first, _, _ = _pitch(real, BASE)
    second, _, _ = _pitch(real, OTHER_UNHELPFUL, previous=first, free_repeat=True)
    assert second.repeat_context[DAVE] == "unchanged"
    assert second.impatience[DAVE] == 0


def test_impatience_offset_scales_with_stress_and_control_sensitivity():
    calm = session.impatience_offset(1, {"stress": 1.0, "sense_of_control": 1.0})
    touchy = session.impatience_offset(1, {"stress": 1.3, "sense_of_control": 1.5})
    assert touchy["trust"] < calm["trust"] < 0
    assert session.impatience_offset(0) == {}


def test_identical_card_is_still_refused_as_the_same_card():
    a = [_change("ops.alerting", 3), _change("data.validation", 2)]
    b = [_change("data.validation", 2), _change("ops.alerting", 3)]
    assert session.same_card(a, b)
    assert not session.same_card(a, a[:1])


# ---------- buy-in bands ----------


@pytest.mark.parametrize(
    "value, band",
    [(0.0, "very_low"), (0.19, "very_low"), (0.2, "low"), (0.39, "low"), (0.4, "medium"),
     (0.59, "medium"), (0.6, "high"), (0.79, "high"), (0.8, "very_high"), (1.0, "very_high")],
)
def test_buy_in_band_cut_points(value, band):
    assert buy_in_band(value) == band


def test_reads_carry_their_band(real):
    _, view, _ = _pitch(real, BASE)
    for read in view.reads:
        assert read.buy_in_band == buy_in_band(read.buy_in)


# ---------- reaction chain: attempt and repeat context ----------


@pytest.mark.anyio
async def test_stakeholder_chain_receives_attempt_and_repeat_context():
    chain = AsyncMock()
    chain.ainvoke.return_value = "Better."
    state = {
        "pitch_attempt": 3,
        "stakeholders": [{"stakeholder_id": "data_dave", "stakeholder_name": "Dave", "repeat_context": "answered"}],
    }
    with patch.object(nodes, "get_stakeholder_pitch_chain", return_value=chain):
        await nodes.generate_stakeholder_pitch_responses_node(state)
    sent = chain.ainvoke.await_args.args[0]
    assert sent["pitch_attempt"] == 3
    assert sent["repeat_context"] == "answered"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "context, expected",
    [
        ("unchanged", "You brought me the same problem again."),
        ("answered", "Better. That took a while."),
        ("changed_unanswered", "Different, but not enough. The proposal completely neglects my demand for"),
        (None, "The proposal completely neglects my demand for"),
    ],
)
async def test_fallback_lines_are_repeat_aware(context, expected):
    stakeholder = {
        "stakeholder_id": "data_dave", "stakeholder_name": "Dave", "is_approval": context == "answered",
        "objection_kind": "none" if context == "answered" else "driver", "objection_target": "validation",
        "repeat_context": context,
    }
    broken_graph = MagicMock()
    broken_graph.compile.return_value.ainvoke = AsyncMock(side_effect=RuntimeError("no llm"))
    with patch(
        "mlops_serious_game.application.action_card_pitch_service.service.create_action_card_pitch_graph",
        return_value=broken_graph,
    ):
        _, responses, _ = await run_action_card_pitch_workflow(
            user_id=1, phase_id=0, challenge_id=113, challenge_context="", pitch_attempt=2,
            action_card_summary="", action_card_commitments=[], stakeholders=[stakeholder],
        )
    assert responses[0]["message"].startswith(expected)


def test_free_repeat_is_remembered_as_spent(real):
    first, _, _ = _pitch(real, BASE)
    free, _, _ = _pitch(real, OTHER_UNHELPFUL, previous=first, free_repeat=True)
    later, _, _ = _pitch(real, BASE + [_change("data.ingestion", 3)], previous=free)
    assert free.free_repeat_used and later.free_repeat_used
    assert later.impatience[DAVE] == 1
