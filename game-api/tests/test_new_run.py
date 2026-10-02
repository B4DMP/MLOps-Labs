"""Tests for starting another game from the results screen (docs/plans/results-screen.md, D4/D11).

Real throwaway Postgres, like test_run_scope.py, whose fixture and helpers are reused here.

The properties worth pinning:

- Refused unless the campaign allows replay AND the run is finished, so a crafted frame cannot
  restart someone mid-game or get past a research campaign's one-run rule.
- **Neither mode deletes anything.** A new run is an insert.
- Fresh start begins clean; next iteration carries the system, the gauges, the room and the grudges.
- `handle_game_init` reads the *current run's* position, not the maximum across runs. That one was a
  real bug: a finished first game read as the second game's position and sent a replaying player
  straight back to the results screen.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import func, select

# Shared with test_run_scope.py: the throwaway-database fixture and the row builders.
from test_run_scope import (  # noqa: F401  (migrated_db is a fixture, used by name)
    _add_challenge,
    _add_event,
    _seed_user,
    _uid,
    _start_run,
    migrated_db,
)

# Needs a real Postgres connection (not mocked) - excluded from CI via `-m "not db"`,
# runs locally/in docker-compose where Postgres is actually available.
pytestmark = pytest.mark.db



# A challenge that exists in the config (phase 1's first), so the scheduler can resolve it as played.
PLAYED_PHASE, PLAYED_CHALLENGE = 1, 110


def _allow_replay(campaign_key: str = "camp-1", allowed: bool = True) -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign

    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
        campaign.allow_replay = allowed


def _finish_run(user_id: int, run_index: int) -> None:
    """Writes the progression row a finished game ends on (index 4)."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression

    with get_session() as session:
        session.add(
            GameProgression(
                user_id=user_id, run_index=run_index,
                game_progress_index=4, additional_data=[],
            )
        )


def _add_session(user_id: int, run_index: int, escalation: int, grudges: list) -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameSession

    with get_session() as session:
        session.add(
            GameSession(
                user_id=user_id, run_index=run_index,
                stakeholder_personas={"data_dave": "persona_a"},
                escalation_points=escalation, grudges=grudges,
            )
        )


def _finished_player(*, allowed: bool = True) -> int:
    """A player whose first game is over: index 4, one challenge, a used-up session."""
    user_id = _seed_user()
    _allow_replay(allowed=allowed)
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, PLAYED_PHASE, PLAYED_CHALLENGE, [7, 0, 0, 0, 0, 0, 0, 0], {"model_monica": {"trust": 0.9}})
    _add_session(user_id, 1, escalation=0, grudges=[{"stakeholder_id": "model_monica", "weight": 1}])
    _finish_run(user_id, 1)
    return user_id


def _gate7(allowed_modes=("fresh", "spiral"), code="7d"):
    return {"gate7": {"code": code, "name": "test", "result": "win", "allowed_modes": list(allowed_modes)}}


async def _new_run(mode, username: str = "alice", gate7_allows_spiral: bool = True):
    """`gate7_allows_spiral` stubs Gate 7 (tested on its own in test_results_compute.py and
    test_gate7_gating below) so these tests exercise the spiral *mechanism* - what it inherits and
    what a fresh start does not - without also depending on the real Gate 7 thresholds happening
    to clear on whatever minimal graph state `_finished_player()` leaves behind."""
    from mlops_serious_game.infrastructure.websocket.handlers import game_handler

    with patch.object(game_handler, "manager") as manager, patch.object(
        game_handler, "get_gate7_results", return_value=_gate7(("fresh", "spiral") if gate7_allows_spiral else ("fresh",))
    ):
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        await game_handler.handle_new_run(MagicMock(), _uid(username), {"mode": mode})
    return manager


# ── Refusals ─────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_an_unknown_mode_is_refused(migrated_db):
    _finished_player()
    manager = await _new_run("teleport")
    assert manager.send_error.await_args.kwargs["code"] == "BAD_MODE"
    manager.send_event.assert_not_awaited()


