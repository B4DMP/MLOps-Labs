"""The intro (phase 0, a demo) through the real pitch handlers: no veto breaker, the scripted
passing card, the veto payload the coach panel needs, and re-pitch behaviour on the wire.

Needs a real Postgres (see test_veto_breaker.py, whose seeding and handler helpers this reuses).
"""

from unittest.mock import AsyncMock, patch

import pytest

from mlops_serious_game.application.pitch_debate_service import store as pitch_store
from mlops_serious_game.domain.phase_factory import PhaseFactory

from test_playtest_veto_breaker import _losing_search_result, _skip
from test_run_scope import _seed_user, _start_run, _uid, migrated_db  # noqa: F401  (fixture used by name)
from test_veto_breaker import _handle

pytestmark = pytest.mark.db

DEMO_CHALLENGE_ID = 113
IDS = {"phase_id": 0, "challenge_id": DEMO_CHALLENGE_ID}
BOUNDARY_ITEM = "gen_honey_vault_bruce_validation_automation"

# Bruce wants ingestion automated, but will not sign off on a feed nobody validates.
AUTOMATE_ONLY = [{"target": "data.ingestion", "kind": "raise_to", "axis": "automation", "value": 3}]
# Data Ingestion "Automate It" + Data Validation "Implement It Manually" (plan, section 2).
SCRIPTED_CARD = AUTOMATE_ONLY + [{"target": "data.validation", "kind": "raise_to", "axis": "automation", "value": 2}]
SCRIPTED_PLUS_SPOT_CHECKS = SCRIPTED_CARD + [
    {"target": "data.ingestion", "kind": "raise_to", "axis": "governance", "value": 3}
]


async def _seed_intro_player(username: str = "alice") -> int:
    from mlops_serious_game.application.graph_service import store as graph_store
    from mlops_serious_game.application.playtest_service.service import auto_gather
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge, GameSession

    user_id = _seed_user(username)
    _start_run(user_id, 1, None)
    challenge = PhaseFactory.get_challenge_by_id(DEMO_CHALLENGE_ID)
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
    return user_id


async def _commit(changes, username: str = "alice") -> dict:
    await _handle("handle_pitch_set_card", {**IDS, "atomic_changes": changes}, username)
    return await _handle("handle_pitch_commit", IDS, username)


async def _evaluate(changes, username: str = "alice"):
    """Runs pitch:evaluate with the LLM workflow stubbed; returns (final payload, all sent payloads)."""
    from mlops_serious_game.infrastructure.websocket.handlers import log_handler, pitch_handler

    workflow = AsyncMock(return_value=("Here is the plan.", [], {}))
    with patch.object(pitch_handler, "manager") as manager, \
         patch.object(log_handler, "manager") as log_manager, \
         patch.object(pitch_handler, "run_action_card_pitch_workflow", workflow):
        manager.send_event = AsyncMock()
        log_manager.send_event = AsyncMock()
        await pitch_handler.handle_pitch_evaluate(
            AsyncMock(), _uid(username), {**IDS, "atomic_changes": changes}
        )
    sent = [c.kwargs["payload"] for c in manager.send_event.await_args_list]
    return sent[-1], sent


def test_phase_zero_is_a_demo_phase(migrated_db):
    assert 0 in PhaseFactory.demo_phase_ids()


@pytest.mark.anyio
async def test_the_scripted_card_passes_in_the_intro(migrated_db):
    """The card the intro copy will teach. If this fails, no copy may rely on it."""
    await _seed_intro_player()
    result = await _commit(SCRIPTED_CARD)
    assert result["outcome"] == "PASS", result["reads"]


@pytest.mark.anyio
async def test_veto_payload_names_the_objection_and_its_item(migrated_db):
    await _seed_intro_player()
    result = await _commit(AUTOMATE_ONLY)

    assert result["outcome"] == "VETO"
    info = result["veto_info"]
    assert info["stakeholder_id"] == "bear_bruce"
    assert info["objection_kind"] == "boundary"
    assert info["objection_target"] == "data.validation"
    assert info["objection_item_id"] == BOUNDARY_ITEM
    assert result["is_demo"] is True


@pytest.mark.anyio
async def test_driver_veto_names_the_level_the_driver_asked_for(migrated_db):
    """Ingestion only fixed by hand, validation done: Bruce's driver is still unmet."""
    await _seed_intro_player()
    wrong = [
        {"target": "data.ingestion", "kind": "raise_to", "axis": "automation", "value": 2},
        {"target": "data.validation", "kind": "raise_to", "axis": "automation", "value": 2},
        {"target": "data.validation", "kind": "raise_to", "axis": "automation", "value": 3},
    ]
    result = await _commit(wrong)

    assert result["outcome"] == "VETO"
    info = result["veto_info"]
    assert info["objection_kind"] == "driver"
    assert info["objection_target"] == "data.ingestion"
    assert info["objection_axis"] == "automation"
    assert info["objection_level"] == 3


