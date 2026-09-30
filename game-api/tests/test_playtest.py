"""Tests for the playtest tools (docs/plans/results-screen.md, D9/D10).

Two halves. The card search is pure and runs against the real graph; the handlers run against a real
throwaway Postgres (reusing test_run_scope.py's fixture), because what matters about them is what
they leave in the database: a tainted account, a dossier, a card, an advanced challenge.

What is pinned:

- The flag is checked **server-side**, and a refusal changes nothing, taint included.
- Using a tool taints the account **before** it does anything, so one that fails half way has still
  marked it.
- The search never proposes a change the pitch handler would reject, is reproducible for a seed, and
  says so when there is no card the room will not veto instead of returning one that would be.
- A skipped challenge goes through the game's own handlers, not around them.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import func, select

from mlops_serious_game.application.graph_service.apply import replay, seed_ops
from mlops_serious_game.application.playtest_service import auto_card
from mlops_serious_game.config import settings
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import LoggedOp
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory

from test_run_scope import _seed_user, _start_run, _uid, migrated_db  # noqa: F401  (fixture used by name)


# ── The card search (pure) ───────────────────────────────────────────────────


def _world(challenge_id: int = 110):
    """The real graph at its seed state, and a real challenge's room and intel."""
    graph = GraphFactory.get_graph()
    state = replay(graph, [LoggedOp(seq=i, op=op) for i, op in enumerate(seed_ops(graph))]).state
    challenge = PhaseFactory.get_challenge_by_id(challenge_id)
    intel = RequirementFactory.get_requirements_for_challenge(challenge_id)
    room = [
        (ps.stakeholder_id, ps.power, ps.interest)
        for ps in PhaseFactory.get_phases()[challenge.phase_id].stakeholders
    ]
    emotions = {sid: EmotionFactory.create_default_emotion_values() for sid, _, _ in room}
    from mlops_serious_game.infrastructure.websocket.handlers.pitch_handler import get_allowed_targets

    allowed = get_allowed_targets(graph, challenge.phase_id, challenge_id, intel)
    return dict(graph=graph, state=state, all_intel=intel, room=room, emotions=emotions, allowed=allowed)


# A small budget: these tests are about what the search does with its results, not how hard it looks,
# and the full 400-card budget is about three seconds a call.
QUICK = 60


def _search(world, seed="s", budget=QUICK, **kwargs):
    return auto_card.search_card(seed=seed, budget=budget, **world, **kwargs)


def test_candidates_are_only_legal_known_targets_raised_to_a_higher_level():
    """Nothing proposed may be something `handle_pitch_set_card` would reject."""
    world = _world()
    candidates = auto_card.candidate_changes(
        world["graph"], world["state"], world["allowed"], world["all_intel"]
    )

    assert candidates
    allowed = set(world["allowed"])
    for change in candidates:
        assert change.target in allowed
        assert change.kind == "raise_to"
        assert change.value > world["state"].value(change.target, change.axis)
        assert change.value in world["graph"].allowed_for(change.target, change.axis)


def test_nothing_outside_the_allowed_targets_is_ever_proposed():
    world = _world()
    assert auto_card.candidate_changes(world["graph"], world["state"], [], world["all_intel"]) == []


def test_the_intel_driven_candidates_include_what_the_intel_actually_asks_for():
    """A card only satisfies a demand by raising its target *to the asked level*. One step at a time
    is not enough when the demand is two up, which is why the search must be seeded from the intel."""
    from mlops_serious_game.domain.requirement import item_target_and_level

    world = _world()
    candidates = {
        (c.target, c.axis, c.value)
        for c in auto_card.candidate_changes(
            world["graph"], world["state"], world["allowed"], world["all_intel"]
        )
    }
    asked = {
        (t, a, lvl)
        for item in world["all_intel"]
        for t, lvl, a in [item_target_and_level(item)]
        if t in set(world["allowed"])
        and lvl is not None
        and a is not None
        and lvl > world["state"].value(t, a)
    }
    assert asked, "the fixture challenge should ask for at least one raise"
    assert asked <= candidates


def test_nothing_to_slot_returns_none_rather_than_an_empty_card():
    world = _world()
    world["allowed"] = []
    assert _search(world) is None


def test_the_search_finds_a_card_the_room_will_not_veto_on_real_challenges():
    """The reason for the intel-driven candidates: from a neutral room, single steps alone found
    nothing on five of six challenges. The full budget, not QUICK: governance now needs its
    target implemented first, so satisfying it costs a 2-change combo rather than a single step,
    and QUICK's 60 evaluations can be spent entirely on singles before combos are ever tried."""
    for challenge_id in (110, 114, 116):
        result = _search(_world(challenge_id), budget=auto_card.DEFAULT_BUDGET)
        assert result is not None and result.found_non_veto, challenge_id
        assert 1 <= len(result.changes) <= 3