@pytest.mark.anyio
async def test_a_campaign_that_does_not_allow_replay_refuses_both_modes(migrated_db):
    """Research campaigns keep one run per player, whatever a client frame says."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression

    user_id = _finished_player(allowed=False)
    for mode in ("fresh", "spiral"):
        manager = await _new_run(mode)
        assert manager.send_error.await_args.kwargs["code"] == "REPLAY_DISABLED"

    with get_session() as session:
        runs = session.scalars(
            select(GameProgression.run_index).where(GameProgression.user_id == user_id)
        ).all()
    assert set(runs) == {1}, "a refused request must not have written a run"


@pytest.mark.anyio
async def test_a_game_still_in_progress_cannot_be_restarted(migrated_db):
    user_id = _seed_user()
    _allow_replay()
    _start_run(user_id, 1, None)  # index 2, never reaches 4

    manager = await _new_run("fresh")
    assert manager.send_error.await_args.kwargs["code"] == "RUN_NOT_FINISHED"


# ── Gate 7 gating (GDD.txt "CAPTURE Gate 7") ────────────────────────────────


@pytest.mark.anyio
async def test_a_run_gate7_disallows_spiral_for_is_refused(migrated_db):
    """7a/7e: the finished system is not sound to build further on, so only a fresh start is
    offered - the real threshold math is pinned in test_results_compute.py, not here."""
    _finished_player()
    manager = await _new_run("spiral", gate7_allows_spiral=False)
    assert manager.send_error.await_args.kwargs["code"] == "GATE7_BLOCKED"
    manager.send_event.assert_not_awaited()


@pytest.mark.anyio
async def test_a_run_gate7_disallows_spiral_still_allows_fresh(migrated_db):
    """A forced-fresh outcome (7a/7e) is not a ban on playing again, only on continuing this one."""
    _finished_player()
    manager = await _new_run("fresh", gate7_allows_spiral=False)
    manager.send_error.assert_not_awaited()
    assert manager.send_event.await_args.kwargs["payload"]["mode"] == "fresh"


@pytest.mark.anyio
async def test_gate7_is_not_consulted_for_a_fresh_start(migrated_db):
    """Fresh abandons the old system rather than building on it, so it never needs to ask Gate 7
    whether that system was sound."""
    from mlops_serious_game.infrastructure.websocket.handlers import game_handler

    _finished_player()
    with patch.object(game_handler, "manager") as manager, patch.object(
        game_handler, "get_gate7_results"
    ) as gate7:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        await game_handler.handle_new_run(MagicMock(), _uid(), {"mode": "fresh"})
    gate7.assert_not_called()
    manager.send_error.assert_not_awaited()


# ── The two modes ────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_fresh_start_opens_a_clean_run_with_no_parent(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.run_scope import current_run_index, run_chain

    user_id = _finished_player()
    manager = await _new_run("fresh")

    manager.send_error.assert_not_awaited()
    event = manager.send_event.await_args.kwargs
    assert event["event"] == "game:new_run_started"
    assert event["payload"] == {"run_index": 2, "mode": "fresh"}
    with get_session() as session:
        assert current_run_index(session, user_id) == 2
        assert run_chain(session, user_id) == [2]


@pytest.mark.anyio
async def test_next_iteration_continues_the_run_it_followed(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.run_scope import parent_run, run_chain

    user_id = _finished_player()
    manager = await _new_run("spiral")

    assert manager.send_event.await_args.kwargs["payload"] == {"run_index": 2, "mode": "spiral"}
    with get_session() as session:
        assert run_chain(session, user_id) == [2, 1]
        assert parent_run(session, user_id) == 1


@pytest.mark.anyio
async def test_the_new_run_starts_in_play_not_back_at_the_questionnaire(migrated_db):
    """Run one's outro is run two's baseline, so the intro questionnaire is not asked again."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression

    user_id = _finished_player()
    await _new_run("fresh")

    with get_session() as session:
        index = session.scalar(
            select(GameProgression.game_progress_index).where(
                GameProgression.user_id == user_id, GameProgression.run_index == 2
            )
        )
    assert index == 2


@pytest.mark.anyio
async def test_each_run_gets_its_own_session_with_a_fresh_escalation_budget(migrated_db):
    """D15's three points are per game. The last run had spent them all."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameSession

    user_id = _finished_player()
    await _new_run("fresh")

    with get_session() as session:
        rows = {
            r.run_index: (r.escalation_points, dict(r.stakeholder_personas))
            for r in session.scalars(select(GameSession).where(GameSession.user_id == user_id)).all()
        }
    assert rows[1][0] == 0, "the old run's budget is left as it was"
    assert rows[2][0] == 3
    # The cast is not recast mid-campaign.
    assert rows[2][1] == {"data_dave": "persona_a"}


@pytest.mark.anyio
async def test_grudges_are_carried_by_a_next_iteration_and_dropped_by_a_fresh_start(migrated_db):
    """Neglected stakeholders remember. A new cycle on the same system does not wipe that; a clean
    slate does."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameSession

    user_id = _finished_player()
    await _new_run("spiral")
    with get_session() as session:
        spiral = session.scalar(
            select(GameSession.grudges).where(GameSession.user_id == user_id, GameSession.run_index == 2)
        )
    assert [g["stakeholder_id"] for g in spiral] == ["model_monica"]


