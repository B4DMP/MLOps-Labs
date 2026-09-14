import asyncio
import uuid
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from mlops_serious_game.application.pitch_debate_service import (
    EmotionDelta,
    EmotionValues,
    PitchDebateState,
    DialogueOption,
    StakeholderIntelItem,
    create_pitch_debate_graph,
    get_response,
    reset_thread,
)
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import PLAUSIBLE_WRONG_TAG, ConfidenceType
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


@pytest.mark.anyio
async def test_pitch_debate_graph_structure():
    graph_builder = create_pitch_debate_graph()
    assert "player_prompt_node" in graph_builder.nodes
    assert "router" in graph_builder.nodes
    assert "emotion_node" in graph_builder.nodes
    assert "conversation_node" in graph_builder.nodes
    assert "dialogue_option_node" not in graph_builder.nodes
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

    # Verify selecting dialogue option by ID
    selected_opt = output_state["dialogue_options"][0]
    callback_messages.clear()

    active_st_list = StakeholderFactory.get_active_stakeholders(phase_id) or StakeholderFactory.get_available_stakeholders()
    target_st_id = (
        selected_opt.intel_stakeholder_id
        if selected_opt.type == "intel"
        else (active_st_list[0] if active_st_list else "willis_slif_business_manager")
    )

    emotion_deltas_2, output_state_2 = await get_response(
        challenge=challenge_desc,
        _thread_id=thread_id,
        phase_id=phase_id,
        challenge_id=challenge_id,
        option_id=selected_opt.id,
        addressed_stakeholder_id=target_st_id,
        callback=test_callback,
    )

    assert len(output_state_2["dialogue_options"]) == 4
    assert len(callback_messages) >= 1
    assert isinstance(emotion_deltas_2, dict)
    assert output_state_2["last_selected_option"] is not None
    assert output_state_2["last_selected_option"].text is not None
    assert len(output_state_2["last_selected_option"].text) > 5

    # Verify missing option_id when initial_start=False raises error
    with pytest.raises(ValueError):
        await get_response(
            challenge=challenge_desc,
            _thread_id=thread_id,
            phase_id=phase_id,
            challenge_id=challenge_id,
            option_id=None,
            initial_start=False,
        )

    # Clean up thread
    await reset_thread(thread_id)


@pytest.mark.anyio
async def test_pitch_debate_dialogue_option_fallback_recovery():
    """Verify that an option_id not originally in the checkpoint (e.g. opt_noise_2_63178e)
    is gracefully resolved via dialogue_option or prefix fallback rather than crashing."""
    thread_id = f"test_cme_fallback_{uuid.uuid4()}"
    phase_id = 0
    challenge_id = 0
    curr_challenge = PhaseFactory.translate_challenge_index(phase_index=phase_id, challenge_index=challenge_id)
    challenge_desc = f"{curr_challenge.name}: {curr_challenge.roundIntroduction} {curr_challenge.description}"

    # Initial start to populate checkpoint
    _, output_state = await get_response(
        challenge=challenge_desc,
        _thread_id=thread_id,
        phase_id=phase_id,
        challenge_id=challenge_id,
        initial_start=True,
    )

    # Simulate player selecting an option with an ID not in the checkpoint (e.g. opt_noise_2_63178e)
    uncheckpointed_noise_id = "opt_noise_2_63178e"
    emotion_deltas, output_state_recovered = await get_response(
        challenge=challenge_desc,
        _thread_id=thread_id,
        phase_id=phase_id,
        challenge_id=challenge_id,
        option_id=uncheckpointed_noise_id,
        dialogue_option={
            "id": uncheckpointed_noise_id,
            "type": "corporate_noise",
            "archetype": {"name": "The Skeptic", "strategy": "Present hard metrics", "bias": "neutral"},
        },
        addressed_stakeholder_id="requirements_reuben",
    )

    assert output_state_recovered["last_selected_option"] is not None
    assert output_state_recovered["last_selected_option"].id == uncheckpointed_noise_id
    assert output_state_recovered["last_selected_option"].text is not None

    # Clean up thread
    await reset_thread(thread_id)


