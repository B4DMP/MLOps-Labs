"""Tests for the Veto Breaker mechanic (D15).

This restores a link that was dropped, not a new design: the pipeline side (`grudges_created`,
`veto_degradation_ops`, `_stakeholder_execution`'s VETO_BROKEN branch in
`graph_service/pipeline.py`) was never removed and needed no changes. What broke, during the
atomic-changes rewrite, was purely the thin link between the pitch layer and it: `PitchState` lost
its `patience` field, and `simulation_handler._outcome_for`/`_overridden` (which used to derive
"this was pushed through" from patience hitting zero) silently became permanent no-ops.

Two halves, matching that split:

- The pure half (`session.veto_breaker`, `simulation_handler._outcome_for`/`_overridden`) is
  tested directly on hand-built state, no database.
- The handler half is driven end to end against a real throwaway Postgres and the real
  `ch_shadow_deployment_contract` (118) challenge, the concrete case this exists for.
  Automation_alex's two stance items there used to carry no graph atoms or targets at all
  (`RequirementObjects.json`), pinning his alignment at -1.0 and, being high-power, making the
  challenge an unconditional veto - no card the room would ever accept. That content gap is now
  authored (both items resolve against `deploy.shadow`, the same target Ruth's boundary and the
  challenge's own conflict block already use), so the fixture card below is deliberately a weak
  one - it still gets vetoed, exercising the override on a real, ordinary veto rather than a
  structural dead end.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory

from test_run_scope import _seed_user, _start_run, _uid, migrated_db  # noqa: F401  (fixture used by name)

# The challenge this mechanic exists for. Automation_alex, high-power, has two Trade-off items
# whose branches both resolve on `deploy.shadow`: 4 (governed, what Ruth's boundary needs) or 2
# (manual, his own stated position in the challenge's conflict block) either satisfies him. A card
# that raises `deploy.shadow` far enough clears him with no override needed; the fixture below
# deliberately does not, to still exercise a real veto.
STUCK_CHALLENGE_ID = 118
STUCK_PHASE_ID = 4


# ── The pure half ─────────────────────────────────────────────────────────────


def test_veto_breaker_forces_the_outcome_to_pass_and_records_who_was_overridden():
    state = pitch.PitchState(stage="DONE", outcome="VETO")
    updated, events = pitch.veto_breaker(state, "automation_alex", names={"automation_alex": "Alex"})

    assert updated.stage == "DONE"
    assert updated.outcome == "PASS"
    assert updated.overridden_stakeholder_id == "automation_alex"


def test_veto_breaker_emits_both_the_emotion_and_the_outcome_event_with_the_configured_causes():
    state = pitch.PitchState(stage="DONE", outcome="VETO")
    _, events = pitch.veto_breaker(state, "automation_alex")

    causes = {e.cause: e for e in events}
    assert causes["emotion.veto_breaker"].subject_id == "automation_alex"
    assert causes["emotion.veto_breaker"].direction == "down"
    assert causes["outcome.veto_breaker"].subject_id == "automation_alex"


def test_veto_breaker_does_not_mutate_the_state_passed_in():
    """A pure function: the caller's own reference must be unaffected."""
    state = pitch.PitchState(stage="DONE", outcome="VETO")
    pitch.veto_breaker(state, "automation_alex")
    assert state.outcome == "VETO"
    assert state.overridden_stakeholder_id is None


def test_outcome_for_reads_the_override_field_not_the_removed_patience_field():
    from mlops_serious_game.application.graph_service.pipeline import PASS, VETO_BROKEN
    from mlops_serious_game.infrastructure.websocket.handlers.simulation_handler import (
        _outcome_for,
        _overridden,
    )

    broken = pitch.PitchState(stage="DONE", outcome="PASS", overridden_stakeholder_id="automation_alex")
    assert _outcome_for(broken) == VETO_BROKEN
    assert _overridden(broken) == "automation_alex"

    ordinary_pass = pitch.PitchState(stage="DONE", outcome="PASS")
    assert _outcome_for(ordinary_pass) == PASS
    assert _overridden(ordinary_pass) is None


# ── The handler half, end to end ─────────────────────────────────────────────


def _a_veto_worthy_card():
    """A card weak enough to still lose the room: `deploy.shadow` only reaches 1, short of both
    the governed level Ruth's boundary and Alex's trade-offs accept (4) and the manual level
    Alex's trade-offs would also accept on their own (2). Alex, high-power, stays vetoed.

    `e.cicd_shadow` is deliberately not on this card: its endpoints are not both in this
    challenge's allowed-target set (`deploy.cicd` is not), so it is not a legal target here at
    all - `handle_pitch_set_card` would reject the whole card for naming it.
    """
    return [
        {"target": "deploy.shadow", "kind": "raise_to", "axis": "automation", "value": 1},
    ]


