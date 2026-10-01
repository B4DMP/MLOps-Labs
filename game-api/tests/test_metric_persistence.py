"""Tests for persisting the simulation's graph-driven metric deltas.

Bug: `DeltaReport.metric_deltas` (what the simulation actually did to the metrics, per
`pipeline.metric_deltas`) is computed and shown to the player on the simulation screen, but the
"proceed to next milestone" step that actually advances `metric_values`
(`handle_state_update_request`'s `case _` branch) reads them from `action_card["metric_changes"]`
on the *client's own request payload* - and `handleAcSimulationContinue` in `ac_simulation.tsx`
never sends that key. So the graph-driven change was computed, displayed, and then silently
dropped; only the static per-challenge config delta (usually zero) ever landed.

The fix: `handle_simulation_run` writes the deltas onto the challenge's own row
(`pitch_store.set_metric_changes`), and `handle_state_update_request` reads them from there
instead of trusting the payload for this field.

Real throwaway Postgres, reusing test_run_scope.py's fixture and test_playtest.py's `_begun_game`
helper for a player mid-challenge, since the interesting behaviour is what ends up in the database.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from mlops_serious_game.domain.metric_factory import MetricFactory

from test_run_scope import _seed_user, _start_run, migrated_db  # noqa: F401  (fixture used by name)
from test_playtest import _begun_game, _dealt_challenge  # noqa: F401  (helpers reused)

# Needs a real Postgres connection (not mocked) - excluded from CI via `-m "not db"`,
# runs locally/in docker-compose where Postgres is actually available.
pytestmark = pytest.mark.db



# ── set_metric_changes (pure DB unit) ────────────────────────────────────────


def _add_row(user_id: int, phase: int, challenge: int, action_card=None, username: str = "alice"):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    with get_session() as session:
        session.add(
            GameChallenge(
                user_name=username, user_id=user_id, run_index=1, phase_index=phase,
                challenge_index=challenge, challenge_loop_index=3,
                action_card=action_card or {}, metric_values=[10] * 8,
                messages=[], attention_tokens=20, emotion_values={},
            )
        )


def _action_card(username: str = "alice", phase: int = 1, challenge: int = 110) -> dict:
    from mlops_serious_game.application.pitch_debate_service.store import _latest_challenge_row
    from mlops_serious_game.infrastructure.database.connection import get_session

    with get_session() as session:
        row = _latest_challenge_row(session, username, phase, challenge)
        return dict(row.action_card) if row and isinstance(row.action_card, dict) else {}


@pytest.mark.anyio
async def test_set_metric_changes_writes_onto_the_challenge_row(migrated_db):
    from mlops_serious_game.application.pitch_debate_service.store import set_metric_changes

    user_id = _seed_user()
    _add_row(user_id, 1, 110)

    set_metric_changes("alice", 1, 110, {"model": 4, "automation": -2})

    assert _action_card()["metric_changes"] == {"model": 4, "automation": -2}


@pytest.mark.anyio
async def test_set_metric_changes_preserves_the_rest_of_the_action_card(migrated_db):
    """The pitch state lives in the same dict, under its own key - writing the metrics must not
    clobber it."""
    from mlops_serious_game.application.pitch_debate_service.store import set_metric_changes

    user_id = _seed_user()
    _add_row(user_id, 1, 110, action_card={"pitch": {"stage": "DONE"}, "title": "Automate it"})

    set_metric_changes("alice", 1, 110, {"model": 3})

    card = _action_card()
    assert card["pitch"] == {"stage": "DONE"}
    assert card["title"] == "Automate it"
    assert card["metric_changes"] == {"model": 3}


@pytest.mark.anyio
async def test_set_metric_changes_is_a_no_op_for_nothing_to_record(migrated_db):
    """A challenge whose card touched nothing the metrics weight must not overwrite an earlier,
    real recording with an empty one."""
    from mlops_serious_game.application.pitch_debate_service.store import set_metric_changes

    user_id = _seed_user()
    _add_row(user_id, 1, 110, action_card={"metric_changes": {"model": 7}})

    set_metric_changes("alice", 1, 110, {})

    assert _action_card()["metric_changes"] == {"model": 7}


@pytest.mark.anyio
async def test_set_metric_changes_on_a_missing_row_does_nothing(migrated_db):
    from mlops_serious_game.application.pitch_debate_service.store import set_metric_changes

    _seed_user()
    set_metric_changes("alice", 9, 999, {"model": 1})  # must not raise


@pytest.mark.anyio
async def test_set_metric_changes_is_idempotent_on_a_repeat_call(migrated_db):
    """`run_simulation` hands back the same stored report on a replay (its own idempotency
    guard), so a second call here must write the same thing, not accumulate."""
    from mlops_serious_game.application.pitch_debate_service.store import set_metric_changes

    user_id = _seed_user()
    _add_row(user_id, 1, 110)

    set_metric_changes("alice", 1, 110, {"model": 5})
    set_metric_changes("alice", 1, 110, {"model": 5})

    assert _action_card()["metric_changes"] == {"model": 5}


# ── The read side: handle_state_update_request ───────────────────────────────


async def _advance(username: str = "alice", **payload_overrides):
    """Sends the exact request `handleAcSimulationContinue` sends: `challenge_loop_index: 3`,
    no `action_card` key, and whatever `metric_values` the client currently holds."""
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import handle_state_update_request

    payload = {
        "phase_id": 1,
        "challenge_id": 110,
        "challenge_loop_index": 3,
        "metric_values": [10] * len(MetricFactory.get_available_metrics()),
        "action_card_id": None,
        "messages": [],
        "attention_tokens": 20,
        **payload_overrides,
    }
    with patch("mlops_serious_game.infrastructure.websocket.handlers.game_handler.manager") as manager:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        await handle_state_update_request(MagicMock(), username, payload)


def _final_metric_values(user_id: int):
    """The metric values as they stand for whatever challenge was just dealt.

    `handle_state_update_request`'s `case _` branch applies `ac_changes` to seed the *next*
    challenge's starting values, not to rewrite the one that just ended (that row keeps whatever
    the client last held for it) - so this reads the newest row, not the completed challenge's own.
    """
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    with get_session() as session:
        row = session.scalars(
            select(GameChallenge).where(GameChallenge.user_id == user_id).order_by(GameChallenge.id.desc())
        ).first()
        return list(row.metric_values)


@pytest.mark.anyio
async def test_the_client_never_sending_action_card_no_longer_drops_the_graph_deltas(migrated_db):
    """The bug, reproduced directly: the exact request the real client sends, against a challenge
    the simulation has already written deltas onto."""
    from mlops_serious_game.application.pitch_debate_service.store import set_metric_changes

    user_id = _seed_user()
    _add_row(user_id, 1, 110)
    set_metric_changes("alice", 1, 110, {"model": 6, "automation": 3})

    await _advance()

    model_index = MetricFactory.get_available_metrics().index("model")
    automation_index = MetricFactory.get_available_metrics().index("automation")
    values = _final_metric_values(user_id)
    assert values[model_index] == 16   # 10 (sent) + 6 (persisted)
    assert values[automation_index] == 13  # 10 + 3


@pytest.mark.anyio
async def test_a_challenge_with_no_recorded_deltas_advances_unchanged(migrated_db):
    """A challenge whose card touched nothing the metrics weight must not error, and must not
    invent a change."""
    user_id = _seed_user()
    _add_row(user_id, 1, 110)  # no metric_changes ever recorded

    await _advance()

    assert _final_metric_values(user_id) == [10] * len(MetricFactory.get_available_metrics())


@pytest.mark.anyio
async def test_an_explicit_payload_value_still_wins_over_the_persisted_one(migrated_db):
    """Nothing in the real client sends this today, but a future or test caller that does should
    not be silently overridden by what the simulation recorded."""
    from mlops_serious_game.application.pitch_debate_service.store import set_metric_changes

    user_id = _seed_user()
    _add_row(user_id, 1, 110)
    set_metric_changes("alice", 1, 110, {"model": 6})

    await _advance(action_card={"metric_changes": {"model": 99}})

    model_index = MetricFactory.get_available_metrics().index("model")
    assert _final_metric_values(user_id)[model_index] == 109  # 10 + 99, not 10 + 6


# ── End to end: handle_simulation_run actually records what it computed ─────


@pytest.mark.anyio
async def test_simulation_records_its_own_metric_deltas_on_the_challenge_row(migrated_db):
    """Drives the real pitch -> commit -> simulate chain (the same one `playtest_handler` uses)
    and checks the number the simulation reports is the number that gets written."""
    from mlops_serious_game.application.playtest_service import auto_card, service
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.infrastructure.websocket.handlers.pitch_handler import (
        PitchContext, get_allowed_targets, handle_pitch_commit,
    )
    from mlops_serious_game.infrastructure.websocket.handlers.simulation_handler import handle_simulation_run

    user_id = await _begun_game()
    challenge_id = _dealt_challenge(user_id)
    challenge = PhaseFactory.get_challenge_by_id(challenge_id)
    ids = {"phase_id": challenge.phase_id, "challenge_id": challenge.id}

    service.auto_gather("alice", challenge)
    ctx = PitchContext("alice", challenge.phase_id, challenge.id)

    result = auto_card.search_card(
        graph=ctx.graph, state=ctx.state, all_intel=list(ctx.all_intel),
        room=ctx.room, emotions=ctx.emotions,
        allowed=get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)),
        seed="metric-persistence-test",
    )
    assert result is not None and result.found_non_veto

    with patch("mlops_serious_game.infrastructure.websocket.handlers.pitch_handler.manager") as m1, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.simulation_handler.manager") as m2, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.log_handler.manager") as m3:
        for m in (m1, m2, m3):
            m.send_event = AsyncMock()
            m.send_error = AsyncMock()
        await handle_pitch_commit(MagicMock(), "alice", {**ids, "atomic_changes": [c.model_dump() for c in result.changes]})
        report_payload = None

        async def capture(*, websocket, event, payload):
            nonlocal report_payload
            if event == "graph:delta_report":
                report_payload = payload

        m2.send_event.side_effect = capture
        await handle_simulation_run(MagicMock(), "alice", ids)

    assert report_payload is not None
    reported_deltas = report_payload["report"]["metric_deltas"]

    card = _action_card("alice", challenge.phase_id, challenge.id)
    assert card.get("metric_changes", {}) == reported_deltas


@pytest.mark.anyio
async def test_reopening_the_simulation_screen_does_not_redo_its_one_time_effects(migrated_db):
    """`ac_simulation.tsx` fires `simulation:run` on every mount, not just the first - so a player
    who leaves and reopens the report (or just gets remounted) must not see it happen twice.
    `run_simulation` itself already guards the report; this checks the two things bolted on
    beside it in `handle_simulation_run` - the gate's own log line, and the emotion shift the
    report's deltas drive - are gated the same way, not repeated once per mount."""
    from mlops_serious_game.application.event_log_service.store import load_events
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.application.playtest_service import auto_card, service
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.infrastructure.websocket.handlers.pitch_handler import (
        PitchContext, get_allowed_targets, handle_pitch_commit,
    )
    from mlops_serious_game.infrastructure.websocket.handlers.simulation_handler import handle_simulation_run

    user_id = await _begun_game()
    challenge_id = _dealt_challenge(user_id)
    challenge = PhaseFactory.get_challenge_by_id(challenge_id)
    ids = {"phase_id": challenge.phase_id, "challenge_id": challenge.id}

    service.auto_gather("alice", challenge)
    ctx = PitchContext("alice", challenge.phase_id, challenge.id)

    result = auto_card.search_card(
        graph=ctx.graph, state=ctx.state, all_intel=list(ctx.all_intel),
        room=ctx.room, emotions=ctx.emotions,
        allowed=get_allowed_targets(ctx.graph, ctx.phase_id, ctx.challenge_id, list(ctx.all_intel)),
        seed="simulation-idempotent-test",
    )
    assert result is not None and result.found_non_veto

    with patch("mlops_serious_game.infrastructure.websocket.handlers.pitch_handler.manager") as m1, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.simulation_handler.manager") as m2, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.log_handler.manager") as m3:
        for m in (m1, m2, m3):
            m.send_event = AsyncMock()
            m.send_error = AsyncMock()
        await handle_pitch_commit(MagicMock(), "alice", {**ids, "atomic_changes": [c.model_dump() for c in result.changes]})

        await handle_simulation_run(MagicMock(), "alice", ids)
        emotions_after_first = pitch_store.emotion_values("alice", room_ids := list(ctx.room_ids))
        events_after_first = load_events("alice")
        gate_lines_after_first = [e for e in events_after_first if e.cause in ("outcome.gate_next", "outcome.gate_end")]
        assert len(gate_lines_after_first) == 1

        # Simulate the player leaving and reopening the report: same phase/challenge, another
        # `simulation:run` round-trip, nothing new committed in between.
        await handle_simulation_run(MagicMock(), "alice", ids)
        await handle_simulation_run(MagicMock(), "alice", ids)

    emotions_after_repeats = pitch_store.emotion_values("alice", room_ids)
    events_after_repeats = load_events("alice")
    gate_lines_after_repeats = [e for e in events_after_repeats if e.cause in ("outcome.gate_next", "outcome.gate_end")]

    assert emotions_after_repeats == emotions_after_first, "reopening the report reshifted emotions"
    assert len(gate_lines_after_repeats) == 1, "reopening the report logged the gate line again"
    assert len(events_after_repeats) == len(events_after_first), "reopening the report re-logged simulation events"