@pytest.mark.anyio
async def test_boundary_veto_carries_the_held_level(migrated_db):
    await _seed_intro_player()
    info = (await _commit(AUTOMATE_ONLY))["veto_info"]
    assert info["objection_level"] == 2
    assert info["objection_axis"] == "automation"


@pytest.mark.anyio
async def test_reads_carry_a_band_and_an_impatience_step(migrated_db):
    await _seed_intro_player()
    result = await _commit(SCRIPTED_CARD)
    for read in result["reads"]:
        assert read["buy_in_band"] in {"very_low", "low", "medium", "high", "very_high"}
        assert read["impatience"] == 0


@pytest.mark.anyio
async def test_veto_breaker_is_refused_in_the_intro(migrated_db):
    await _seed_intro_player()
    await _commit(AUTOMATE_ONLY)
    result = await _handle("handle_pitch_veto_breaker", IDS)

    assert "not available in the introduction" in result["error"]
    assert result["outcome"] == "VETO"
    assert pitch_store.escalation_points(_uid()) == 3


@pytest.mark.anyio
async def test_skip_challenge_in_the_intro_does_not_simulate_a_standing_veto(migrated_db):
    from mlops_serious_game.infrastructure.websocket.handlers import playtest_handler

    await _seed_intro_player()
    with patch.object(playtest_handler, "_search", return_value=_losing_search_result()):
        events, errors = await _skip()

    assert errors == []
    assert events["playtest:skip_result"]["ok"] is False
    assert "graph:delta_report" not in events
    assert "playtest:skipped" not in events
    state = pitch_store.load_pitch(_uid(), 0, DEMO_CHALLENGE_ID)
    assert state.outcome == "VETO"
    assert pitch_store.escalation_points(_uid()) == 3


@pytest.mark.anyio
async def test_identical_card_is_refused_without_cost(migrated_db):
    await _seed_intro_player()
    first, _ = await _evaluate(AUTOMATE_ONLY)
    assert "error" not in first
    emotions = pitch_store.emotion_values(_uid(), ["bear_bruce", "mohawk_mark"])

    second, sent = await _evaluate(AUTOMATE_ONLY)

    assert second["error"] == "Change the proposal before pitching it again"
    assert second["presentation_count"] == first["presentation_count"]
    assert all(r["impatience"] == 0 for r in second["reads"])
    assert pitch_store.emotion_values(_uid(), ["bear_bruce", "mohawk_mark"]) == emotions


@pytest.mark.anyio
async def test_stakeholders_with_nothing_new_get_a_system_line_and_no_emotion_update(migrated_db):
    await _seed_intro_player()
    await _evaluate(SCRIPTED_CARD)
    emotions = pitch_store.emotion_values(_uid(), ["bear_bruce", "mohawk_mark"])

    result, sent = await _evaluate(SCRIPTED_PLUS_SPOT_CHECKS)

    lines = [p for p in sent if p.get("type") == "system_message"]
    assert lines and all(p["stakeholder_id"] == "__environment__" for p in lines)
    assert all(p["message"].endswith("had nothing new to react to.") for p in lines)
    quiet = pitch_store.load_pitch(_uid(), 0, DEMO_CHALLENGE_ID).repeat_context
    assert len(lines) == sum(1 for ctx in quiet.values() if ctx == "quiet")
    reads = {r["stakeholder_id"]: r for r in result["reads"]}
    for st_id, ctx in quiet.items():
        assert reads[st_id]["quiet"] == (ctx == "quiet")
        if ctx == "quiet":
            assert pitch_store.emotion_values(_uid(), [st_id])[st_id] == emotions[st_id]


@pytest.mark.anyio
async def test_a_reload_after_a_veto_still_carries_veto_info(migrated_db):
    await _seed_intro_player()
    committed = await _commit(AUTOMATE_ONLY)

    reloaded = await _handle("handle_pitch_state", IDS)

    info = reloaded["veto_info"]
    assert info["objection_target"] == "data.validation"
    assert info["objection_item_id"] == BOUNDARY_ITEM
    assert info["stakeholder_id"] == "bear_bruce"
    assert info["message"] == committed["veto_info"]["message"]
    assert set(info) == set(committed["veto_info"])


@pytest.mark.anyio
async def test_only_the_first_revision_after_a_demo_veto_is_free(migrated_db):
    await _seed_intro_player()
    gov = {"target": "data.ingestion", "kind": "raise_to", "axis": "governance", "value": 3}
    weak_validation = {"target": "data.validation", "kind": "raise_to", "axis": "automation", "value": 1}

    await _evaluate(AUTOMATE_ONLY)
    await _handle("handle_pitch_commit", IDS)
    first_revision, _ = await _evaluate(AUTOMATE_ONLY + [gov])
    bruce = next(r for r in first_revision["reads"] if r["stakeholder_id"] == "bear_bruce")
    assert bruce["impatience"] == 0

    await _handle("handle_pitch_commit", IDS)
    second_revision, _ = await _evaluate(AUTOMATE_ONLY + [weak_validation])
    bruce = next(r for r in second_revision["reads"] if r["stakeholder_id"] == "bear_bruce")
    assert bruce["impatience"] == 1
