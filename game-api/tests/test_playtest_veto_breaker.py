"""Tests for the playtest skip tool's Escalation Point fallback (docs/plans/results-screen.md, D9).

The original report this answers: "skip this challenge" consistently could not get past Model
Deployment. The cause was a real structural veto in `ch_shadow_deployment_contract` (118) -
automation_alex's stance items there carried no graph atoms or targets at all, so no card the
search could ever build cleared the veto. `handle_playtest_skip_challenge` uses the same Veto
Breaker a stuck human player has, rather than looping forever or giving up on a challenge that is
genuinely unwinnable by card alone.

That content gap is now authored (`test_veto_breaker.py`'s module docstring has the details), so
ch118 itself no longer exercises the fallback - `test_skip_no_longer_needs_the_fallback_on_ch118`
below confirms exactly that, the same way `test_a_challenge_with_a_real_winning_card_never_touches
_escalation_at_all` does for an always-fine challenge. The fallback's own wiring - that skip
reaches for the Veto Breaker only once the search proves a card cannot pass, spends exactly one
point, and still refuses once points run out - is tested against a deliberately weak search
result (`_losing_search_result`), standing in for whatever future content gap next needs it,
rather than being re-coupled to one specific challenge's content staying broken forever.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from mlops_serious_game.config import settings
from mlops_serious_game.domain.phase_factory import PhaseFactory

from test_run_scope import _uid, migrated_db  # noqa: F401  (fixture used by name)
from test_veto_breaker import STUCK_CHALLENGE_ID, STUCK_PHASE_ID, _seed_player_on_stuck_challenge


def _losing_search_result():
    """Stands in for a search that proved no card in the room passes - the trigger condition for
    the fallback - without depending on any one challenge's content staying structurally broken."""
    from mlops_serious_game.application.pitch_debate_service.session import AtomicChange
    from mlops_serious_game.application.playtest_service import auto_card

    return auto_card.CardSearchResult(
        changes=[AtomicChange(target="deploy.shadow", kind="raise_to", value=1)],
        outcome="VETO",
        evaluated=1,
        min_buy_in=0.0,
        pool=0,
    )


async def _skip(username: str = "alice"):
    """Runs `playtest:skip_challenge` with every module's shared `manager` singleton stubbed at
    once (patching the object's methods reaches every handler that imported it, in every module
    skip touches: pitch, simulation, state-update, log)."""
    from mlops_serious_game.infrastructure.websocket.handlers import playtest_handler
    from mlops_serious_game.infrastructure.websocket.manager import manager

    with patch.object(manager, "send_event", new=AsyncMock()) as send_event, \
         patch.object(manager, "send_error", new=AsyncMock()) as send_error, \
         patch.object(settings, "ENABLE_PLAYTEST_TOOLS", True):
        await playtest_handler.handle_playtest_skip_challenge(MagicMock(), _uid(username), {})
    events = {c.kwargs["event"]: c.kwargs["payload"] for c in send_event.await_args_list}
    errors = [c.kwargs.get("code") for c in send_error.await_args_list]
    return events, errors


def _patched_search():
    """Patches the search the real handler module uses, forcing the "no card passes" branch."""
    from mlops_serious_game.infrastructure.websocket.handlers import playtest_handler

    return patch.object(playtest_handler, "_search", return_value=_losing_search_result())


@pytest.mark.anyio
async def test_skip_breaks_the_veto_and_actually_advances_past_the_stuck_challenge(migrated_db):
    """The fallback this exists for: when the search proves no card passes, skip still gets past
    the challenge rather than refusing forever."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    user_id = await _seed_player_on_stuck_challenge()
    assert pitch_store.escalation_points(_uid()) == 3

    with _patched_search():
        events, errors = await _skip()

    assert errors == []
    assert events["playtest:skipped"]["ok"] is True
    assert pitch_store.escalation_points(_uid()) == 2, "the fallback spent exactly one point"

    with get_session() as session:
        rows = session.scalars(
            select(GameChallenge)
            .where(GameChallenge.user_id == user_id)
            .order_by(GameChallenge.id)
        ).all()
        challenges = {r.challenge_index for r in rows}
        stuck_row_auto_played = next(r.auto_played for r in rows if r.challenge_index == STUCK_CHALLENGE_ID)
    assert stuck_row_auto_played is True
    assert len(challenges) > 1, "the scheduler moved on to something new, not stuck repeating ch118"


@pytest.mark.anyio
async def test_skip_no_longer_needs_the_fallback_on_ch118(migrated_db):
    """The content fix this restoration was paired with (docs/plans/results-screen.md,
    test_veto_breaker.py): ch118's own search now finds a card that passes on its own, so skip
    never reaches for the Veto Breaker here at all."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store

    await _seed_player_on_stuck_challenge()

    events, errors = await _skip()

    assert errors == []
    assert events["playtest:skipped"]["ok"] is True
    assert pitch_store.escalation_points(_uid()) == 3, "never touched"


