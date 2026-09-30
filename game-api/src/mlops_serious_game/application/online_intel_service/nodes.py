import asyncio
import uuid
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from mlops_serious_game.application.graph_service.scheduler import stable_rank
from mlops_serious_game.application.intel_handler import (
    handle_intel_verification,
    retrieve_intel_items,
    store_intel_item,
)
from mlops_serious_game.application.message_parser import sanitize_dashes, sanitize_messages
from mlops_serious_game.application.online_intel_service.chains import (
    get_player_engagement_chain,
    get_stakeholder_engagement_chain,
)
from mlops_serious_game.application.online_intel_service.state import OnlineIntelState
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import ConfidenceType, IntelSource, StakeholderIntelItem
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.requirement import describe_tag


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
    parsed_history_msgs = sanitize_messages(history_msgs)
    history_str = "\n".join([msg.content for msg in parsed_history_msgs[-6:]]) if parsed_history_msgs else "No previous messages."

    chain = get_player_engagement_chain()
    player_msg = await chain.ainvoke({
        "card_title": card.title,
        "card_description": card.description,
        "addressed_stakeholders": addressed_str,
        "challenge": state.get("challenge", ""),
        "conversation_history": history_str,
    })

    clean_player_msg = player_msg.strip().strip('"').strip("'")
    clean_player_msg = sanitize_dashes(clean_player_msg)

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


def _tag_value(tag) -> str:
    return str(getattr(tag, "value", tag))


def _stable_pick(seed: str, items: list, n: int) -> list:
    """The first `n` items in `stable_rank` order: same seed, same items, same picks every time
    (plan 11's standing rule - no `random.sample` in this plan's paths). `stable_rank` is the same
    helper `graph_service.scheduler` uses to pick a challenge deterministically."""
    if n <= 0 or not items:
        return []
    return sorted(items, key=lambda i: stable_rank(seed, i.id))[:n]


def plan_engagement(
    held: list,
    pool: list,
    st_id: str,
    budget: int,
    allowed_types: list[str],
    seed: str = "",
) -> tuple[list, list]:
    """Which of one stakeholder's notes a card checks, and which it reveals.

    Checks come first: an unconfirmed note the player already holds is what a conversation should
    settle. Held notes are filtered by the tag the player filed them under, never the true one, so
    a card passing a note over gives nothing away. Whatever budget is left reveals notes not found
    yet. `seed` should fold in the player, the challenge and how many times this card has already
    been played, so a replayed card does not always turn up the exact same order (D49/plan 11).
    """
    def allowed(tag) -> bool:
        return not allowed_types or _tag_value(tag) in allowed_types

    held_ids = {i.id for i in held}
    unconfirmed = [
        i for i in held
        if i.stakeholder_id == st_id
        and _tag_value(i.intel_type).lower() != "verified"
        and allowed(i.categorized_type)
    ]
    checks = _stable_pick(f"{seed}|check", unconfirmed, budget) if budget > 0 else []
    left = budget - len(checks)
    undiscovered = [r for r in pool if r.id not in held_ids and allowed(r.type)]
    reveals = _stable_pick(f"{seed}|reveal", undiscovered, left) if left > 0 else []
    return checks, reveals


async def determine_intel_items_node(state: OnlineIntelState, config: RunnableConfig = None) -> dict[str, Any]:
    """Per addressed stakeholder: checks unconfirmed notes the player holds, then reveals new ones.

    Both share the card's `turns` budget, see `plan_engagement`. A checked note is verified
    and corrected to its true tag exactly as the Verify Intel Item card does it.
    """
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
    reveal_count = getattr(card, "turns", 1)
    allowed_types = getattr(card, "allowed_requirement_types", [])

    # Fetch all already collected/known intel items for this user in DB
    collected_items = await retrieve_intel_items(curr_challenge, ws) if ws else []
    # Identity comes from the `mlops_player` cookie, not a `username` query param, since the
    # websocket handshake no longer takes one at all (docs/plans/session-persistence-and-url-routing.md,
    # D-ws-cookie). Only used here to seed a deterministic shuffle, so an unresolvable cookie
    # degrades to "" rather than raising.
    from mlops_serious_game.application.services.auth_service import PLAYER_COOKIE_NAME, verify_player_token
    user_id = (verify_player_token(ws.cookies.get(PLAYER_COOKIE_NAME)) or "") if ws else ""
    # Folds in how much the player already knows, so a replayed card does not always turn up
    # the exact same order (D49) without needing a dedicated play-count column.
    seed = f"{user_id}|{curr_challenge.id}|{state['card_id']}|{len(collected_items)}"

    revealed_by_st: dict[str, list[dict[str, Any]]] = {}

    for st_id in state.get("stakeholder_ids", []):
        all_reqs = RequirementFactory.get_requirements_for_stakeholder_in_challenge(curr_challenge.id, st_id)
        checks, selected_reqs = plan_engagement(
            collected_items, all_reqs, st_id, reveal_count, allowed_types, seed=f"{seed}|{st_id}"
        )
        st = StakeholderFactory.get_stakeholder(st_id)

        st_revealed_items = []
        for held_item in checks:
            result = await handle_intel_verification(curr_challenge, ws, held_item.id)
            if result.get("status") != "success":
                continue
            item_dict = dict(result["intel_item"])
            item_dict["stakeholder_id"] = st_id
            if st:
                item_dict["stakeholder_name"] = st.name
            # The chat shows a checked note apart from a new one, and whether the player had it right.
            item_dict["was_checked"] = True
            item_dict["old_categorized_type"] = result.get("old_categorized_type")
            st_revealed_items.append(item_dict)

        for req in selected_reqs:
            intel_item = StakeholderIntelItem.from_requirement(
                req,
                intel_type=ConfidenceType.VERIFIED,
                categorized_type=req.type,
                description=req.description,
                source=IntelSource.INTERVIEW,
            )
            if ws:
                await store_intel_item(curr_challenge, ws, intel_item)
            
            item_dict = intel_item.model_dump(mode="json")
            item_dict["stakeholder_id"] = st_id
            if st:
                item_dict["stakeholder_name"] = st.name
            st_revealed_items.append(item_dict)

        revealed_by_st[st_id] = st_revealed_items

    return {
        "revealed_intel_by_stakeholder": revealed_by_st,
    }


def _format_revealed_intel_item(item: dict[str, Any]) -> str:
    cat = item.get("categorized_type") or item.get("type")
    if hasattr(cat, "value"):
        cat = cat.value
    desc = item.get("description", "")
    return f"- [{describe_tag(str(cat).lower())}]: {desc}"


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
    intel_reveal_amount = getattr(card, "turns", 1) if card else 1
    max_sentences = max(1, 2 * intel_reveal_amount) if intel_reveal_amount > 0 else 2

    for st_id in state.get("stakeholder_ids", []):
        st = StakeholderFactory.get_stakeholder(st_id)
        if not st:
            continue

        st_intel_items = revealed_map.get(st_id, [])
        if st_intel_items:
            revealed_text = "\n".join(list(map(_format_revealed_intel_item, st_intel_items)))
        else:
            revealed_text = "None. (No new or unrevealed stances or requirements to disclose at this time)."

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
        clean_response = sanitize_dashes(clean_response)
        
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
