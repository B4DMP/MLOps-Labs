import asyncio
import random
import uuid
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from mlops_serious_game.application.intel_dossier import (
    retrieve_intel_items,
    store_intel_item,
)
from mlops_serious_game.application.online_intel_service.chains import (
    get_player_engagement_chain,
    get_stakeholder_engagement_chain,
)
from mlops_serious_game.application.online_intel_service.state import OnlineIntelState
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import ConfidenceType, StakeholderIntelItem
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


async def generate_player_message_node(state: OnlineIntelState, config: RunnableConfig = None) -> dict[str, Any]:
    """Generates the player's message initiating the engagement card."""
    card = EngagementCardFactory.get_card(state["card_id"])
    target_ids = state.get("stakeholder_ids", [])
    
    # Resolve stakeholder names
    addressed_names = []
    for s_id in target_ids:
        st = StakeholderFactory.get_stakeholder(s_id)
        if st:
            addressed_names.append(st.name)

    if card.stakeholder_selection_amount == -1 or not addressed_names:
        addressed_str = "All team members / the entire project team"
    else:
        addressed_str = ", ".join(addressed_names)

    # Format recent conversation history
    history_msgs = state.get("messages", [])
    history_str = "\n".join([f"{msg.type}: {msg.content}" for msg in history_msgs[-6:]]) if history_msgs else "No previous messages."

    chain = get_player_engagement_chain()
    player_msg = await chain.ainvoke({
        "card_title": card.title,
        "card_description": card.description,
        "addressed_stakeholders": addressed_str,
        "challenge": state.get("challenge", ""),
        "conversation_history": history_str,
    })

    clean_player_msg = player_msg.strip().strip('"').strip("'")

    configurable = config.get("configurable", {}) if config else {}
    ws = configurable.get("ws")
    callback = configurable.get("callback")

    if callback and ws:
        asyncio.create_task(callback(
            websocket=ws,
            msg_type="player_message",
            data={
                "type": "player_message",
                "card_id": state.get("card_id"),
                "message": clean_player_msg,
            }
        ))

    return {
        "player_message": clean_player_msg,
        "messages": [HumanMessage(content=clean_player_msg)],
    }


async def determine_intel_items_node(state: OnlineIntelState, config: RunnableConfig = None) -> dict[str, Any]:
    """Algorithmically determines a random subset of undiscovered intel items to reveal for each addressed stakeholder."""
    configurable = config.get("configurable", {}) if config else {}
    ws = configurable.get("ws")
    phase_id = state.get("phase_id", 0)
    challenge_id = state.get("challenge_id", 0)

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id,
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    card = EngagementCardFactory.get_card(state["card_id"])
    reveal_count = getattr(card, "intel_reveal_count", 1)
    allowed_types = getattr(card, "allowed_requirement_types", [])

    # Fetch all already collected/known intel items for this user in DB
    collected_items = await retrieve_intel_items(curr_challenge, ws) if ws else []
    collected_req_ids = {item.requirement_id for item in collected_items}

    revealed_by_st: dict[str, list[dict[str, Any]]] = {}

    for st_id in state.get("stakeholder_ids", []):
        all_reqs = RequirementFactory.get_requirements_for_stakeholder_in_challenge(curr_challenge.id, st_id)
        
        # Filter for undiscovered requirements
        undiscovered = [r for r in all_reqs if r.id not in collected_req_ids]

        # Filter by allowed requirement types if specified
        if allowed_types:
            undiscovered = [
                r for r in undiscovered
                if (hasattr(r.type, "value") and r.type.value in allowed_types) or str(r.type) in allowed_types
            ]

        # Pick random subset of predefined size
        num_to_reveal = min(len(undiscovered), reveal_count)
        selected_reqs = random.sample(undiscovered, num_to_reveal) if num_to_reveal > 0 else []

        st_revealed_items = []
        for req in selected_reqs:
            intel_item = StakeholderIntelItem(
                id=str(uuid.uuid4()),
                requirement_id=req.id,
                intel_type=ConfidenceType.VERIFIED,
                categorized_type=req.type,
                description=req.description,
            )
            if ws:
                await store_intel_item(curr_challenge, ws, intel_item)
            
            item_dict = intel_item.model_dump(mode="json")
            item_dict["stakeholder_id"] = st_id
            st = StakeholderFactory.get_stakeholder(st_id)
            if st:
                item_dict["stakeholder_name"] = st.name
            st_revealed_items.append(item_dict)
            collected_req_ids.add(req.id)

        revealed_by_st[st_id] = st_revealed_items

    return {
        "revealed_intel_by_stakeholder": revealed_by_st,
    }


async def generate_stakeholder_responses_node(state: OnlineIntelState, config: RunnableConfig = None) -> dict[str, Any]:
    """Generates LLM responses for each addressed stakeholder incorporating the revealed intel items."""
    revealed_map = state.get("revealed_intel_by_stakeholder", {})
    player_msg = state.get("player_message", "")
    challenge_desc = state.get("challenge", "")

    configurable = config.get("configurable", {}) if config else {}
    ws = configurable.get("ws")
    callback = configurable.get("callback")

    chain = get_stakeholder_engagement_chain()
    responses: list[dict[str, Any]] = []
    ai_messages: list[AIMessage] = []

    card_id = state.get("card_id")
    card = EngagementCardFactory.get_card(card_id) if card_id else None
    intel_reveal_amount = getattr(card, "intel_reveal_count", 1) if card else 1
    max_sentences = max(1, 2 * intel_reveal_amount) if intel_reveal_amount > 0 else 2

    for st_id in state.get("stakeholder_ids", []):
        st = StakeholderFactory.get_stakeholder(st_id)
        if not st:
            continue

        st_intel_items = revealed_map.get(st_id, [])
        if st_intel_items:
            revealed_text = "\n".join([f"- {item['description']}" for item in st_intel_items])
        else:
            revealed_text = "None. (No new or unrevealed requirements to disclose at this time)."

        constraints = getattr(st, "constraints", getattr(st, "requirements", ""))

        response_text = await chain.ainvoke({
            "stakeholder_name": st.name,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "stakeholder_constraints": constraints,
            "challenge": challenge_desc,
            "player_message": player_msg,
            "revealed_intel": revealed_text,
            "max_sentences": max_sentences,
        })

        clean_response = response_text.strip().strip('"').strip("'")
        
        st_resp = {
            "stakeholder_id": st.id,
            "stakeholder_name": st.name,
            "message": clean_response,
            "revealed_intel_items": st_intel_items,
        }
        responses.append(st_resp)
        ai_messages.append(AIMessage(content=f"[{st.id}] {clean_response}"))

        if callback and ws:
            asyncio.create_task(callback(
                websocket=ws,
                msg_type="stakeholder_message",
                data={
                    "type": "stakeholder_message",
                    "card_id": state.get("card_id"),
                    "stakeholder_id": st.id,
                    "stakeholder_name": st.name,
                    "message": clean_response,
                    "revealed_intel_items": st_intel_items,
                }
            ))

    return {
        "stakeholder_responses": responses,
        "messages": ai_messages,
    }