@pytest.mark.anyio
async def test_skip_reports_it_broke_a_veto_via_the_simulation_report(migrated_db):
    """The report the pipeline produces already says VETO_BROKEN (test_veto_breaker.py covers the
    pipeline side); this just confirms skip actually reaches that path end to end."""
    await _seed_player_on_stuck_challenge()
    with _patched_search():
        events, errors = await _skip()

    assert errors == []
    assert events["graph:delta_report"]["report"]["outcome"] == "VETO_BROKEN"


@pytest.mark.anyio
async def test_skip_refuses_only_once_escalation_points_are_actually_exhausted(migrated_db):
    """The true dead end: no card, and nothing left to force one through."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store

    await _seed_player_on_stuck_challenge()
    for _ in range(3):
        pitch_store.spend_escalation_point(_uid())
    assert pitch_store.escalation_points(_uid()) == 0

    with _patched_search():
        events, errors = await _skip()

    assert errors == []
    result = events["playtest:skip_result"]
    assert result["ok"] is False
    assert result["reason"] == "no_non_veto_card_and_no_escalation_points"
    assert result["outcome"] == "VETO"
    assert "playtest:skipped" not in events


@pytest.mark.anyio
async def test_a_refusal_from_exhausted_points_still_taints_and_commits_nothing_further(migrated_db):
    """Refusing to progress is not refusing to have tried: the account is still tainted (D10), and
    the commit that produced the veto is still on record, but nothing was pushed through."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import User

    await _seed_player_on_stuck_challenge()
    for _ in range(3):
        pitch_store.spend_escalation_point(_uid())

    with _patched_search():
        await _skip()

    with get_session() as session:
        assert session.scalar(
            select(User.playtest_tainted).where(User.email == "alice@example.test")
        ) is True

    state = pitch_store.load_pitch(_uid(), STUCK_PHASE_ID, STUCK_CHALLENGE_ID)
    assert state.outcome == "VETO"
    assert state.overridden_stakeholder_id is None


@pytest.mark.anyio
async def test_auto_card_never_spends_an_escalation_point_on_its_own(migrated_db):
    """`playtest:auto_card` only fills the builder for a human to review and commit; it must never
    make the escalation call on their behalf."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.infrastructure.websocket.handlers import playtest_handler
    from mlops_serious_game.infrastructure.websocket.manager import manager

    await _seed_player_on_stuck_challenge()
    before = pitch_store.escalation_points(_uid())

    with patch.object(manager, "send_event", new=AsyncMock()), \
         patch.object(manager, "send_error", new=AsyncMock()), \
         patch.object(settings, "ENABLE_PLAYTEST_TOOLS", True):
        await playtest_handler.handle_playtest_auto_card(MagicMock(), _uid(), {})

    assert pitch_store.escalation_points(_uid()) == before


@pytest.mark.anyio
async def test_a_challenge_with_a_real_winning_card_never_touches_escalation_at_all(migrated_db):
    """The common case: no fallback needed, no point spent."""
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge, GameSession
    from mlops_serious_game.application.graph_service import store as graph_store
    from mlops_serious_game.application.playtest_service.service import auto_gather
    from test_run_scope import _seed_user, _start_run

    username = "bob"
    winnable_challenge_id = 110  # ch_committed_pallets: confirmed winnable in test_playtest.py
    challenge = PhaseFactory.get_challenge_by_id(winnable_challenge_id)

    user_id = _seed_user(username)
    _start_run(user_id, 1, None)
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
    graph_store.enter_challenge(user_id, challenge)

    events, errors = await _skip(username)

    assert errors == []
    assert events["playtest:skipped"]["ok"] is True
    assert pitch_store.escalation_points(user_id) == 3, "never touched"
