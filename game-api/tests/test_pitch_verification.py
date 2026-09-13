from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.domain.requirement import ConfidenceType
from mlops_serious_game.infrastructure.websocket.handlers import pitch_handler

INTEL = "mlops_serious_game.application.intel_handler"


def _ctx(held):
    return SimpleNamespace(
        username="pitch_verify_user",
        challenge=MagicMock(),
        room_ids=["dave", "tess"],
        read_exactly=set(),
        held_items=lambda: held,
    )


async def _run(held, drawn, item_ids, stakeholder_ids):
    ctx = _ctx(held)
    with patch(f"{INTEL}.correct_and_verify_intel_item") as verify_item, \
         patch(f"{INTEL}.correct_and_verify_convincer_archetype") as verify_arch, \
         patch(f"{INTEL}.retrieve_dossier_data", new_callable=AsyncMock, return_value=[]) as dossier, \
         patch.object(pitch_handler, "_drawn_archetypes", return_value=drawn), \
         patch.object(pitch_handler.manager, "send_event", new_callable=AsyncMock) as send:
        await pitch_handler._verify_heard(AsyncMock(), ctx, item_ids, stakeholder_ids)
    return verify_item, verify_arch, dossier, send


@pytest.mark.anyio
async def test_an_answer_verifies_the_held_note_and_the_speakers_archetype():
    held = [SimpleNamespace(id="n1", intel_type=ConfidenceType.UNCONFIRMED)]
    drawn = {"dave": {"categorized_archetype": "Autonomy", "real_archetype": "Technical Excellence"}}

    verify_item, verify_arch, _, send = await _run(held, drawn, ["n1"], ["dave"])

    verify_item.assert_called_once()
    assert verify_item.call_args.args[1] == "n1"
    verify_arch.assert_called_once_with("pitch_verify_user", "dave")
    assert send.await_args.kwargs["event"] == "intel:dossier_data"


@pytest.mark.anyio
async def test_nothing_is_verified_that_the_player_does_not_hold_or_has_verified_already():
    held = [SimpleNamespace(id="n1", intel_type=ConfidenceType.VERIFIED)]
    drawn = {
        "dave": {"categorized_archetype": "Autonomy", "verified": True},
        "tess": {"categorized_archetype": None},
    }

    verify_item, verify_arch, dossier, send = await _run(held, drawn, ["n1", "never_found"], ["dave", "tess", ""])

    verify_item.assert_not_called()
    verify_arch.assert_not_called()
    dossier.assert_not_awaited()
    send.assert_not_awaited()