@pytest.mark.anyio
async def test_pitch_debate_action_card_kickoff_and_refutation():
    thread_id = f"test_cme_ac_{uuid.uuid4()}"
    phase_id = 0
    challenge_id = 0
    curr_challenge = PhaseFactory.translate_challenge_index(phase_index=phase_id, challenge_index=challenge_id)
    challenge_desc = f"{curr_challenge.name}: {curr_challenge.roundIntroduction} {curr_challenge.description}"

    reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
    assert len(reqs) > 0
    target_req = reqs[0]

    # Deliberately miscategorize the first requirement
    wrong_type = PLAUSIBLE_WRONG_TAG[target_req.type]
    wrong_intel = StakeholderIntelItem.from_requirement(
        target_req,
        intel_type=ConfidenceType.UNCONFIRMED,
        categorized_type=wrong_type,
        categorized_description=f"False assumption regarding {target_req.stakeholder_id}'s stance",
    )

    action_card = {
        "id": "ac_test_drift_mitigation",
        "title": "Automated Drift Retraining Pipeline",
        "description": "Implement automated daily drift alerts and rapid model redeployments.",
        "intel_ids": [wrong_intel.id],
        "wrong_intel_ids": [wrong_intel.id],
    }

    callback_messages = []

    async def test_callback(websocket=None, state=None, **kwargs):
        last_msg = state["messages"][-1]
        callback_messages.append(last_msg)

    # Initial kickoff start
    emotion_deltas, output_state = await get_response(
        challenge=challenge_desc,
        _thread_id=thread_id,
        phase_id=phase_id,
        challenge_id=challenge_id,
        initial_start=True,
        intel_items=[wrong_intel],
        action_card=action_card,
        callback=test_callback,
    )

    messages = output_state["messages"]
    assert len(messages) >= 2

    # 1. Player message should welcome and introduce the action card
    player_msg = messages[0]
    assert isinstance(player_msg, HumanMessage)
    player_content = player_msg.content.lower()
    assert "welcome" in player_content or "meeting" in player_content or "pipeline" in player_content or "drift" in player_content

    # 2. Find the response from the stakeholder associated with the miscategorized requirement
    st_messages = [m for m in messages[1:] if f"[{target_req.stakeholder_id}]" in m.content]
    assert len(st_messages) >= 1

    target_st_msg = st_messages[0]
    revealed_intels = target_st_msg.additional_kwargs.get("revealed_intel", [])
    assert len(revealed_intels) >= 1
    assert revealed_intels[0]["is_corrected"] is True
    assert revealed_intels[0]["id"] == target_req.id

    # 3. State intel items should be updated to verified
    updated_intels = output_state["intel_items"]
    verified_item = next((it for it in updated_intels if getattr(it, "id", None) == target_req.id), None)
    assert verified_item is not None
    assert verified_item.is_correct_intel() is True
    assert verified_item.description == target_req.description
    assert verified_item.categorized_description == target_req.description

    # 4. Verify that correct_and_verify_intel_item updates the dossier description
    from mlops_serious_game.application.intel_handler import correct_and_verify_intel_item, retrieve_dossier_data, store_intel_item
    from unittest.mock import AsyncMock
    from conftest import ensure_test_user
    test_user = f"user_{thread_id}"
    ensure_test_user(test_user)
    mock_ws = AsyncMock()
    mock_ws.query_params = {"username": test_user}

    await store_intel_item(curr_challenge, mock_ws, wrong_intel)
    correct_and_verify_intel_item(
        username=test_user,
        requirement_id=target_req.id,
        curr_challenge=curr_challenge,
    )

    dossier = await retrieve_dossier_data(curr_challenge, mock_ws)
    st_entry = next((s for s in dossier if s["stakeholder_id"] == target_req.stakeholder_id), None)
    assert st_entry is not None
    dossier_intel = next((i for i in st_entry["intel_items"] if i["id"] == target_req.id), None)
    assert dossier_intel is not None
    assert dossier_intel["intel_type"] == "verified"
    assert dossier_intel["description"] == target_req.description

    # Clean up thread
    await reset_thread(thread_id)


if __name__ == "__main__":
    asyncio.run(test_pitch_debate_graph_structure())
    asyncio.run(test_pitch_debate_initial_turn_and_option_selection())
    asyncio.run(test_pitch_debate_dialogue_option_fallback_recovery())
    asyncio.run(test_pitch_debate_action_card_kickoff_and_refutation())
    print("All tests passed successfully!")

