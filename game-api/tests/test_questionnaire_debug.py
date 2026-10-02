"""The questionnaire's answer-key debug field (`game_handler._with_answer_key_debug`), following
the exact same only-in-debug-builds pattern already used for the offline intel deck
(`test_offline_intel_deck.py::test_the_deck_carries_the_answer_key_only_in_debug`)."""

from unittest.mock import patch

import pytest

from mlops_serious_game.config import settings
from mlops_serious_game.domain.question import Question
from mlops_serious_game.domain.question_factory import QuestionFactory
from mlops_serious_game.infrastructure.websocket.handlers import game_handler


def _questions() -> list[Question]:
    return [
        Question(
            question="A demographic question with no right answer",
            answers=[{"id": 0, "text": "A"}, {"id": 1, "text": "B"}],
            knowledge_question=False,
            notes=False,
        ),
        Question(
            question="A knowledge question",
            answers=[{"id": 0, "text": "Correct"}, {"id": 1, "text": "Wrong"}],
            knowledge_question=True,
            notes=False,
        ),
    ]


@pytest.mark.parametrize("debug_enabled", [False, True])
def test_the_answer_key_is_attached_only_in_debug_and_only_to_knowledge_questions(debug_enabled):
    with patch.object(settings, "ENABLE_DOSSIER_DEBUG", debug_enabled), \
         patch.object(QuestionFactory, "intro_questions", _questions()):
        dumped = game_handler.get_intro_questions()

    demographic, knowledge = dumped
    assert "debug" not in demographic

    if debug_enabled:
        assert knowledge["debug"] == {"correct_id": 0, "correct_text": "Correct"}
    else:
        assert "debug" not in knowledge


def test_the_answer_key_never_leaks_the_wrong_answer():
    with patch.object(settings, "ENABLE_DOSSIER_DEBUG", True), \
         patch.object(QuestionFactory, "outro_questions", _questions()):
        dumped = game_handler.get_outro_questions()

    knowledge = dumped[1]
    assert knowledge["debug"]["correct_text"] != "Wrong"
