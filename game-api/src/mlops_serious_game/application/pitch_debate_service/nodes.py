import asyncio
import math
import random
import re
from typing import Any, Optional

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from mlops_serious_game.application.dialogue_options_service import (
    DialogueOption,
    dialogue_option_node,
)
from mlops_serious_game.application.pitch_debate_service.chains import (
    get_stakeholder_response_chain,
)
from mlops_serious_game.application.pitch_debate_service.state import (
    EmotionDelta,
    EmotionValues,
    PitchDebateState,
    StakeholderIntelItem,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


def calculate_system_emotion_deltas(
    st_id: str,
    last_intel: Optional[StakeholderIntelItem],
    selected_option: Optional[DialogueOption],
) -> EmotionDelta:
    deltas = EmotionFactory.calculate_emotion_deltas(
        st_id=st_id,
        last_intel=last_intel,
        selected_option=selected_option,
    )
    return EmotionDelta(**deltas)


async def router_node(state: PitchDebateState, config: RunnableConfig):
    last_selected_option = state.get("last_selected_option")
    last_selected_intel = state.get("last_selected_intel")
    messages = state.get("messages", [])

    phase_id = state.get("phase_id")
    convincer_profiles = state.get("stakeholder_convincer_profile") or {}
    if convincer_profiles:
        all_stakeholders = list(convincer_profiles.keys())
    elif phase_id is not None:
        all_stakeholders = StakeholderFactory.get_active_stakeholders(phase_id)
    else:
        all_stakeholders = StakeholderFactory.get_available_stakeholders()

    # Rule 1: At the beginning of the discussion (no dialogue option chosen yet), route to everyone
    if not last_selected_option and len(messages) <= 1:
        return {"stakeholder_ids": all_stakeholders}

    # Rule 2: When an intel item-based dialogue option is chosen, route ONLY to the target stakeholder
    if last_selected_intel:
        target_id = last_selected_intel.stakeholder_id
        return {"stakeholder_ids": [target_id]}

    # Rule 3: Corporate noise should be routed to 1) the stakeholder that wrote the last message and 2) a random different stakeholder
    last_speaker_id = None
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) or getattr(msg, "type", "") == "ai":
            content_str = getattr(msg, "content", str(msg))
            match = re.match(r"^\[(.*?)\]", content_str)
            if match:
                last_speaker_id = match.group(1).strip()
                break

    if not last_speaker_id and len(messages) >= 2:
        prev_msg = messages[-2]
        content_str = getattr(prev_msg, "content", str(prev_msg))
        match = re.match(r"^\[(.*?)\]", content_str)
        if match:
            last_speaker_id = match.group(1).strip()

    if not last_speaker_id:
        last_speaker_id = all_stakeholders[0] if all_stakeholders else "willis_slif_business_manager"

    other_stakeholders = [st_id for st_id in all_stakeholders if st_id != last_speaker_id]
    if other_stakeholders:
        random_other_id = random.choice(other_stakeholders)
        # Processed in LIFO stack order in graph: [random_other_id, last_speaker_id]
        # pops last_speaker_id first (1), then random_other_id second (2)
        routed_stakeholders = [random_other_id, last_speaker_id]
    else:
        routed_stakeholders = [last_speaker_id]

    return {"stakeholder_ids": routed_stakeholders}


async def emotion_node(state: PitchDebateState, config: RunnableConfig):
    messages = state.get("messages", [])
    if not messages:
        return {}

    stakeholder_ids = state.get("stakeholder_ids", [])
    stakeholder_id = stakeholder_ids[-1] if stakeholder_ids else "willis_slif_business_manager"
    st = StakeholderFactory.get_stakeholder(stakeholder_id)

    last_selected_intel = state.get("last_selected_intel")
    last_selected_option = state.get("last_selected_option")

    # 100% System-based emotion updates calculated via vector distance & deterministic rules
    delta = calculate_system_emotion_deltas(
        st_id=st.id,
        last_intel=last_selected_intel,
        selected_option=last_selected_option,
    )

    # Retrieve current emotion values from state or initialize baseline
    emotion_values_map = dict(state.get("emotion_values", {}) or {})
    emotion_deltas_map = dict(state.get("emotion_deltas", {}) or {})
    curr_ev = emotion_values_map.get(st.id, EmotionValues())
    curr_ev_dict = curr_ev.model_dump() if hasattr(curr_ev, "model_dump") else (curr_ev.dict() if hasattr(curr_ev, "dict") else dict(curr_ev))
    delta_dict = delta.model_dump() if hasattr(delta, "model_dump") else (delta.dict() if hasattr(delta, "dict") else dict(delta))

    # Dynamic algorithmic updates with strict guardrails [0.0, 1.0] across all configured dimensions
    updated_kwargs = {}
    for dim in EmotionFactory.get_available_dimensions():
        curr_val = curr_ev_dict.get(dim, 0.5)
        d_val = delta_dict.get(f"{dim}_delta", 0.0)
        updated_kwargs[dim] = max(0.0, min(1.0, round(curr_val + d_val, 2)))

    updated_ev = EmotionValues(**updated_kwargs)

    emotion_values_map[st.id] = updated_ev
    emotion_deltas_map[st.id] = delta

    convincer_profile_map = dict(state.get("stakeholder_convincer_profile", {}) or {})
    if last_selected_intel and last_selected_intel.is_correct_intel() and convincer_profile_map:
        st_id = last_selected_intel.stakeholder_id
        if st_id in convincer_profile_map:
            reqs = list(convincer_profile_map[st_id])
            updated_reqs = [
                r for r in reqs
                if getattr(r, "categorized_description", "") != last_selected_intel.categorized_description
                and getattr(r, "correct_description", "") != last_selected_intel.correct_description
            ]
            convincer_profile_map[st_id] = updated_reqs

    return {
        "emotion_values": emotion_values_map,
        "emotion_deltas": emotion_deltas_map,
        "stakeholder_convincer_profile": convincer_profile_map,
    }