async def _seed_player_on_stuck_challenge(username: str = "alice") -> int:
    """A player mid-game, dropped directly onto ch118 with its intel gathered and its targets
    observed - what `playtest_service.service.auto_gather` and `_observe_everything` do for the
    playtest tools, reused here so the pitch itself is the only thing under test."""
    from mlops_serious_game.application.playtest_service.service import auto_gather
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge, GameSession

    user_id = _seed_user(username)
    _start_run(user_id, 1, None)
    challenge = PhaseFactory.get_challenge_by_id(STUCK_CHALLENGE_ID)

    with get_session() as session:
        session.add(
            GameChallenge(
                user_id=user_id, run_index=1,
                phase_index=challenge.phase_id, challenge_index=challenge.id, challenge_loop_index=1,
                action_card={}, metric_values=[], messages=[], attention_tokens=20, emotion_values={},
            )
        )
        session.add(GameSession(user_id=user_id, run_index=1))

    auto_gather(user_id, challenge)

    from mlops_serious_game.application.graph_service import store as graph_store

    # Seeds the graph if this player has never had one, and fires the challenge's own entry ops -
    # the same thing every real handler does before touching the graph.
    graph_store.enter_challenge(user_id, challenge)

    return user_id


def _mock_ws():
    return MagicMock()


async def _handle(handler_name: str, payload: dict, username: str = "alice"):
    from mlops_serious_game.infrastructure.websocket.handlers import log_handler, pitch_handler

    with patch.object(pitch_handler, "manager") as manager, \
         patch.object(log_handler, "manager") as log_manager:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        log_manager.send_event = AsyncMock()
        await getattr(pitch_handler, handler_name)(_mock_ws(), _uid(username), payload)
    sent = [c.kwargs["payload"] for c in manager.send_event.await_args_list]
    return sent[-1] if sent else None


async def _commit_a_veto(username: str = "alice") -> dict:
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    await _handle("handle_pitch_set_card", {**ids, "atomic_changes": _a_veto_worthy_card()}, username)
    return await _handle("handle_pitch_commit", ids, username)


@pytest.mark.anyio
async def test_the_fixture_card_still_gets_vetoed(migrated_db):
    """The control: confirms the fixture card reproduces a real veto before testing the override."""
    await _seed_player_on_stuck_challenge()
    result = await _commit_a_veto()
    assert result["outcome"] == "VETO"
    assert result["veto_info"]["stakeholder_id"] == "automation_alex"


# The content fix this restoration was paired with (docs/plans/results-screen.md): ch118 used to
# be an unconditional veto because automation_alex's two Trade-off items carried no graph atoms or
# targets at all. Both now resolve against `deploy.shadow`, so a real search-built card that
# clears Ruth's boundary satisfies Alex too, with no Escalation Point spent -
# `test_skip_no_longer_needs_the_fallback_on_ch118` in test_playtest_veto_breaker.py confirms this
# end to end. A hand-built card that only sets `deploy.shadow` directly is deliberately not used
# here as its own test: `deploy.shadow`'s actual reachable level also depends on its upstream
# pipeline chain (`e.cicd_shadow` and beyond), and that slack computation has a pre-existing,
# unrelated flakiness (hash-order dependent) that a single-target card can trip.


@pytest.mark.anyio
async def test_veto_breaker_is_refused_with_nothing_committed(migrated_db):
    await _seed_player_on_stuck_challenge()
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    from mlops_serious_game.infrastructure.websocket.handlers import pitch_handler

    with patch.object(pitch_handler, "manager") as manager:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        await pitch_handler.handle_pitch_veto_breaker(_mock_ws(), _uid(), ids)
        assert "error" in manager.send_event.await_args.kwargs["payload"]


@pytest.mark.anyio
async def test_veto_breaker_is_refused_when_the_commit_was_not_a_veto(migrated_db):
    """Only a stood veto can be pushed through; a fine card needs no escalation."""
    await _seed_player_on_stuck_challenge()
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    await _handle("handle_pitch_set_card", {**ids, "atomic_changes": []})
    # No atomic changes committed means "configure a card first", still not a stood veto.
    result = await _handle("handle_pitch_veto_breaker", ids)
    assert result["error"] == "no veto standing to push through"


