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
  `ch_silent_ingestion_failure` (120) challenge. Its boundaries are violated by any card that does
  not satisfy them, and two high-power stakeholders hold them, so a weak card is an ordinary, real
  veto. (It used to be `ch_shadow_deployment_contract` (118); the regenerated content there gives
  stakeholders enough Trade-offs that hardly any card is vetoed, see `plans/graph-redesign/04`.)
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory

from test_run_scope import _seed_user, _start_run, _uid, migrated_db  # noqa: F401  (fixture used by name)

# The challenge this mechanic exists for: a weak card is vetoed by a high-power stakeholder whose
# Boundary it leaves unmet. Content is regenerated now and then, so if this stops vetoing, repoint
# the three constants below to another challenge that still does (the room's high-power stakeholders
# and a card that leaves their Boundaries unmet).
STUCK_CHALLENGE_ID = 120
STUCK_PHASE_ID = 2
# The two high-power stakeholders whose Boundaries the fixture card leaves unmet. Which of them the
# room treats as "the" veto can flip with their emotions, so tests read it back instead of assuming.
VETOERS = {"reliability_ruth", "requirements_reuben"}


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
    """A card that leaves the high-power stakeholders' Boundaries unmet: it raises `data.ingestion`
    only to 2, which neither Ruth's nor Reuben's Boundary accepts, so the room vetoes it."""
    return [
        {"target": "data.ingestion", "kind": "raise_to", "axis": "automation", "value": 2},
    ]


async def _seed_player_on_stuck_challenge(username: str = "alice") -> int:
    """A player mid-game, dropped directly onto the stuck challenge with its intel gathered and its targets
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
    assert result["veto_info"]["stakeholder_id"] in VETOERS


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
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    before = pitch_store.emotion_values(_uid(), sorted(VETOERS))
    await _handle("handle_pitch_veto_breaker", ids)

    overridden = pitch_store.load_pitch(_uid(), STUCK_PHASE_ID, STUCK_CHALLENGE_ID).overridden_stakeholder_id
    assert overridden in VETOERS
    after = pitch_store.emotion_values(_uid(), [overridden])[overridden]
    magnitude = EmotionFactory.get_pitch_tuning().emotion_veto_breaker
    for dim, value in before[overridden].items():
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
    grudge = next(g for g in grudges if g["stakeholder_id"] in VETOERS)
    assert grudge["weight"] == 2
    assert grudge["reason"] == "overridden by an escalation"


@pytest.mark.anyio
async def test_a_broken_veto_costs_the_overridden_stakeholder_only_what_they_own(migrated_db):
    """`pipeline.veto_degradation_ops` costs the overridden stakeholder one level on whatever the
    card touched *that they own* (D-question 2) - deliberate, not something this mechanic changed.

    Here the fixture card touches `data.ingestion`, which Dave owns, and neither Ruth nor Reuben
    does, so whoever is overridden loses nothing: the whole raise sticks. The cost itself is covered
    where `veto_degradation_ops` is tested, against a stakeholder who owns the target.
    """
    from mlops_serious_game.application.graph_service import store as graph_store
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.domain.graph_factory import GraphFactory
    from mlops_serious_game.infrastructure.websocket.handlers import log_handler, simulation_handler

    await _seed_player_on_stuck_challenge()
    await _commit_a_veto()
    ids = {"phase_id": STUCK_PHASE_ID, "challenge_id": STUCK_CHALLENGE_ID}
    await _handle("handle_pitch_veto_breaker", ids)
    overridden = pitch_store.load_pitch(_uid(), STUCK_PHASE_ID, STUCK_CHALLENGE_ID).overridden_stakeholder_id

    with patch.object(simulation_handler, "manager") as manager,          patch.object(log_handler, "manager") as log_manager:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        log_manager.send_event = AsyncMock()
        await simulation_handler.handle_simulation_run(_mock_ws(), _uid(), ids)
        report_payload = next(
            c.kwargs["payload"] for c in manager.send_event.await_args_list
            if c.kwargs["event"] == "graph:delta_report"
        )

    loaded = graph_store.load_state(_uid())
    assert GraphFactory.get_graph().owner_of("data.ingestion") != overridden
    target_ids = [t["id"] for t in report_payload["report"]["targets"]]
    assert "data.ingestion" in target_ids
    assert loaded.state.value("data.ingestion", "automation") == 2