async def conversation_node(state: PitchDebateState, config: RunnableConfig):
    summary = state.get("summary", "")

    # Get active stakeholder ID from state
    stakeholder_ids = state.get("stakeholder_ids", [])
    stakeholder_id = stakeholder_ids[-1] if stakeholder_ids else "willis_slif_business_manager"
    st = StakeholderFactory.get_stakeholder(stakeholder_id)

    # Calculate current emotional state & prompt guidance from EmotionValues
    emotion_values_map = state.get("emotion_values", {})
    emotion_deltas_map = state.get("emotion_deltas", {})
    st_emotion_values = emotion_values_map.get(st.id, EmotionValues())
    if isinstance(st_emotion_values, dict):
        st_emotion_values = EmotionValues(**st_emotion_values)

    st_emotion_delta = emotion_deltas_map.get(st.id, EmotionDelta())
    if isinstance(st_emotion_delta, dict):
        st_emotion_delta = EmotionDelta(**st_emotion_delta)

    current_emotion = EmotionFactory.derive_emotional_state(st_emotion_values)
    emotion_instruction = EmotionFactory.derive_emotion_prompt(current_emotion)

    # Gather all intel items belonging to this stakeholder for private context
    all_intel_items = list(state.get("intel_items", []) or [])
    st_intel_items = [item for item in all_intel_items if getattr(item, "stakeholder_id", None) == st.id]
    private_intel_lines = []
    for item in st_intel_items:
        intent_val = getattr(item.correct_intent, "value", str(item.correct_intent)) if getattr(item, "correct_intent", None) else "requirement"
        private_intel_lines.append(f"- [{intent_val}]: {getattr(item, 'correct_description', getattr(item, 'description', ''))}")
    private_intel_context = "\n".join(private_intel_lines) if private_intel_lines else "None"

    last_selected_intel = state.get("last_selected_intel")
    intel_instruction = ""
    if last_selected_intel and st.id == last_selected_intel.stakeholder_id:
        intel_intent_val = getattr(last_selected_intel.correct_intent, "value", str(last_selected_intel.correct_intent)) if getattr(last_selected_intel, "correct_intent", None) else "requirement"
        if not last_selected_intel.is_correct_intel():
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - MISCONCEPTION DETECTED]: The player's latest response expressed a MISCATEGORIZED intel assumption!\n"
                f"The player falsely assumed: '{last_selected_intel.categorized_description}'\n"
                f"Your ACTUAL requirement is: [{intel_intent_val}] '{last_selected_intel.correct_description}'\n"
                f"You MUST react negatively! Express frustration or irritation at their false claim, "
                f"explicitly correct their misunderstanding, and EXPLICITLY REVEAL your actual requirement to demand that it is met."
            )
        else:
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - REQUIREMENT SATISFIED]: The player's dialogue option correctly satisfied your requirement: "
                f"[{intel_intent_val}] '{last_selected_intel.correct_description}'.\n"
                f"Acknowledge their understanding positively, express satisfaction/relief, and confirm that your requirement has been addressed!"
            )
    else:
        intel_instruction = (
            f"[GAME MASTER SPECIAL INSTRUCTION - SECRECY RULE ACTIVE]:\n"
            f"Your private underlying requirements and preferences are:\n{private_intel_context}\n"
            f"DO NOT directly state, list, or blurt out what your specific requirements/solutions are yet! "
            f"Voice your general concerns, emotional anxieties, or technical skepticism regarding the situation, but keep your specific requirements hidden "
            f"until the Project Manager plays a dialogue option that satisfies them or addresses a misconception."
        )

    conversation_chain = get_stakeholder_response_chain()
    input_messages = state["messages"]

    _split = state["challenge"].split("#")
    challenge_text = "".join(_split)

    # Combine static requirements with dynamic private_intel_context
    combined_requirements = f"{st.requirements}\n\nPrivate Intel Requirements:\n{private_intel_context}"

    response = await conversation_chain.ainvoke(
        {
            "messages": input_messages,
            "summary": summary,
            "challenge": challenge_text,
            "stakeholder_name": st.name,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "stakeholder_requirements": combined_requirements,
            "current_emotion": current_emotion,
            "emotion_instruction": emotion_instruction,
            "intel_instruction": intel_instruction,
        },
        config,
    )

    named_response = AIMessage(
        content=f"[{st.id}] {response.content}",
        additional_kwargs={
            **response.additional_kwargs,
            "emotion_values": st_emotion_values.model_dump() if hasattr(st_emotion_values, "model_dump") else dict(st_emotion_values),
            "emotion_delta": st_emotion_delta.model_dump() if hasattr(st_emotion_delta, "model_dump") else dict(st_emotion_delta),
        },
        response_metadata=response.response_metadata,
        id=response.id,
        name="Stakeholder",
        tool_calls=response.tool_calls,
    )

    # Direct real-time streaming callback to frontend
    if config and "configurable" in config:
        ws = config["configurable"].get("ws")
        callback = config["configurable"].get("callback")
        if callback:
            cb_state = dict(state)
            cb_state["messages"] = list(state.get("messages", [])) + [named_response]
            if asyncio.iscoroutinefunction(callback):
                await callback(websocket=ws, state=cb_state)
            else:
                callback(websocket=ws, state=cb_state)

    if named_response.tool_calls:
        return {"messages": named_response}

    # Remove the last stakeholder_id after processing
    new_stakeholder_ids = state["stakeholder_ids"][:-1]
    return {"messages": named_response, "stakeholder_ids": new_stakeholder_ids}