@pytest.mark.anyio
async def test_veto_breaker_pushes_the_card_through_and_spends_one_point(migrated_db):
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store

    await _seed_player_on_stuck_challenge()
    await _commit_a_veto()
    assert pitch_store.escalation_points(_uid()) == 3

    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    result = await _handle("handle_pitch_veto_breaker", ids)

    assert result["outcome"] == "PASS"
    assert result["veto_info"] is None
    assert result.get("veto_broken") is True
    assert result["escalation_points"] == 2
    assert pitch_store.escalation_points(_uid()) == 2


@pytest.mark.anyio
async def test_veto_breaker_applies_the_malus_to_the_overridden_stakeholder(migrated_db):
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store

    await _seed_player_on_stuck_challenge()
    await _commit_a_veto()
    before = pitch_store.emotion_values(_uid(), ["automation_alex"])["automation_alex"]

    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    await _handle("handle_pitch_veto_breaker", ids)

    after = pitch_store.emotion_values(_uid(), ["automation_alex"])["automation_alex"]
    magnitude = EmotionFactory.get_pitch_tuning().emotion_veto_breaker
    for dim, value in before.items():
        assert after[dim] == pytest.approx(max(0.0, min(1.0, value + magnitude)), abs=1e-6)


@pytest.mark.anyio
async def test_veto_breaker_is_refused_once_escalation_points_run_out(migrated_db):
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store

    await _seed_player_on_stuck_challenge()
    for _ in range(3):
        pitch_store.spend_escalation_point(_uid())
    assert pitch_store.escalation_points(_uid()) == 0

    await _commit_a_veto()
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    result = await _handle("handle_pitch_veto_breaker", ids)

    assert result["error"] == "no Escalation Points left"
    assert result["outcome"] == "VETO"  # unchanged: the push-through never happened


@pytest.mark.anyio
async def test_a_broken_veto_reaches_the_pipeline_as_veto_broken_with_a_weight_two_grudge(migrated_db):
    """The end of the chain this whole mechanic exists for: the pipeline already knew what to do
    with VETO_BROKEN, it just never received one."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.infrastructure.websocket.handlers import simulation_handler

    await _seed_player_on_stuck_challenge()
    await _commit_a_veto()
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    await _handle("handle_pitch_veto_breaker", ids)

    from mlops_serious_game.infrastructure.websocket.handlers import log_handler

    with patch.object(simulation_handler, "manager") as manager,          patch.object(log_handler, "manager") as log_manager:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        log_manager.send_event = AsyncMock()
        await simulation_handler.handle_simulation_run(_mock_ws(), _uid(), ids)
        report_payload = next(
            c.kwargs["payload"] for c in manager.send_event.await_args_list
            if c.kwargs["event"] == "graph:delta_report"
        )

    assert report_payload["report"]["outcome"] == "VETO_BROKEN"

    grudges = pitch_store.load_grudges(_uid())
    alex_grudge = next(g for g in grudges if g["stakeholder_id"] == "automation_alex")
    assert alex_grudge["weight"] == 2
    assert alex_grudge["reason"] == "overridden by an escalation"


@pytest.mark.anyio
async def test_a_broken_veto_can_cost_the_overridden_stakeholder_exactly_what_it_won(migrated_db):
    """`pipeline.veto_degradation_ops` costs the overridden stakeholder one level on whatever the
    card touched *that they own* (D-question 2) - deliberate, not something this mechanic changed.

    ch118 makes this visible in full: `deploy.shadow` starts at 0, the fixture card raises it to
    1, and Alex owns it, so the same low buy-in that caused the veto in the first place also caps
    how much of the raise actually sticks (`apply_ops`' owner-buyin mechanic). The card is not
    silently dropped (the report says so); Alex's own component is just the one place overriding
    them costs something visible.
    """
    from mlops_serious_game.application.graph_service import store as graph_store
    from mlops_serious_game.infrastructure.websocket.handlers import log_handler, simulation_handler

    await _seed_player_on_stuck_challenge()
    await _commit_a_veto()
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    await _handle("handle_pitch_veto_breaker", ids)

    with patch.object(simulation_handler, "manager") as manager, \
         patch.object(log_handler, "manager") as log_manager:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        log_manager.send_event = AsyncMock()
        await simulation_handler.handle_simulation_run(_mock_ws(), _uid(), ids)
        report_payload = next(
            c.kwargs["payload"] for c in manager.send_event.await_args_list
            if c.kwargs["event"] == "graph:delta_report"
        )

    # The report is honest about it: deploy.shadow shows up as touched, ending where it started.
    target_ids = [t["id"] for t in report_payload["report"]["targets"]]
    assert "deploy.shadow" in target_ids
    replay_state = graph_store.load_state(_uid()).state
    assert replay_state.value("deploy.shadow", "automation") == 0
