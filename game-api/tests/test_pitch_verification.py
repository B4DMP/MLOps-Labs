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


async def _run(held, item_ids):
    ctx = _ctx(held)
    with patch(f"{INTEL}.correct_and_verify_intel_item") as verify_item, \
         patch(f"{INTEL}.retrieve_dossier_data", new_callable=AsyncMock, return_value=[]) as dossier, \
         patch.object(pitch_handler.manager, "send_event", new_callable=AsyncMock) as send:
        await pitch_handler._verify_heard(AsyncMock(), ctx, item_ids)
    return verify_item, dossier, send


@pytest.mark.anyio
async def test_an_answer_verifies_the_held_note():
    held = [SimpleNamespace(id="n1", intel_type=ConfidenceType.UNCONFIRMED)]

    verify_item, _, send = await _run(held, ["n1"])

    verify_item.assert_called_once()
    assert verify_item.call_args.args[1] == "n1"
    assert send.await_args.kwargs["event"] == "intel:dossier_data"


@pytest.mark.anyio
async def test_nothing_is_verified_that_the_player_does_not_hold_or_has_verified_already():
    held = [SimpleNamespace(id="n1", intel_type=ConfidenceType.VERIFIED)]

    verify_item, dossier, send = await _run(held, ["n1", "never_found"])

    verify_item.assert_not_called()
    dossier.assert_not_awaited()
    send.assert_not_awaited()
