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
from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.story import story_for
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


from mlops_serious_game.domain.requirement import PLAUSIBLE_WRONG_TAG, ConfidenceType, IntelSource, describe_tag
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory


def _normalize_intel_items(intel_items: list) -> list[StakeholderIntelItem]:
    normalized = []
    for raw in intel_items:
        if isinstance(raw, StakeholderIntelItem):
            normalized.append(raw)
        elif isinstance(raw, dict):
            try:
                normalized.append(StakeholderIntelItem(**raw))
            except Exception:
                pass
    return normalized


def _get_stakeholder_wrong_card_intels(
    st_id: str,
    action_card: dict,
    intel_items: list,
) -> list[StakeholderIntelItem]:
    card_intel_ids = action_card.get("intel_ids", []) if isinstance(action_card, dict) else []
    wrong_card_intel_ids = action_card.get("wrong_intel_ids", []) if isinstance(action_card, dict) else []
    normalized_items = _normalize_intel_items(intel_items)

    found_items = []
    seen_ids = set()
    for item in normalized_items:
        if getattr(item, "stakeholder_id", None) == st_id:
            if item.id in card_intel_ids or item.id in wrong_card_intel_ids:
                if not item.is_correct_intel() or item.id in wrong_card_intel_ids:
                    found_items.append(item)
                    seen_ids.add(item.id)

    for cid in list(wrong_card_intel_ids):
        if cid not in seen_ids:
            req = RequirementFactory.get_requirement(cid)
            if req and req.stakeholder_id == st_id:
                other_type = PLAUSIBLE_WRONG_TAG[req.type]
                wrong_desc = OfflineIntelArtifactFactory.get_wrong_description(cid, other_type.value) or req.description
                item = StakeholderIntelItem.from_requirement(
                    req,
                    intel_type=ConfidenceType.UNCONFIRMED,
                    categorized_type=other_type,
                    categorized_description=wrong_desc,
                )
                found_items.append(item)
                seen_ids.add(cid)

    return found_items


