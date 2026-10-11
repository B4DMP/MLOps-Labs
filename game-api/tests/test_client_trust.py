"""The server, not the client, owns stage order, tokens and the admin identity."""

from unittest.mock import patch

from mlops_serious_game.application.services import auth_service
from mlops_serious_game.infrastructure.websocket.handlers.game_handler import _SERVER_OWNED_CARD_KEYS, stage_refusal

PASSED = {"stage": "DONE", "outcome": "PASS"}


def test_offline_intel_continue_is_allowed_in_order():
    assert stage_refusal(0, 0, None) is None


def test_cannot_skip_from_offline_intel_to_the_next_challenge():
    assert stage_refusal(3, 0, None) is not None


def test_cannot_leave_the_pitch_before_it_is_finished():
    assert stage_refusal(2, 1, {"stage": "PITCHED", "outcome": None}) is not None
    assert stage_refusal(2, 1, {"stage": "DONE", "outcome": "VETO"}) is not None
    assert stage_refusal(2, 1, None) is not None


def test_finished_pitch_moves_on_to_the_simulation():
    assert stage_refusal(2, 1, PASSED) is None


def test_cannot_proceed_from_the_pitch_straight_to_the_next_challenge():
    assert stage_refusal(3, 1, PASSED) is not None


def test_simulation_proceeds_to_the_next_challenge():
    assert stage_refusal(3, 3, None) is None


def test_card_client_cannot_set_server_owned_keys():
    assert {"pitch", "metric_changes"} <= set(_SERVER_OWNED_CARD_KEYS)


def test_a_teacher_token_never_passes_as_admin():
    with patch.object(auth_service.settings, "ADMIN_USER", "boss"):
        teacher = auth_service.create_access_token({"sub": "boss", "role": "teacher", "teacher_id": 1})
        admin = auth_service.create_access_token({"sub": "boss"})
        assert not auth_service.verify_admin_token(teacher)
        assert auth_service.verify_admin_token(admin)
