import asyncio
import math
import random
import re
import uuid
from typing import Any, Optional

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from loguru import logger
from mlops_serious_game.application.message_parser import sanitize_dashes, sanitize_messages
from mlops_serious_game.application.pitch_debate_service.chains import (
    get_player_kickoff_chain,
    get_player_utterance_chain,
    get_stakeholder_response_chain,
)
from mlops_serious_game.application.pitch_debate_service.state import (
    DialogueOption,
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


async def player_prompt_node(
    state: PitchDebateState, config: RunnableConfig = None
) -> dict[str, Any]:
    """Determines the player's prompt dynamically within the Pitch Debate LangGraph workflow.

    If initial_start is True or no option was chosen, yields the meeting kickoff message.
    Otherwise, invokes the player utterance chain to dynamically generate what the player
    says based on the chosen dialogue option and current discussion context.
    """
    last_selected_option = state.get("last_selected_option")
    last_selected_intel = state.get("last_selected_intel")
    addressed_stakeholder_id = state.get("addressed_stakeholder_id")
    challenge = state.get("challenge", "")
    messages = state.get("messages", [])

    configurable = (config or {}).get("configurable", {}) if config else {}
    ws = configurable.get("ws")
    callback = configurable.get("callback")

    # Case 1: Initial start or no option chosen yet
    if not last_selected_option:
        action_card = state.get("action_card") or {}
        ac_title = action_card.get("title", "").strip() if isinstance(action_card, dict) else ""
        ac_desc = action_card.get("description", "").strip() if isinstance(action_card, dict) else ""

        if ac_title or ac_desc:
            try:
                kickoff_chain = get_player_kickoff_chain()
                welcome_raw = await kickoff_chain.ainvoke(
                    {
                        "challenge": challenge,
                        "action_card_title": ac_title or "Proposed Action Plan",
                        "action_card_description": ac_desc or ac_title,
                    }
                )
                welcome_text = str(welcome_raw).strip().strip('"').strip("'")
                welcome_text = sanitize_dashes(welcome_text)
            except Exception as err:
                logger.warning(f"[player_prompt_node kickoff generation error] {err}")
                welcome_text = f"Welcome to the meeting everybody. Today I would like to propose our mitigation strategy: {ac_title}, where {ac_desc}."
        else:
            welcome_text = "Welcome to the meeting everybody."

        welcome_msg = HumanMessage(content=welcome_text)
        if callback:
            cb_state = {"messages": [welcome_msg]}
            if asyncio.iscoroutinefunction(callback):
                await callback(websocket=ws, state=cb_state)
            else:
                callback(websocket=ws, state=cb_state)
        return {"messages": [welcome_msg]}

    # Case 2: Option chosen - determine target stakeholder and generate player speech
    target_st_id = None
    if last_selected_option.type == "intel":
        target_st_id = (
            last_selected_intel.stakeholder_id
            if last_selected_intel
            else last_selected_option.intel_stakeholder_id
        )
    else:
        target_st_id = addressed_stakeholder_id

    target_st = None
    if target_st_id:
        try:
            target_st = StakeholderFactory.get_stakeholder(target_st_id)
        except Exception:
            target_st = None

    target_st_name = target_st.name if target_st else (target_st_id or "Stakeholder")
    target_st_role = getattr(target_st, "role_description", "") if target_st else ""

    parsed_messages = sanitize_messages(messages)
    history_msgs = parsed_messages[-6:] if len(parsed_messages) >= 6 else parsed_messages
    history_str = (
        "\n".join([m.content for m in history_msgs])
        if history_msgs
        else "(Meeting started)"
    )
    last_msg = parsed_messages[-1] if parsed_messages else None
    latest_statement = getattr(last_msg, "content", str(last_msg)) if last_msg else "(Meeting started)"

    utterance_chain = get_player_utterance_chain()
    if last_selected_option.type == "intel":
        intel_type_str = str(last_selected_option.intel_type or "requirement").lower()
        if intel_type_str == "negotiable_preference":
            type_desc = "negotiable preference (flexible preference open to compromise, NOT non-negotiable)"
        elif intel_type_str == "personal_friction":
            type_desc = "personal friction (interpersonal tension or team dynamic concern)"
        else:
            type_desc = "core requirement (mandatory, essential requirement)"
        intel_context = (
            f"Specific claim or stance to voice: '{last_selected_option.intel_description}'\n"
            f"Intel type: {type_desc}"
        )
        player_text = await utterance_chain.ainvoke(
            {
                "challenge": challenge,
                "target_stakeholder_name": target_st_name,
                "target_stakeholder_role": target_st_role,
                "option_type": "intel",
                "intel_context": intel_context,
                "archetype_name": "",
                "archetype_strategy": "",
                "history": history_str,
                "latest_statement": latest_statement,
            }
        )
    else:
        arch = last_selected_option.archetype
        arch_name = arch.name if arch else "General Alignment"
        arch_strat = arch.strategy if arch else "Align on general project goals"
        player_text = await utterance_chain.ainvoke(
            {
                "challenge": challenge,
                "target_stakeholder_name": target_st_name,
                "target_stakeholder_role": target_st_role,
                "option_type": "corporate_noise",
                "intel_context": "",
                "archetype_name": arch_name,
                "archetype_strategy": arch_strat,
                "history": history_str,
                "latest_statement": latest_statement,
            }
        )

    player_text = str(player_text).strip().strip('"')
    player_text = sanitize_dashes(player_text)
    last_selected_option.text = player_text
    new_msg = HumanMessage(content=player_text)

    if callback:
        cb_state = {"messages": [new_msg]}
        if asyncio.iscoroutinefunction(callback):
            await callback(websocket=ws, state=cb_state)
        else:
            callback(websocket=ws, state=cb_state)

    return {
        "messages": [new_msg],
        "last_selected_option": last_selected_option,
    }


async def router_node(state: PitchDebateState, config: RunnableConfig = None):
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
    if not last_selected_option:
        return {"stakeholder_ids": all_stakeholders}

    # Rule 2: When an intel item-based dialogue option is chosen, route ONLY to the target stakeholder
    if last_selected_option.type == "intel":
        target_id = (
            last_selected_intel.stakeholder_id
            if last_selected_intel
            else last_selected_option.intel_stakeholder_id
        )
        if target_id:
            return {"stakeholder_ids": [target_id]}

    # Rule 3: Corporate noise is routed to 1) the adressat from state and 2) a random other stakeholder
    addressed_id = state.get("addressed_stakeholder_id")
    if not addressed_id:
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) or getattr(msg, "type", "") == "ai":
                content_str = getattr(msg, "content", str(msg))
                match = re.match(r"^\[(.*?)\]", content_str)
                if match:
                    addressed_id = match.group(1).strip()
                    break

    if not addressed_id or (all_stakeholders and addressed_id not in all_stakeholders):
        addressed_id = all_stakeholders[0] if all_stakeholders else "willis_slif_business_manager"

    other_stakeholders = [st_id for st_id in all_stakeholders if st_id != addressed_id]
    if other_stakeholders:
        random_other_id = random.choice(other_stakeholders)
        # Processed in LIFO stack order in graph: [random_other_id, addressed_id]
        # pops addressed_id first (1), then random_other_id second (2)
        routed_stakeholders = [random_other_id, addressed_id]
    else:
        routed_stakeholders = [addressed_id]

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

    # If kickoff turn (no option chosen yet), check if action card contains a miscategorized intel for this stakeholder
    if not last_selected_option:
        action_card = state.get("action_card") or {}
        card_intel_ids = action_card.get("intel_ids", []) if isinstance(action_card, dict) else []
        wrong_card_intel_ids = action_card.get("wrong_intel_ids", []) if isinstance(action_card, dict) else []
        all_intel_items = list(state.get("intel_items", []) or [])
        st_wrong_intels = [
            item for item in all_intel_items
            if (getattr(item, "stakeholder_id", None) == st.id)
            and (item.id in card_intel_ids or item.id in wrong_card_intel_ids)
            and (not item.is_correct_intel() or item.id in wrong_card_intel_ids)
        ]
        if st_wrong_intels:
            delta = calculate_system_emotion_deltas(
                st_id=st.id,
                last_intel=st_wrong_intels[0],
                selected_option=None,
            )
        else:
            delta = EmotionDelta()
    else:
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

    action_card = state.get("action_card") or {}
    card_intel_ids = action_card.get("intel_ids", []) if isinstance(action_card, dict) else []
    wrong_card_intel_ids = action_card.get("wrong_intel_ids", []) if isinstance(action_card, dict) else []

    st_wrong_card_intels = [
        item for item in st_intel_items
        if (item.id in card_intel_ids or item.id in wrong_card_intel_ids)
        and (not item.is_correct_intel() or item.id in wrong_card_intel_ids)
    ]

    last_selected_intel = state.get("last_selected_intel")
    last_selected_option = state.get("last_selected_option")
    intel_instruction = ""
    revealed_intel_list = []

    # Case A: Kickoff round (initial turn, player presented action card)
    if not last_selected_option:
        if st_wrong_card_intels:
            wrong_item = st_wrong_card_intels[0]
            intel_intent_val = (
                getattr(wrong_item.type, "value", str(wrong_item.type))
                if getattr(wrong_item, "type", None)
                else "requirement"
            )
            req_desc = wrong_item.description
            cat_type = wrong_item.type.value if hasattr(wrong_item.type, "value") else str(wrong_item.type)

            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - MISCONCEPTION IN PROPOSED ACTION CARD]:\n"
                f"The Project Manager's proposed action card is built upon a MISUNDERSTANDING of your stance!\n"
                f"The proposal falsely assumes: '{wrong_item.categorized_description}'\n"
                f"Your ACTUAL stance is: [{intel_intent_val}] '{wrong_item.description}'\n"
                f"In this initial response to the proposal, you MUST explicitly refute this misconception, object to this aspect of the proposed plan, and reveal your actual stance following its true category ({intel_intent_val})!"
            )
            revealed_intel_list = [{
                "id": wrong_item.id,
                "description": req_desc,
                "categorized_type": cat_type,
                "intel_type": "verified",
                "stakeholder_id": st.id,
                "stakeholder_name": st.name,
                "is_corrected": True,
            }]
        else:
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - PROPOSAL EVALUATION & WHAT COULD GO WRONG]:\n"
                f"The Project Manager has opened the meeting and pitched their proposed action card.\n"
                f"Critically evaluate the proposed action plan from your specific MLOps perspective and responsibilities. Voice what could go wrong, pointing out realistic risks, potential bottlenecks, or failure modes from your domain before simulation.\n"
                f"Remember to keep your specific underlying requirements hidden unless addressed or corrected:\n{private_intel_context}"
            )

    # Case B: An intel item option was selected for this stakeholder
    elif last_selected_intel and st.id == last_selected_intel.stakeholder_id:
        intel_intent_val = (
            last_selected_intel.type.value
            if hasattr(last_selected_intel.type, "value")
            else str(last_selected_intel.type)
        )
        if not last_selected_intel.is_correct_intel():
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - MISCONCEPTION DETECTED]: The player's latest response expressed a MISCATEGORIZED intel assumption!\n"
                f"The player falsely assumed: '{last_selected_intel.categorized_description}'\n"
                f"Your ACTUAL stance is: [{intel_intent_val}] '{last_selected_intel.description}'\n"
                f"You MUST explicitly correct their misunderstanding and reveal your actual stance following its true category."
            )
            revealed_intel_list = [{
                "id": last_selected_intel.id,
                "description": last_selected_intel.description,
                "categorized_type": intel_intent_val,
                "intel_type": "verified",
                "stakeholder_id": st.id,
                "stakeholder_name": st.name,
                "is_corrected": True,
            }]
        else:
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - STANCE ADDRESSED]: The player's dialogue option correctly addressed your stance: "
                f"[{intel_intent_val}] '{last_selected_intel.description}'.\n"
                f"Acknowledge their understanding positively and confirm that your stance has been addressed!"
            )

    # Case C: Corporate noise or addressing another stakeholder
    else:
        opt_arch = last_selected_option.archetype if last_selected_option else None
        opt_name = opt_arch.name if opt_arch else ""

        st_real_arch = getattr(st, "convincer_archetype", "")

        if opt_name and st_real_arch and opt_name.lower().strip() != st_real_arch.lower().strip():
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - MISMATCHED PERSUASION STYLE]: The player addressed the room attempting to persuade using the '{opt_name}' approach.\n"
                f"However, your core decision-making style is '{st_real_arch}'!\n"
                f"You MUST react with skepticism, pushback, or irritation toward this mismatched reasoning! Make it clear to the Project Manager that '{opt_name}' thinking does not address your mindset or priorities.\n"
                f"Your private underlying requirements are:\n{private_intel_context}"
            )
        elif opt_name and st_real_arch and opt_name.lower().strip() == st_real_arch.lower().strip():
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - MATCHED PERSUASION STYLE]: The player addressed the room using your ideal communication style: '{st_real_arch}'.\n"
                f"Acknowledge their perspective favorably and express alignment with their framing!"
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
    raw_messages = state.get("messages", [])
    input_messages = sanitize_messages(raw_messages)

    if not input_messages:
        input_messages = [HumanMessage(content="The meeting begins. The Project Manager has opened the floor.")]

    _split = state["challenge"].split("#")
    challenge_text = "".join(_split)

    # Combine static requirements with dynamic private_intel_context
    combined_requirements = f"{st.requirements}\n\nPrivate Intel Requirements:\n{private_intel_context}"

    proposed_ac_title = ""
    proposed_ac_desc = ""
    if isinstance(action_card, dict) and (action_card.get("title") or action_card.get("description")):
        proposed_ac_title = action_card.get("title", "")
        proposed_ac_desc = action_card.get("description", "")

    response = await conversation_chain.ainvoke(
        {
            "messages": input_messages,
            "summary": summary,
            "challenge": challenge_text,
            "stakeholder_name": st.name,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "stakeholder_requirements": combined_requirements,
            "proposed_action_card_title": proposed_ac_title,
            "proposed_action_card_description": proposed_ac_desc,
            "current_emotion": current_emotion,
            "emotion_instruction": emotion_instruction,
            "intel_instruction": intel_instruction,
        },
        config,
    )

    cleaned_content = (response.content).strip()
    cleaned_content = sanitize_dashes(cleaned_content)

    add_kwargs = {
        **response.additional_kwargs,
        "emotion_values": st_emotion_values.model_dump() if hasattr(st_emotion_values, "model_dump") else dict(st_emotion_values),
        "emotion_delta": st_emotion_delta.model_dump() if hasattr(st_emotion_delta, "model_dump") else dict(st_emotion_delta),
    }
    if revealed_intel_list:
        add_kwargs["revealed_intel"] = revealed_intel_list

    named_response = AIMessage(
        content=f"[{st.id}] {cleaned_content}",
        additional_kwargs=add_kwargs,
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

    # Update intel_items in state if corrected
    updated_intel_items = list(state.get("intel_items", []) or [])
    if revealed_intel_list:
        for rev_item in revealed_intel_list:
            if rev_item.get("is_corrected"):
                rev_id = rev_item.get("id")
                for i, item in enumerate(updated_intel_items):
                    if getattr(item, "id", None) == rev_id:
                        from mlops_serious_game.domain.requirement import ConfidenceType, StakeholderIntelItem
                        from mlops_serious_game.domain.requirement_factory import RequirementFactory
                        req = RequirementFactory.get_requirement(rev_id)
                        if req:
                            updated_intel_items[i] = StakeholderIntelItem.from_requirement(
                                req,
                                intel_type=ConfidenceType.VERIFIED,
                                categorized_type=req.type,
                                description=req.description,
                            )
                        break

    if named_response.tool_calls:
        return {"messages": named_response, "intel_items": updated_intel_items}

    # Remove the last stakeholder_id after processing
    new_stakeholder_ids = state["stakeholder_ids"][:-1]
    return {"messages": named_response, "stakeholder_ids": new_stakeholder_ids, "intel_items": updated_intel_items}