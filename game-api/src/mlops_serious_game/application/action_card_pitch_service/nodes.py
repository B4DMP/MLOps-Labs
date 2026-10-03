import asyncio
import re
from typing import Any
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from mlops_serious_game.application.action_card_pitch_service.chains import (
    get_player_pitch_chain,
    get_stakeholder_pitch_chain,
)
from mlops_serious_game.application.action_card_pitch_service.state import (
    ActionCardPitchState,
    StakeholderPitchContext,
)
from mlops_serious_game.application.message_parser import sanitize_dashes


def sanitize_dialogue_text(text: str, name_to_strip: str | None = None, st_id: str | None = None) -> str:
    """Sanitizes dialogue text by stripping speaker prefixes, quotes, and forbidden dashes."""
    cleaned = (text or "").strip().strip('"').strip("'")
    
    # Strip potential speaker prefixes like "Efficiency Ellen: ", "Ellen: ", "[Ellen]: ", etc.
    patterns_to_try = []
    if name_to_strip:
        patterns_to_try.append(re.escape(name_to_strip))
        # Also try first name if name consists of multiple words (e.g. "Ellen" from "Efficiency Ellen")
        parts = name_to_strip.split()
        if len(parts) > 1:
            patterns_to_try.append(re.escape(parts[-1]))
            patterns_to_try.append(re.escape(parts[0]))
    if st_id:
        patterns_to_try.append(re.escape(st_id))
    
    for pat in patterns_to_try:
        cleaned = re.sub(rf"^(?:\[?{pat}\]?\s*[:\-–—]\s*)", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(rf"^\[{pat}\]\s*", "", cleaned, flags=re.IGNORECASE).strip()

    # Generic prefix cleanup like "Player: ", "Project Manager: ", "Stakeholder: "
    cleaned = re.sub(r"^(?:Player|Project\s*Manager|PM|Stakeholder)\s*[:\-–—]\s*", "", cleaned, flags=re.IGNORECASE).strip()

    # Replace any raw "req.<identifier>" with natural words
    cleaned = re.sub(r"\breq\.([a-zA-Z0-9_]+)\b", lambda m: m.group(1).replace("_", " "), cleaned)

    # Strip out-of-character parenthetical meta-commentary (e.g. "(If allowed to speak...)", "(Note: ...)")
    cleaned = re.sub(r"\s*\((?:If allowed|Note:|As an? |Speaking as|In character|Out of character|Rule|Constraint)[^)]*\)", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"\s*\([^)]*sentence[^)]*\)", "", cleaned, flags=re.IGNORECASE).strip()

    cleaned = sanitize_dashes(cleaned)
    return cleaned.strip().strip('"').strip("'")


async def generate_player_pitch_node(
    state: ActionCardPitchState, config: RunnableConfig | None = None
) -> dict[str, Any]:
    """Generates the player's opening pitch message presenting the Action Card."""
    challenge_context = state.get("challenge_context", "")
    addressed_stakeholders = state.get("addressed_stakeholders", "everyone in the room")
    card_summary = state.get("action_card_summary", "")
    pitch_attempt = state.get("pitch_attempt", 1)

    chain = get_player_pitch_chain()
    raw_player_msg = await chain.ainvoke({
        "challenge": challenge_context,
        "addressed_stakeholders": addressed_stakeholders,
        "action_card_summary": card_summary,
        "pitch_attempt": pitch_attempt,
    })

    clean_player_msg = sanitize_dialogue_text(raw_player_msg)

    configurable = config.get("configurable", {}) if config else {}
    ws = configurable.get("ws")
    callback = configurable.get("callback")

    if callback and ws:
        asyncio.create_task(callback(
            websocket=ws,
            msg_type="player_message",
            data={
                "type": "player_message",
                "message": clean_player_msg,
                "pitch_attempt": pitch_attempt,
            }
        ))

    return {
        "player_message": clean_player_msg,
        "messages": [HumanMessage(content=clean_player_msg)],
    }


async def generate_stakeholder_pitch_responses_node(
    state: ActionCardPitchState, config: RunnableConfig | None = None
) -> dict[str, Any]:
    """Generates a single, emotion- and buy-in-conditioned evaluation response for each stakeholder in the room."""
    challenge_context = state.get("challenge_context", "")
    player_message = state.get("player_message", "")
    card_summary = state.get("action_card_summary", "")
    stakeholders: list[StakeholderPitchContext] = state.get("stakeholders", [])
    pitch_attempt = state.get("pitch_attempt", 1)

    configurable = config.get("configurable", {}) if config else {}
    ws = configurable.get("ws")
    callback = configurable.get("callback")

    chain = get_stakeholder_pitch_chain()
    responses: list[dict[str, Any]] = []
    ai_messages: list[AIMessage] = []

    for st_ctx in stakeholders:
        st_id = st_ctx.get("stakeholder_id", "")
        st_name = st_ctx.get("stakeholder_name", st_id)
        responsibilities = st_ctx.get("responsibilities", "")
        priorities = st_ctx.get("priorities", "")
        constraints = st_ctx.get("constraints", "")
        buy_in_val = st_ctx.get("buy_in", 0.5)
        band = st_ctx.get("band", "amber")
        emotional_state = st_ctx.get("emotional_state", "neutral")
        is_approval = st_ctx.get("is_approval", False)
        objection_kind = st_ctx.get("objection_kind", "none")
        objection_detail = st_ctx.get("objection_detail", "No objections.")

        raw_response = await chain.ainvoke({
            "stakeholder_name": st_name,
            "stakeholder_responsibilities": responsibilities,
            "stakeholder_priorities": priorities,
            "stakeholder_constraints": constraints,
            "challenge": challenge_context,
            "player_message": player_message,
            "action_card_summary": card_summary,
            "buy_in": f"{buy_in_val:.2f}",
            "band": band,
            "emotional_state": emotional_state,
            "is_approval": is_approval,
            "objection_kind": objection_kind,
            "objection_detail": objection_detail,
            "pitch_attempt": pitch_attempt,
            "repeat_context": st_ctx.get("repeat_context") or "",
        })

        clean_response = sanitize_dialogue_text(raw_response, name_to_strip=st_name, st_id=st_id)

        st_resp = {
            "stakeholder_id": st_id,
            "stakeholder_name": st_name,
            "message": clean_response,
            "buy_in": buy_in_val,
            "band": band,
            "emotional_state": emotional_state,
            "objection_kind": objection_kind,
        }
        responses.append(st_resp)
        ai_messages.append(AIMessage(content=f"[{st_id}] {clean_response}"))

        if callback and ws:
            asyncio.create_task(callback(
                websocket=ws,
                msg_type="stakeholder_message",
                data={
                    "type": "stakeholder_message",
                    "stakeholder_id": st_id,
                    "stakeholder_name": st_name,
                    "message": clean_response,
                    "buy_in": buy_in_val,
                    "band": band,
                    "emotional_state": emotional_state,
                }
            ))

    return {
        "stakeholder_responses": responses,
        "messages": ai_messages,
    }
