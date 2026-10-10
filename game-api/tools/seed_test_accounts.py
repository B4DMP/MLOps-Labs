"""Seeds one test account per gameplay screen (docs/gameplay-flow.md), e.g. test-pitch@test.com.

Two families: `test-intro-*` accounts sit in a campaign that starts in the demo phase (Honey
Vault), the rest in a campaign that starts at the first real phase. From the offline intel screen
on, the dossier is partly filled (some notes found, most tagged right, a few wrong); on the main
family it also holds enough verified notes for a pinned tie and one more to find on the case board.

Run inside the api container (CLAUDE.md). Safe to re-run: each account keeps its user row but
loses all game data and is replayed back to its planned position.

    docker compose exec api python tools/seed_test_accounts.py [account ...]

Every account is created through the game's own handlers (the same ones the playtest tools use),
so the state is one the game could really produce. All of them are playtest-tainted, in their own
campaign, with password test1234.
"""

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import delete, func, select

from mlops_serious_game.application import debug_flags
from mlops_serious_game.application.case_board_service.context import board_context_for
from mlops_serious_game.application.case_board_service.service import sync_on_record
from mlops_serious_game.application.case_board_service.store import DbBoardStore
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.application.pitch_debate_service.session import PitchState
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.application.playtest_service import service
from mlops_serious_game.application.playtest_service.profiles import PERFECT, PlayProfile
from mlops_serious_game.application.services.auth_service import hash_password
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import ConfidenceType, IntelSource, StakeholderIntelItem
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import (
    BugReportRow,
    Campaign,
    CaseBoardRow,
    GameChallenge,
    GameEventRow,
    GameProgression,
    GameResult,
    GameSession,
    GraphOpLog,
    IntelItem,
    User,
    UserSettings,
)
from mlops_serious_game.infrastructure.database.run_scope import current_run_index
from mlops_serious_game.infrastructure.websocket.handlers import game_handler, pitch_handler, playtest_handler
from mlops_serious_game.infrastructure.websocket.manager import manager

PER_PLAYER_TABLES = (
    GameProgression, GameChallenge, GameSession, IntelItem, GraphOpLog,
    GameEventRow, GameResult, UserSettings, BugReportRow, CaseBoardRow,
)
PASSWORD = "test1234"
MAIN_STAGES = [
    "questionnaire", "briefing", "phase-briefing", "offline-intel", "pitch", "veto",
    "simulation", "outro-questionnaire", "results",
]
INTRO_STAGES = [
    "questionnaire", "briefing", "phase-briefing", "offline-intel", "pitch", "veto", "simulation",
]
ACCOUNTS = [f"intro-{s}" for s in INTRO_STAGES] + MAIN_STAGES
# Some notes found, most tagged right, a few wrong: a representative mid-game dossier.
PARTIAL = PlayProfile("seed-partial", intel_coverage=0.6, intel_accuracy=0.8)
# Impatience steps (cap 3) for the stakeholders of the first real challenge and the demo; anyone
# not listed stays calm.
PATIENCE = {"requirements_reuben": 3, "automation_alex": 2, "efficiency_emilia": 1, "bear_bruce": 2, "mohawk_mark": 1}
VETOING = PlayProfile("seed-veto", prefer="veto")


def email_for(account: str) -> str:
    return f"test-{account}@test.com"


def _progress(user_id: int, index: int) -> None:
    with get_session() as session:
        session.add(
            GameProgression(
                user_id=user_id,
                run_index=current_run_index(session, user_id),
                game_progress_index=index,
                additional_data=[],
            )
        )


def _create_user(account: str, intro: bool) -> int:
    key = "test-accounts-intro" if intro else "test-accounts"
    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == key))
        if campaign is None:
            campaign = Campaign(campaign_name=key, campaign_key=key, is_test_campaign=True, allow_replay=True)
            session.add(campaign)
            session.flush()
        campaign.intro_phase_enabled = intro
        user = session.scalar(select(User).where(User.email == email_for(account)))
        if user is None:
            user = User(email=email_for(account), users_on_machine=1)
            session.add(user)
        # Wipe in place rather than recreate, so a browser already logged in stays valid.
        user.campaign_key, user.campaign_id = key, campaign.id
        user.password_hash = hash_password(PASSWORD)
        user.is_verified = True
        user.playtest_tainted = False
        session.flush()
        for model in PER_PLAYER_TABLES:
            session.execute(delete(model).where(model.user_id == user.id))
        return user.id


def _max_progress(user_id: int) -> int:
    with get_session() as session:
        return session.scalar(
            select(func.max(GameProgression.game_progress_index)).where(
                GameProgression.user_id == user_id,
                GameProgression.run_index == current_run_index(session, user_id),
            )
        ) or 0


async def _to_phase_briefing(user_id: int) -> None:
    _progress(user_id, 1)
    _progress(user_id, 2)
    await game_handler.handle_game_init(MagicMock(), user_id, {})


async def _advance_loop(user_id: int, from_loop: int) -> None:
    """The client's own request: sends its current loop index, the server stores it plus one."""
    await game_handler.handle_state_update_request(
        MagicMock(), user_id, {"challenge_loop_index": from_loop, "metric_values": []}
    )


