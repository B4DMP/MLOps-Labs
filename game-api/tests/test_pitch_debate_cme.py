import asyncio
import uuid
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from mlops_serious_game.application.pitch_debate_service import (
    EmotionDelta,
    EmotionValues,
    PitchDebateState,
    StakeholderIntelItem,
    StakeholderIntelItemIntent,
    StakeholderIntelItemLayer,
    create_pitch_debate_graph,
    get_response,
    reset_thread,
)
from mlops_serious_game.application.dialogue_options_service import DialogueOption
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


@pytest.mark.anyio
async def test_pitch_debate_graph_structure():
    graph_builder = create_pitch_debate_graph()
    assert "router" in graph_builder.nodes
    assert "emotion_node" in graph_builder.nodes
    assert "conversation_node" in graph_builder.nodes
    assert "dialogue_option_node" in graph_builder.nodes
    compiled = graph_builder.compile()
    assert compiled is not None


@pytest.mark.anyio
async def test_pitch_debate_initial_turn_and_option_selection():
    thread_id = f"test_cme_{uuid.uuid4()}"
    phase_id = 0
    challenge_id = 0
    curr_challenge = PhaseFactory.translate_challenge_index(phase_index=phase_id, challenge_index=challenge_id)
    challenge_desc = f"{curr_challenge.name}: {curr_challenge.roundIntroduction} {curr_challenge.description}"

    callback_messages = []

    async def test_callback(websocket=None, state=None, **kwargs):
        last_msg = state["messages"][-1]
        callback_messages.append(last_msg)

    # Initial start
    emotion_deltas, output_state = await get_response(
        challenge=challenge_desc,
        _thread_id=thread_id,
        phase_id=phase_id,
        challenge_id=challenge_id,
        initial_start=True,
        callback=test_callback,
    )

    # Verify initial start produced messages and dialogue options
    assert len(output_state["dialogue_options"]) == 4
    assert len(callback_messages) >= 1
    assert "emotion_values" in output_state
    assert isinstance(emotion_deltas, dict)

    # Verify selecting dialogue option 0
    selected_opt = output_state["dialogue_options"][0]
    callback_messages.clear()

    emotion_deltas_2, output_state_2 = await get_response(
        challenge=challenge_desc,
        _thread_id=thread_id,
        phase_id=phase_id,
        challenge_id=challenge_id,
        option_index=0,
        callback=test_callback,
    )

    assert len(output_state_2["dialogue_options"]) == 4
    assert len(callback_messages) >= 1
    assert isinstance(emotion_deltas_2, dict)
    assert output_state_2["last_selected_option"].text == selected_opt.text

    # Verify missing option_index when initial_start=False raises error
    with pytest.raises(ValueError):
        await get_response(
            challenge=challenge_desc,
            _thread_id=thread_id,
            phase_id=phase_id,
            challenge_id=challenge_id,
            option_index=None,
            initial_start=False,
        )

    # Clean up thread
    await reset_thread(thread_id)


if __name__ == "__main__":
    asyncio.run(test_pitch_debate_graph_structure())
    asyncio.run(test_pitch_debate_initial_turn_and_option_selection())
    print("All tests passed successfully!")
