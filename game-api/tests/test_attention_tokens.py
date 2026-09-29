from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from mlops_serious_game.infrastructure.database import GameChallenge
from mlops_serious_game.infrastructure.websocket.handlers.gather_handler import handle_gather_open
from mlops_serious_game.infrastructure.websocket.handlers.game_handler import handle_game_init


@pytest.mark.anyio
async def test_gather_open_updates_attention_tokens_in_session():
    user_id = 1
    ws = AsyncMock()

    mock_row = GameChallenge(
        user_id=1,
        phase_index=0,
        challenge_index=0,
        challenge_loop_index=1,
        action_card={},
        metric_values=[],
        messages=[],
        attention_tokens=20,
    )
    mock_db = MagicMock()
    mock_db.scalars.return_value.first.return_value = mock_row

    with patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.get_session") as mock_get_session, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._held_items", new_callable=AsyncMock, return_value=[]), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.gather_store.save_conversation"), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.send_events", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler._send_conversation", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.manager.send_event", new_callable=AsyncMock), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.gather_handler.flag_modified"):

        mock_get_session.return_value.__enter__.return_value = mock_db

        payload = {
            "phase_id": 0,
            "challenge_id": 0,
            "card_id": "eng_1",
            "stakeholder_ids": ["model_monica"],
            "attention_tokens": 16,
        }
        await handle_gather_open(ws, user_id, payload)

        assert mock_row.attention_tokens == 16
        assert mock_db.commit.called


@pytest.mark.anyio
async def test_game_init_reloads_attention_tokens_from_latest_session():
    user_id = 1
    ws = AsyncMock()

    mock_latest_session = SimpleNamespace(
        phase_index=0,
        challenge_index=0,
        challenge_loop_index=1,
        emotion_values={},
        metric_values=[50, 50, 50, 50],
        messages=[],
        attention_tokens=14,
        action_card={},
    )
    mock_progression = SimpleNamespace(game_progress_index=2)

    mock_db = MagicMock()
    def mock_scalars(query):
        mock_result = MagicMock()
        query_str = str(query).lower()
        if "game_progression" in query_str:
            mock_result.all.return_value = [mock_progression]
        else:
            mock_result.first.return_value = mock_latest_session
        return mock_result

    mock_db.scalars.side_effect = mock_scalars
    mock_db.scalar.return_value = None

    sent_events = []
    async def mock_send_event(websocket, event, payload):
        sent_events.append((event, payload))

    with patch("mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_session") as mock_get_session, \
         patch("mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session"), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.game_handler.manager.send_event", side_effect=mock_send_event), \
         patch("mlops_serious_game.infrastructure.websocket.handlers.game_handler.graph_store.enter_challenge"):

        mock_get_session.return_value.__enter__.return_value = mock_db

        await handle_game_init(ws, user_id, {})

    state_update = next((p for e, p in sent_events if e == "game:state_update"), None)
    assert state_update is not None
    assert state_update["attention_tokens"] == 14