def _verify_notes(user_id: int, challenge, ids: list[str]) -> None:
    """Puts these notes in the dossier, verified and tagged right (replacing any wrong guess)."""
    with get_session() as session:
        run = current_run_index(session, user_id)
        held = {
            r.intel_item_data.get("id"): r
            for r in session.scalars(select(IntelItem).where(IntelItem.user_id == user_id, IntelItem.run_index == run))
        }
        for note_id in ids:
            req = RequirementFactory.get_requirement(note_id)
            if req is None:
                continue
            if note_id in held:
                session.delete(held[note_id])
            item = StakeholderIntelItem.from_requirement(
                req, intel_type=ConfidenceType.VERIFIED, categorized_type=req.type,
                description=req.description, source=IntelSource.INTERVIEW,
            )
            item.discovered_phase_id = challenge.phase_id
            item.discovered_challenge_template = challenge.template_id
            session.add(IntelItem(user_id=user_id, run_index=run, intel_item_data=item.model_dump(mode="json")))


def _thin_dossier(user_id: int, main: bool) -> None:
    """Replaces the dossier with the partial one. A card is searched with full knowledge first
    (a clean pass needs it), so what the player 'found' is decided afterwards.

    On the main family the case board needs verified notes on both sides of a tie: the
    challenge's own rift (pinned for free) and one more tie are made findable, the rest are left
    for the player to earn. The demo phase has no board."""
    challenge, _row = playtest_handler._current(user_id)
    with get_session() as session:
        session.execute(delete(IntelItem).where(IntelItem.user_id == user_id))
    service.auto_gather(user_id, challenge, PARTIAL)
    if not main:
        return
    ctx = board_context_for(user_id, challenge)
    on_record = [r for r in ctx.relations if r.on_record]
    findable = [r for r in ctx.relations if not r.on_record][:1]
    _verify_notes(user_id, challenge, [i for r in on_record + findable for i in r.a_item_ids + r.b_item_ids])
    ctx = board_context_for(user_id, challenge)
    sync_on_record(DbBoardStore(), ctx.key, ctx.relations, ctx.held_ids, ctx.attempts, ctx.names)


def _set_patience(user_id: int) -> None:
    """Wears down a few stakeholders' patience on the current pitch, one at each step up to the cap
    and the rest untouched, so the pitch and veto screens show every stage."""
    challenge, _row = playtest_handler._current(user_id)
    room = [ps.stakeholder_id for ps in PhaseFactory.get_phases()[challenge.phase_id].stakeholders]
    state = pitch_store.load_pitch(user_id, challenge.phase_id, challenge.id) or pitch.start_pitch(room)
    state.impatience = {sid: PATIENCE[sid] for sid in room if sid in PATIENCE}
    pitch_store.save_pitch(user_id, challenge.phase_id, challenge.id, state)


async def _commit_card(user_id: int, profile: PlayProfile) -> bool:
    """Commits a searched card for the current challenge; returns whether the room passed it."""
    challenge, _row = playtest_handler._current(user_id)
    ctx = playtest_handler._prepare(user_id, challenge, profile)
    result = playtest_handler._search(user_id, ctx, profile)
    if result is None:
        raise RuntimeError("no card could be built for the first challenge")
    await pitch_handler.handle_pitch_commit(
        MagicMock(),
        user_id,
        {
            "phase_id": challenge.phase_id,
            "challenge_id": challenge.id,
            "atomic_changes": playtest_handler._changes_payload(result),
        },
    )
    return result.found_non_veto


async def _finish_game(user_id: int) -> None:
    """Plays every challenge through the skip tool until the outro questionnaire."""
    for _ in range(40):
        if _max_progress(user_id) >= 3:
            return
        await playtest_handler.handle_playtest_skip_challenge(MagicMock(), user_id, {})
    raise RuntimeError("the game did not finish within 40 challenges")


async def seed(account: str) -> None:
    intro = account.startswith("intro-")
    stage = account.removeprefix("intro-")
    main = not intro
    user_id = _create_user(account, intro)
    service.taint_user(user_id)

    match stage:
        case "questionnaire":
            pass  # no progression rows: the server reads that as index 0
        case "briefing":
            _progress(user_id, 1)
        case "phase-briefing":
            await _to_phase_briefing(user_id)
        case "offline-intel":
            await _to_phase_briefing(user_id)
            _thin_dossier(user_id, main)
        case "pitch":
            await _to_phase_briefing(user_id)
            _thin_dossier(user_id, main)
            await _advance_loop(user_id, 0)
            _set_patience(user_id)
        case "veto":
            await _to_phase_briefing(user_id)
            await _advance_loop(user_id, 0)
            if await _commit_card(user_id, VETOING):
                raise RuntimeError("the first challenge has a clean card but no vetoing one")
            _thin_dossier(user_id, main)
            _set_patience(user_id)
        case "simulation":
            await _to_phase_briefing(user_id)
            await _advance_loop(user_id, 0)
            if not await _commit_card(user_id, PERFECT):
                raise RuntimeError("no card the room accepts for the first challenge")
            await _advance_loop(user_id, 2)
            _thin_dossier(user_id, main)
        case "outro-questionnaire":
            await _to_phase_briefing(user_id)
            await _finish_game(user_id)
        case "results":
            await _to_phase_briefing(user_id)
            await _finish_game(user_id)
            _progress(user_id, 4)
        case _:
            raise ValueError(f"unknown account {account!r}")

    print(f"  {email_for(account)}  (progress {_max_progress(user_id)})")


async def main(requested: list[str]) -> None:
    phases = requested or ACCOUNTS
    print(f"Seeding {len(phases)} accounts, password {PASSWORD}:")
    # The handlers talk to a websocket; here nobody is listening, and the playtest flag is forced.
    with patch.object(manager, "send_event", new=AsyncMock()), \
         patch.object(manager, "send_error", new=AsyncMock()), \
         patch.object(debug_flags, "is_enabled", return_value=True):
        for phase in phases:
            await seed(phase)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
