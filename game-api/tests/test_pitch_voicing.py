"""Face the room voicing (plan 11, step 5): the LLM only ever puts a decided outcome into
words, and a failed call always falls back to a template line - mechanics never wait on it."""

from unittest.mock import AsyncMock, patch

import pytest

from mlops_serious_game.application.pitch_debate_service.voicing import (
    _fallback_player_line,
    _fallback_stakeholder_line,
    outcome_hint_from,
    voice_answer,
)


def test_outcome_hint_prefers_reframe_result_then_cause_texts_then_cleared_fallback():
    assert outcome_hint_from(["warmer: you put it their way"], True, "hit") == "hit; warmer: you put it their way"
    assert outcome_hint_from(["colder: that doesn't land"], False, "miss") == "miss; colder: that doesn't land"
    assert outcome_hint_from([], True, None) == "cleared"
    assert outcome_hint_from([], False, None) == "not cleared"


def test_fallback_player_line_per_option():
    assert "audit trail" in _fallback_player_line("amend", "the audit trail is kept", "")
    assert "lead with data" in _fallback_player_line("reframe", "", "lead with data")
    assert _fallback_player_line("stonewall", "", "") == "I hear you, but the card stands as it is."
    assert "firm answer" in _fallback_player_line("emergency_addendum", "", "")
    assert "wrong category" in _fallback_player_line("concede_correction", "", "")


def test_fallback_stakeholder_line_includes_the_outcome_hint():
    assert _fallback_stakeholder_line("Data Dave", "hit; warmer: x") == "Data Dave: hit; warmer: x"
    assert _fallback_stakeholder_line("Data Dave", "") == "Data Dave takes that in."


@pytest.mark.anyio
async def test_voice_answer_falls_back_when_the_llm_call_raises():
    with patch(
        "mlops_serious_game.application.pitch_debate_service.voicing.get_player_answer_chain",
        side_effect=RuntimeError("no api key"),
    ), patch(
        "mlops_serious_game.application.pitch_debate_service.voicing.get_stakeholder_reply_chain",
        side_effect=RuntimeError("no api key"),
    ):
        player_line, stakeholder_line = await voice_answer(
            challenge="ship it", option="stonewall", stakeholder_name="Data Dave",
            stakeholder_role="Data Lead", archetype_label="Analyst", archetype_strategy="lead with data",
            objection_text="This breaks my pipeline.", cleared=True, cause_texts=["colder: x"],
        )
    assert player_line == "I hear you, but the card stands as it is."
    assert stakeholder_line == "Data Dave: colder: x"


@pytest.mark.anyio
async def test_voice_answer_falls_back_when_the_llm_returns_empty():
    fake_chain = AsyncMock()
    fake_chain.ainvoke = AsyncMock(return_value="   ")
    with patch(
        "mlops_serious_game.application.pitch_debate_service.voicing.get_player_answer_chain",
        return_value=fake_chain,
    ), patch(
        "mlops_serious_game.application.pitch_debate_service.voicing.get_stakeholder_reply_chain",
        return_value=fake_chain,
    ):
        player_line, stakeholder_line = await voice_answer(
            challenge="ship it", option="concede_correction", stakeholder_name="Data Dave",
            stakeholder_role="Data Lead", archetype_label="Analyst", archetype_strategy="lead with data",
            objection_text="You filed this wrong.", cleared=True,
        )
    assert "wrong category" in player_line
    assert stakeholder_line == "Data Dave: cleared"


@pytest.mark.anyio
async def test_voice_answer_uses_the_llm_line_and_passes_the_right_inputs():
    player_chain = AsyncMock()
    player_chain.ainvoke = AsyncMock(return_value="Data Dave, I understand your audit trail requirement.")
    reply_chain = AsyncMock()
    reply_chain.ainvoke = AsyncMock(return_value="That works for me.")

    with patch(
        "mlops_serious_game.application.pitch_debate_service.voicing.get_player_answer_chain",
        return_value=player_chain,
    ), patch(
        "mlops_serious_game.application.pitch_debate_service.voicing.get_stakeholder_reply_chain",
        return_value=reply_chain,
    ):
        player_line, stakeholder_line = await voice_answer(
            challenge="ship it", option="amend", stakeholder_name="Data Dave",
            stakeholder_role="Data Lead", archetype_label="Analyst", archetype_strategy="lead with data",
            objection_text="This breaks my audit trail.", item_context="the audit trail is kept",
            cleared=True, cause_texts=[],
        )

    assert player_line == "Data Dave, I understand your audit trail requirement."
    assert stakeholder_line == "That works for me."
    player_call = player_chain.ainvoke.call_args.args[0]
    assert player_call["option_type"] == "amend"
    assert player_call["item_context"] == "the audit trail is kept"
    assert player_call["target_stakeholder_name"] == "Data Dave"
    reply_call = reply_chain.ainvoke.call_args.args[0]
    assert reply_call["player_line"] == "Data Dave, I understand your audit trail requirement."
    assert reply_call["outcome_hint"] == "cleared"