def test_the_search_is_reproducible_for_a_seed():
    world = _world()
    first = _search(world, seed="alice:1:110")
    second = _search(world, seed="alice:1:110")
    assert [c.model_dump() for c in first.changes] == [c.model_dump() for c in second.changes]


def test_different_seeds_explore_different_cards():
    """Repeated playtests must not always land on the first passing card. Full budget for the
    same reason as the real-challenges search above: challenge 110's only route past its
    high-power stakeholder is now a 2-change combo, which QUICK doesn't reach."""
    world = _world()
    cards = {
        tuple((c.target, c.value) for c in _search(world, seed=f"seed-{i}", budget=auto_card.DEFAULT_BUDGET).changes)
        for i in range(6)
    }
    assert len(cards) > 1


def test_a_card_is_never_longer_than_the_game_allows():
    from mlops_serious_game.application.pitch_debate_service import session as pitch

    world = _world()
    for i in range(8):
        assert len(_search(world, seed=str(i)).changes) <= pitch.MAX_ATOMIC_CHANGES


def test_a_room_with_no_clean_card_is_reported_as_a_veto_not_papered_over():
    """There may be no card the room accepts. The search must say so, not return one that fails."""
    from mlops_serious_game.application.pitch_debate_service import session as pitch

    world = _world()
    veto_view = pitch.CardView(outcome="VETO", reads=[pitch.StakeholderRead(stakeholder_id="x", power="high", buy_in=0.1)])
    with patch.object(pitch, "card_view", return_value=veto_view):
        result = _search(world)

    assert result.outcome == "VETO"
    assert not result.found_non_veto
    assert result.min_buy_in == pytest.approx(0.1)


def test_a_clean_pass_is_preferred_over_a_soft_pass():
    from mlops_serious_game.application.pitch_debate_service import session as pitch

    world = _world()
    calls = {"n": 0}

    def alternating(**kwargs):
        calls["n"] += 1
        outcome = "PASS" if calls["n"] % 5 == 0 else "SOFT_PASS"
        return pitch.CardView(outcome=outcome, reads=[pitch.StakeholderRead(stakeholder_id="x", power="high", buy_in=0.5)])

    with patch.object(pitch, "card_view", side_effect=alternating):
        assert _search(world).outcome == "PASS"


def test_the_search_stops_early_once_it_has_enough_passes():
    from mlops_serious_game.application.pitch_debate_service import session as pitch

    world = _world()
    passing = pitch.CardView(outcome="PASS", reads=[pitch.StakeholderRead(stakeholder_id="x", power="high", buy_in=0.9)])
    with patch.object(pitch, "card_view", return_value=passing):
        result = _search(world, wanted_passes=5)
    assert result.evaluated == 5


# ── The handlers ─────────────────────────────────────────────────────────────

PHASE, CHALLENGE = 1, 110


def _tainted(username: str = "alice") -> bool:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import User

    with get_session() as session:
        return bool(session.scalar(select(User.playtest_tainted).where(User.email == f"{username}@example.test")))


async def _begun_game(username: str = "alice"):
    """A player mid-game: registered, in play, and dealt their first challenge by the real init."""
    from mlops_serious_game.infrastructure.websocket.handlers import game_handler
    from mlops_serious_game.infrastructure.websocket.manager import manager

    user_id = _seed_user(username)
    _start_run(user_id, 1, None)
    with patch.object(manager, "send_event", new=AsyncMock()), patch.object(manager, "send_error", new=AsyncMock()):
        await game_handler.handle_game_init(MagicMock(), user_id, {})
    return user_id


async def _call(handler_name: str, username: str = "alice", flag: bool = True):
    """Runs a playtest handler with the shared connection manager stubbed, returning what it sent."""
    from mlops_serious_game.infrastructure.websocket.handlers import playtest_handler
    from mlops_serious_game.infrastructure.websocket.manager import manager

    with patch.object(manager, "send_event", new=AsyncMock()) as send_event, \
         patch.object(manager, "send_error", new=AsyncMock()) as send_error, \
         patch.object(settings, "ENABLE_PLAYTEST_TOOLS", flag):
        await getattr(playtest_handler, handler_name)(MagicMock(), _uid(username), {})
    events = {c.kwargs["event"]: c.kwargs["payload"] for c in send_event.await_args_list}
    errors = [c.kwargs.get("code") for c in send_error.await_args_list]
    return events, errors