@pytest.mark.anyio
async def test_a_fresh_start_carries_no_grudges(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameSession

    user_id = _finished_player()
    await _new_run("fresh")
    with get_session() as session:
        fresh = session.scalar(
            select(GameSession.grudges).where(GameSession.user_id == user_id, GameSession.run_index == 2)
        )
    assert fresh == []


@pytest.mark.anyio
async def test_neither_mode_deletes_anything(migrated_db):
    """The property the results screen and every admin aggregate depend on."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import (
        GameChallenge, GameEventRow, GameProgression, GameSession,
    )

    user_id = _finished_player()
    _add_event(user_id, run_index=1, seq=1)

    def counts():
        with get_session() as session:
            return {
                model.__name__: session.scalar(
                    select(func.count(model.id)).where(model.user_id == user_id, model.run_index == 1)
                )
                for model in (GameChallenge, GameEventRow, GameProgression, GameSession)
            }

    before = counts()
    await _new_run("spiral")
    _finish_run(user_id, 2)
    await _new_run("fresh")

    assert counts() == before


# ── What the new run inherits ────────────────────────────────────────────────


@pytest.mark.anyio
async def test_a_next_iteration_inherits_the_gauges_and_the_room(migrated_db):
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import inherited_state

    _finished_player()
    await _new_run("spiral")

    metrics, emotions = inherited_state(_uid())
    assert metrics[0] == 7
    assert emotions == {"model_monica": {"trust": 0.9}}


@pytest.mark.anyio
async def test_a_fresh_start_inherits_nothing(migrated_db):
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import inherited_state

    _finished_player()
    await _new_run("fresh")

    assert inherited_state(_uid()) == ([], {})


# ── The init regression ──────────────────────────────────────────────────────


async def _init(username: str = "alice"):
    from mlops_serious_game.infrastructure.websocket.handlers import game_handler

    with patch.object(game_handler, "manager") as manager:
        manager.send_event = AsyncMock()
        manager.send_error = AsyncMock()
        await game_handler.handle_game_init(MagicMock(), _uid(username), {})
    return [(c.kwargs["event"], c.kwargs["payload"]) for c in manager.send_event.await_args_list]


@pytest.mark.anyio
async def test_a_finished_game_still_lands_on_the_results_screen(migrated_db):
    """The control: with one finished run and no other, init sends the player to index 4."""
    _finished_player()
    sent = await _init()

    changes = [p for e, p in sent if e == "game:progress_change"]
    assert changes and changes[-1]["progressionIndex"] == 4


@pytest.mark.anyio
async def test_a_second_run_is_not_sent_back_to_the_results_screen(migrated_db):
    """The regression. Init used to take the maximum progress index across every run, so a finished
    first game (index 4) read as the second game's position."""
    _finished_player()
    await _new_run("fresh")
    sent = await _init()

    assert not [p for e, p in sent if e == "game:progress_change" and p.get("progressionIndex") == 4]
    states = [p for e, p in sent if e == "game:state_update"]
    assert states and states[-1]["progressionIndex"] == 2


@pytest.mark.anyio
async def test_a_second_run_is_dealt_a_challenge_it_has_not_played(migrated_db):
    """Cross-run played set: a new game must deal something new, or replaying is pointless."""
    from mlops_serious_game.domain.phase_factory import PhaseFactory

    _finished_player()
    await _new_run("fresh")
    sent = await _init()

    dealt = [p for e, p in sent if e == "game:state_update"][-1]["challenge_id"]
    played = PhaseFactory.get_challenge_by_id(PLAYED_CHALLENGE).template_id
    assert PhaseFactory.get_challenge_by_id(dealt).template_id != played


@pytest.mark.anyio
async def test_a_next_iteration_opens_with_the_gauges_it_inherited(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    user_id = _finished_player()
    await _new_run("spiral")
    await _init()

    with get_session() as session:
        row = session.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id, GameChallenge.run_index == 2)
            .order_by(GameChallenge.id)
        ).first()
        first = (row.metric_values[0], row.emotion_values)
    assert first == (7, {"model_monica": {"trust": 0.9}})


@pytest.mark.anyio
async def test_a_fresh_start_opens_with_neutral_gauges_and_a_neutral_room(migrated_db):
    """Not the last game's 7, and not its warm room."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    user_id = _finished_player()
    await _new_run("fresh")
    await _init()

    with get_session() as session:
        row = session.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id, GameChallenge.run_index == 2)
            .order_by(GameChallenge.id)
        ).first()
        first = (row.metric_values[0], row.emotion_values)
    assert first[0] != 7
    assert not first[1]