def _get_stakeholder_correct_card_intels(
    st_id: str,
    action_card: dict,
    intel_items: list,
) -> list[StakeholderIntelItem]:
    card_intel_ids = action_card.get("intel_ids", []) if isinstance(action_card, dict) else []
    wrong_card_intel_ids = set(action_card.get("wrong_intel_ids", []) if isinstance(action_card, dict) else [])
    normalized_items = _normalize_intel_items(intel_items)

    found_items = []
    seen_ids = set()
    for item in normalized_items:
        if getattr(item, "stakeholder_id", None) == st_id:
            if item.id in card_intel_ids and item.id not in wrong_card_intel_ids:
                if item.is_correct_intel():
                    found_items.append(item)
                    seen_ids.add(item.id)

    for cid in card_intel_ids:
        if cid not in wrong_card_intel_ids and cid not in seen_ids:
            req = RequirementFactory.get_requirement(cid)
            if req and req.stakeholder_id == st_id:
                item = StakeholderIntelItem.from_requirement(
                    req,
                    intel_type=ConfidenceType.VERIFIED,
                    categorized_type=req.type,
                    description=req.description,
                )
                found_items.append(item)
                seen_ids.add(cid)

    return found_items


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
        type_desc = describe_tag(str(last_selected_option.intel_type or "driver").lower())
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
                "history": history_str,
                "latest_statement": latest_statement,
            }
        )
    else:
        player_text = await utterance_chain.ainvoke(
            {
                "challenge": challenge,
                "target_stakeholder_name": target_st_name,
                "target_stakeholder_role": target_st_role,
                "option_type": "corporate_noise",
                "intel_context": "",
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
        action_card = state.get("action_card") or {}
        card_intel_ids = action_card.get("intel_ids", []) if isinstance(action_card, dict) else []
        wrong_intel_ids = action_card.get("wrong_intel_ids", []) if isinstance(action_card, dict) else []
        for iid in list(card_intel_ids) + list(wrong_intel_ids):
            req = RequirementFactory.get_requirement(iid)
            if req and req.stakeholder_id and req.stakeholder_id not in all_stakeholders:
                all_stakeholders.append(req.stakeholder_id)
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
        st_wrong_intels = _get_stakeholder_wrong_card_intels(
            st_id=st.id,
            action_card=action_card,
            intel_items=state.get("intel_items", []) or [],
        )
        if st_wrong_intels:
            wrong_item = st_wrong_intels[0]
            # Ensure wrong_item evaluates as incorrect so misattributed_intel delta rule triggers
            if wrong_item.is_correct_intel():
                other_type = PLAUSIBLE_WRONG_TAG[wrong_item.type]
                wrong_item = StakeholderIntelItem.from_requirement(
                    RequirementFactory.get_requirement(wrong_item.id) or wrong_item,
                    intel_type=ConfidenceType.UNCONFIRMED,
                    categorized_type=other_type,
                    categorized_description=wrong_item.categorized_description or wrong_item.description,
                )
            delta = calculate_system_emotion_deltas(
                st_id=st.id,
                last_intel=wrong_item,
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
        intent_val = getattr(item.correct_intent, "value", str(item.correct_intent)) if getattr(item, "correct_intent", None) else "driver"
        private_intel_lines.append(f"- [{intent_val}]: {getattr(item, 'correct_description', getattr(item, 'description', ''))}")
    private_intel_context = "\n".join(private_intel_lines) if private_intel_lines else "None"

    action_card = state.get("action_card") or {}
    card_intel_ids = action_card.get("intel_ids", []) if isinstance(action_card, dict) else []
    wrong_card_intel_ids = action_card.get("wrong_intel_ids", []) if isinstance(action_card, dict) else []

    last_selected_intel = state.get("last_selected_intel")
    last_selected_option = state.get("last_selected_option")
    intel_instruction = ""
    revealed_intel_list = []

    # Case A: Kickoff round (initial turn, player presented action card)
    if not last_selected_option:
        st_wrong_card_intels = _get_stakeholder_wrong_card_intels(
            st_id=st.id,
            action_card=action_card,
            intel_items=all_intel_items,
        )
        st_correct_card_intels = _get_stakeholder_correct_card_intels(
            st_id=st.id,
            action_card=action_card,
            intel_items=all_intel_items,
        )

        if st_wrong_card_intels:
            wrong_item = st_wrong_card_intels[0]
            intel_intent_val = (
                getattr(wrong_item.type, "value", str(wrong_item.type))
                if getattr(wrong_item, "type", None)
                else "driver"
            )
            req_desc = wrong_item.description
            cat_type = wrong_item.type.value if hasattr(wrong_item.type, "value") else str(wrong_item.type)

            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - MISCONCEPTION IN PROPOSED MITIGATION PLAN]:\n"
                f"The Project Manager's proposed action plan is built upon a MISUNDERSTANDING of your stance!\n"
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
        elif st_correct_card_intels:
            correct_item = st_correct_card_intels[0]
            intel_intent_val = (
                getattr(correct_item.type, "value", str(correct_item.type))
                if getattr(correct_item, "type", None)
                else "driver"
            )
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - PROPOSAL EVALUATION & STANCE CONFIRMED]:\n"
                f"The Project Manager has presented their proposed action plan, which correctly incorporates your stance: "
                f"[{intel_intent_val}] '{correct_item.description}'.\n"
                f"Acknowledge and confirm that this aspect of the plan aligns with your expectations, while also evaluating any remaining risks, questions, or bottlenecks from your MLOps perspective."
            )
            revealed_intel_list = [{
                "id": correct_item.id,
                "description": correct_item.description,
                "categorized_type": intel_intent_val,
                "intel_type": "verified",
                "stakeholder_id": st.id,
                "stakeholder_name": st.name,
                "is_corrected": False,
            }]
        else:
            intel_instruction = (
                f"[GAME MASTER SPECIAL INSTRUCTION - PROPOSAL EVALUATION & WHAT COULD GO WRONG]:\n"
                f"The Project Manager has opened the meeting and pitched their proposed action plan.\n"
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
                f"[GAME MASTER SPECIAL INSTRUCTION - MISCONCEPTION DETECTED]: The Project Manager's latest statement expressed a MISCATEGORIZED assumption!\n"
                f"The Project Manager falsely assumed: '{last_selected_intel.categorized_description}'\n"
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
                f"[GAME MASTER SPECIAL INSTRUCTION - STANCE ADDRESSED]: The Project Manager's statement correctly addressed your stance: "
                f"[{intel_intent_val}] '{last_selected_intel.description}'.\n"
                f"Acknowledge their understanding positively and confirm that your stance has been addressed!"
            )

    # Case C: Corporate noise or addressing another stakeholder
    else:
        intel_instruction = (
            f"[GAME MASTER SPECIAL INSTRUCTION - SECRECY RULE ACTIVE]:\n"
            f"Your private underlying requirements and preferences are:\n{private_intel_context}\n"
            f"DO NOT directly state, list, or blurt out what your specific requirements/solutions are yet! "
            f"Voice your general concerns, emotional anxieties, or technical skepticism regarding the situation, but keep your specific requirements hidden "
            f"until the Project Manager addresses them or resolves a misconception."
        )

    conversation_chain = get_stakeholder_response_chain()
    raw_messages = state.get("messages", [])
    input_messages = sanitize_messages(raw_messages)

    if not input_messages:
        input_messages = [HumanMessage(content="The meeting begins. The Project Manager has opened the floor.")]

    _split = state["challenge"].split("#")
    challenge_text = "".join(_split)

    # Build graph-targeted context (plan 06 step 9): owned components + card targets.
    # Never the whole graph — only the handful of components this stakeholder owns.
    owned_components = ""
    card_targets = ""
    username = state.get("username", "")
    if username:
        try:
            from mlops_serious_game.application.pitch_debate_service.store import load_pitch
            tech_graph = GraphFactory.get_graph()
            graph_state = graph_store.load_state(username).state

            # Owned components with story at current level
            owned = [c for c in tech_graph.components if tech_graph.owner_of(c.id) == st.id]
            if owned:
                lines = []
                for c in owned:
                    lv = graph_state.level(c.id)
                    level_name = tech_graph.levels[lv] if lv < len(tech_graph.levels) else str(lv)
                    fragment = story_for(tech_graph, graph_state, c.id)
                    lines.append(f"- {c.name} ({level_name}): {fragment}")
                owned_components = "\n".join(lines)

            # Card targets with current level (if a card is being built)
            pitch_state = load_pitch(username, state.get("phase_id", 0), state.get("challenge_id", 0))
            if pitch_state and pitch_state.card_item_ids:
                all_items = RequirementFactory.get_requirements_for_challenge(state.get("challenge_id", 0))
                items_by_id = {r.id: r for r in all_items}
                seen: set[str] = set()
                lines = []
                for item_id in pitch_state.card_item_ids:
                    item = items_by_id.get(item_id)
                    if item is None:
                        continue
                    raw_ops = getattr(item, "ops", None) or []
                    targets_for_item = [op["target"] for op in raw_ops if isinstance(op, dict) and op.get("target")]
                    if not targets_for_item:
                        suggested = getattr(item, "suggested", None)
                        t = getattr(suggested, "target", None) if suggested else None
                        if t:
                            targets_for_item = [t]
                    for t in targets_for_item:
                        if t in seen:
                            continue
                        seen.add(t)
                        try:
                            lv = graph_state.level(t)
                            level_name = tech_graph.levels[lv] if lv < len(tech_graph.levels) else str(lv)
                            comp_name = tech_graph.component(t).name if tech_graph.is_component(t) else t
                            lines.append(f"- {comp_name} ({t}): currently {level_name}")
                        except Exception:
                            lines.append(f"- {t}")
                if lines:
                    card_targets = "\n".join(lines)
        except Exception:
            pass

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
            "private_requirements": private_intel_context,
            "owned_components": owned_components,
            "card_targets": card_targets,
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

    # Update intel_items in state if revealed (both corrected refutations and confirmed correct items)
    updated_intel_items = _normalize_intel_items(state.get("intel_items", []) or [])
    if revealed_intel_list:
        for rev_item in revealed_intel_list:
            rev_id = rev_item.get("id")
            for i, item in enumerate(updated_intel_items):
                if getattr(item, "id", None) == rev_id:
                    req = RequirementFactory.get_requirement(rev_id)
                    if req:
                        # A correction is news the player learned in the debate; a confirmation
                        # only re-stamps what they already had, so it keeps its original source.
                        updated_intel_items[i] = StakeholderIntelItem.from_requirement(
                            req,
                            intel_type=ConfidenceType.VERIFIED,
                            categorized_type=req.type,
                            description=req.description,
                            source=IntelSource.DEBATE if rev_item.get("is_corrected") else item.source,
                        )
                    break

    if named_response.tool_calls:
        return {"messages": named_response, "intel_items": updated_intel_items}

    # Remove the last stakeholder_id after processing
    new_stakeholder_ids = state["stakeholder_ids"][:-1]
    return {"messages": named_response, "stakeholder_ids": new_stakeholder_ids, "intel_items": updated_intel_items}