@pytest.mark.anyio
@pytest.mark.parametrize(
    "handler",
    ["handle_playtest_auto_card", "handle_playtest_skip_challenge", "handle_playtest_jump_to_questionnaire"],
)
async def test_the_flag_is_checked_server_side_and_a_refusal_changes_nothing(migrated_db, handler):
    """A crafted frame must not be able to fabricate a run, and a refused one must not taint."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import IntelItem

    user_id = await _begun_game()
    events, errors = await _call(handler, flag=False)

    assert errors == ["PLAYTEST_DISABLED"]
    assert events == {}
    assert not _tainted()
    with get_session() as session:
        assert session.scalar(select(func.count(IntelItem.id)).where(IntelItem.user_id == user_id)) == 0


@pytest.mark.anyio
async def test_the_settings_payload_only_offers_the_tools_when_the_flag_is_on(migrated_db):
    from mlops_serious_game.infrastructure.websocket.handlers import settings_handler
    from mlops_serious_game.infrastructure.websocket.manager import manager

    _seed_user()
    for flag in (True, False):
        with patch.object(manager, "send_event", new=AsyncMock()) as send_event, \
             patch.object(settings, "ENABLE_PLAYTEST_TOOLS", flag):
            await settings_handler.handle_settings_get(MagicMock(), _uid(), {})
        assert send_event.await_args.kwargs["payload"]["can_playtest"] is flag


async def _call_jump(target: str, username: str = "alice", flag: bool = True):
    from mlops_serious_game.infrastructure.websocket.handlers import playtest_handler
    from mlops_serious_game.infrastructure.websocket.manager import manager

    with patch.object(manager, "send_event", new=AsyncMock()) as send_event, \
         patch.object(manager, "send_error", new=AsyncMock()) as send_error, \
         patch.object(settings, "ENABLE_PLAYTEST_TOOLS", flag):
        await playtest_handler.handle_playtest_jump_to_questionnaire(MagicMock(), username, {"target": target})
    events = {c.kwargs["event"]: c.kwargs["payload"] for c in send_event.await_args_list}
    errors = [c.kwargs.get("code") for c in send_error.await_args_list]
    return events, errors


@pytest.mark.anyio
@pytest.mark.parametrize("target,expected_index", [("intro", 0), ("outro", 3)])
async def test_jump_to_questionnaire_taints_and_writes_the_progression_row(migrated_db, target, expected_index):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameProgression
    from mlops_serious_game.infrastructure.database.user_lookup import get_user_id

    user_id = await _begun_game()
    events, errors = await _call_jump(target)

    assert errors == []
    assert _tainted()
    assert events["playtest:jumped"] == {"ok": True, "target": target}
    assert events["game:progress_change"]["progressionIndex"] == expected_index

    with get_session() as session:
        latest = session.scalars(
            select(GameProgression)
            .where(GameProgression.user_id == get_user_id(session, "alice"))
            .order_by(GameProgression.id.desc())
        ).first()
        assert latest.game_progress_index == expected_index


@pytest.mark.anyio
async def test_jump_to_questionnaire_refuses_an_unknown_target_but_still_taints(migrated_db):
    """Matches the other playtest tools: tainted before anything is attempted, permanently, even
    when what follows turns out to be a no-op - see the module docstring's "before doing anything"
    rule and `handle_playtest_skip_challenge`'s identical ordering against its own NO_CHALLENGE
    refusal."""
    await _begun_game()
    events, errors = await _call_jump("nonsense")

    assert errors == ["INVALID_TARGET"]
    assert events == {}
    assert _tainted()


@pytest.mark.anyio
async def test_auto_card_taints_the_account_fills_the_dossier_and_slots_a_card(migrated_db):
    from mlops_serious_game.application.pitch_debate_service import store as pitch_store
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import IntelItem
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import current_run_index  # noqa: F401

    user_id = await _begun_game()
    dealt = _dealt_challenge(user_id)
    events, errors = await _call("handle_playtest_auto_card")

    assert errors == []
    assert _tainted()
    result = events["playtest:auto_card_result"]
    assert result["ok"] is True and result["outcome"] in ("PASS", "SOFT_PASS")
    assert 1 <= len(result["changes"]) <= 3

    # The dossier holds every requirement of the challenge, so the card had something to build on.
    with get_session() as session:
        stored = session.scalar(select(func.count(IntelItem.id)).where(IntelItem.user_id == user_id))
    assert stored == len(RequirementFactory.get_requirements_for_challenge(dealt))

    # And the card went through the normal set_card path, so it is in the pitch state.
    state = pitch_store.load_pitch(_uid(), PhaseFactory.get_challenge_by_id(dealt).phase_id, dealt)
    assert [c.target for c in state.atomic_changes] == [c["target"] for c in result["changes"]]


@pytest.mark.anyio
async def test_auto_gather_tags_every_note_correctly_and_is_idempotent(migrated_db):
    from mlops_serious_game.application.playtest_service import service
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import IntelItem

    user_id = await _begun_game()
    challenge = PhaseFactory.get_challenge_by_id(_dealt_challenge(user_id))

    added = service.auto_gather(_uid(), challenge)
    assert added == len(RequirementFactory.get_requirements_for_challenge(challenge.id))
    assert service.auto_gather(_uid(), challenge) == 0, "a second call must not duplicate or re-change"

    with get_session() as session:
        rows = session.scalars(select(IntelItem).where(IntelItem.user_id == user_id)).all()
        data = [r.intel_item_data for r in rows]
    assert all(d["intel_type"] == "verified" and d["categorized_type"] == d["type"] for d in data)


@pytest.mark.anyio
async def test_auto_gather_upgrades_a_wrongly_tagged_note_rather_than_duplicating_it(migrated_db):
    from mlops_serious_game.application.playtest_service import service
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import IntelItem

    user_id = await _begun_game()
    challenge = PhaseFactory.get_challenge_by_id(_dealt_challenge(user_id))
    service.auto_gather(_uid(), challenge)

    with get_session() as session:
        row = session.scalars(select(IntelItem).where(IntelItem.user_id == user_id)).first()
        data = dict(row.intel_item_data)
        data["categorized_type"] = "fact" if data["type"] != "fact" else "driver"
        data["intel_type"] = "unconfirmed"
        row.intel_item_data = data
        total = session.scalar(select(func.count(IntelItem.id)).where(IntelItem.user_id == user_id))

    assert service.auto_gather(_uid(), challenge) == 1
    with get_session() as session:
        assert session.scalar(select(func.count(IntelItem.id)).where(IntelItem.user_id == user_id)) == total


@pytest.mark.anyio
async def test_skip_challenge_goes_through_the_games_own_handlers_and_advances(migrated_db):
    """Not a shortcut around the game: the pitch commit, the simulation and the state update all
    run, and the challenge is marked as auto-played."""
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    user_id = await _begun_game()
    first = _dealt_challenge(user_id)
    events, errors = await _call("handle_playtest_skip_challenge")

    assert errors == []
    assert _tainted()
    assert events["playtest:skipped"]["ok"] is True
    assert "graph:delta_report" in events, "the simulation ran"

    with get_session() as session:
        rows = session.scalars(
            select(GameChallenge).where(GameChallenge.user_id == user_id).order_by(GameChallenge.id)
        ).all()
        challenges = [r.challenge_index for r in rows]
        breadcrumb = next(r.auto_played for r in rows if r.challenge_index == first)
        finished_loop = next(r.challenge_loop_index for r in rows if r.challenge_index == first)
    assert breadcrumb is True
    assert finished_loop == 3
    # The scheduler dealt something new next, not the same challenge again.
    assert len(set(challenges)) > 1


@pytest.mark.anyio
async def test_a_player_with_no_challenge_in_progress_is_told_so_not_crashed(migrated_db):
    _seed_user()
    events, errors = await _call("handle_playtest_auto_card")

    assert errors == ["NO_CHALLENGE"]
    assert _tainted(), "tainted before anything else, even when there was nothing to do"


@pytest.mark.anyio
async def test_the_taint_survives_a_second_use_and_is_reported_only_the_first_time(migrated_db):
    from mlops_serious_game.application.playtest_service import service

    _seed_user()
    assert service.taint_user(_uid()) is True
    assert service.taint_user(_uid()) is False
    assert _tainted()


@pytest.mark.anyio
async def test_a_tainted_account_drops_out_of_the_admin_aggregates(migrated_db):
    """The end of the chain: using a tool is what removes someone from the research data."""
    from mlops_serious_game.application.services.admin_service import get_valid_players_set

    await _begun_game()
    assert get_valid_players_set() == {"alice@example.test"}
    await _call("handle_playtest_auto_card")
    assert get_valid_players_set() == set()
    assert get_valid_players_set(include_playtest=True) == {"alice@example.test"}


def _dealt_challenge(user_id: int) -> int:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge

    with get_session() as session:
        return session.scalars(
            select(GameChallenge.challenge_index).where(GameChallenge.user_id == user_id).order_by(GameChallenge.id)
        ).first()
