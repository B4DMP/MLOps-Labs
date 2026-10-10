"""handle_gather_open: repeatable targeting (Investigate Component) and direct card effects
(Patience-Reset, Pep-Talk). Mocked DB, same style as test_attention_tokens.py."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.pitch_debate_service.gather import GatherConversation
from mlops_serious_game.application.pitch_debate_service.session import PitchState
from mlops_serious_game.infrastructure.database import GameChallenge
from mlops_serious_game.infrastructure.websocket.handlers.gather_handler import handle_gather_open

# Needs a real Postgres connection (not mocked) - excluded from CI via `-m "not db"`,
# runs locally/in docker-compose where Postgres is actually available.
pytestmark = pytest.mark.db


def _mock_row():
    return GameChallenge(
        user_id=1,
        phase_index=0,
        challenge_index=0,
        challenge_loop_index=1,
        action_card={},
        metric_values=[],
        messages=[],
        attention_tokens=20,
        emotion_values={},
    )


@pytest.mark.anyio
async def test_repeatable_target_carries_forward_asked_options():
    user_id = 1
    ws = AsyncMock()
    mock_db = MagicMock()
    mock_db.scalars.return_value.first.return_value = _mock_row()

    prior = GatherConversation(
        conversation_id="eng_eng_1_1",
        card_id="eng_1",
        stakeholder_id="bear_bruce",
        turns_left=0,
        turns_used=1,
        closed=True,
        asked_options=["priority_query", "data.validation"],
        discovered_item_ids=["r1", "r2"],
    )

    saved: list = []

    def fake_save(user_id, phase_id, challenge_id, conversation):
        saved.append(conversation)

    with patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.get_session") as mock_get_session, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._held_items", new_callable=AsyncMock, return_value=[]), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.gather_store.load_conversation", return_value=prior), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.gather_store.save_conversation", side_effect=fake_save), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.send_events", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._send_conversation", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.manager.send_event", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.flag_modified"):

        mock_get_session.return_value.__enter__.return_value = mock_db

        payload = {
            "phase_id": 0,
            "challenge_id": 0,
            "card_id": "eng_1",
            "stakeholder_ids": ["bear_bruce"],
            "attention_tokens": 17,
        }
        await handle_gather_open(ws, user_id, payload)

    assert len(saved) == 1
    reopened = saved[0]
    # Same conversation/chat tab, not a new one.
    assert reopened.conversation_id == "eng_eng_1_1"
    # What was already asked carries forward - never re-offered.
    assert reopened.asked_options == ["priority_query", "data.validation"]
    assert reopened.discovered_item_ids == ["r1", "r2"]
    assert reopened.closed is False
    # eng_1's configured turns (1) added on top of what was left (0).
    assert reopened.turns_left == 1


@pytest.mark.anyio
async def test_patience_reset_rejects_a_non_impatient_target():
    user_id = 1
    ws = AsyncMock()

    with patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.pitch_store.load_pitch", return_value=PitchState(impatience={})), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.get_session") as mock_get_session, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.manager.send_event", new_callable=AsyncMock) as mock_send:

        payload = {
            "phase_id": 0,
            "challenge_id": 0,
            "card_id": "eng_5",
            "stakeholder_ids": ["bear_bruce"],
        }
        await handle_gather_open(ws, user_id, payload)

        # Rejected before ever touching the DB (no token spend for an invalid play).
        mock_get_session.assert_not_called()
        assert mock_send.await_count == 1
        sent_event, sent_payload = mock_send.call_args.kwargs["event"], mock_send.call_args.kwargs["payload"]
        assert sent_event == "system:error"
        assert "impatient" in sent_payload["message"].lower()


@pytest.mark.anyio
async def test_patience_reset_zeroes_impatience_for_an_eligible_target():
    user_id = 1
    ws = AsyncMock()
    mock_db = MagicMock()
    mock_db.scalars.return_value.first.return_value = _mock_row()

    saved_states: list = []

    def fake_save_pitch(user_id, phase_id, challenge_id, state):
        saved_states.append(state)

    with patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.pitch_store.load_pitch", return_value=PitchState(impatience={"bear_bruce": 2})), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.pitch_store.save_pitch", side_effect=fake_save_pitch), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.get_session") as mock_get_session, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._held_items", new_callable=AsyncMock, return_value=[]), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.send_events", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._send_conversation", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.generate_stakeholder_response", new_callable=AsyncMock, return_value="Finally, some breathing room."), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.manager.send_event", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.flag_modified"):

        mock_get_session.return_value.__enter__.return_value = mock_db

        payload = {
            "phase_id": 0,
            "challenge_id": 0,
            "card_id": "eng_5",
            "stakeholder_ids": ["bear_bruce"],
            "attention_tokens": 18,
        }
        await handle_gather_open(ws, user_id, payload)

    assert len(saved_states) == 1
    assert saved_states[0].impatience["bear_bruce"] == 0


@pytest.mark.anyio
async def test_pep_talk_writes_only_confidence_and_control():
    user_id = 1
    ws = AsyncMock()
    mock_db = MagicMock()
    mock_db.scalars.return_value.first.return_value = _mock_row()

    written_emotion_values: dict = {}

    def fake_commit():
        pass

    with patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.get_session") as mock_get_session, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._held_items", new_callable=AsyncMock, return_value=[]), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.send_events", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._send_conversation", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.generate_stakeholder_response", new_callable=AsyncMock, return_value="Good to hear it, let's keep moving."), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.manager.send_event", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.flag_modified"):

        mock_row = _mock_row()
        mock_db.scalars.return_value.first.return_value = mock_row
        mock_get_session.return_value.__enter__.return_value = mock_db

        payload = {
            "phase_id": 0,
            "challenge_id": 0,
            "card_id": "eng_6",
            "attention_tokens": 15,
        }
        await handle_gather_open(ws, user_id, payload)

        written_emotion_values = mock_row.emotion_values

    assert written_emotion_values  # at least one stakeholder got a delta
    for st_id, values in written_emotion_values.items():
        assert values["confidence"] > 0.5
        assert values["sense_of_control"] > 0.5
        assert values["trust"] == 0.5
        assert values["fairness"] == 0.5
