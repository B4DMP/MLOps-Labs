import asyncio
from typing import Any
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

from mlops_serious_game.application.action_card_pitch_service.nodes import sanitize_dialogue_text
from mlops_serious_game.application.action_card_veto_service.chains import get_action_card_veto_chain
from mlops_serious_game.application.action_card_veto_service.state import ActionCardVetoState


async def generate_veto_message_node(
    state: ActionCardVetoState, config: RunnableConfig | None = None
) -> dict[str, Any]:
    """Generates the high-power stakeholder's veto declaration message."""
    challenge_context = state.get("challenge_context", "")
    action_card_summary = state.get("action_card_summary", "")
    commitments = state.get("action_card_commitments", [])
    commitments_str = "\n".join([f"- {c}" for c in commitments]) if commitments else "No specific commitments recorded."
    
    st_id = state.get("stakeholder_id", "")
    st_name = state.get("stakeholder_name", st_id)
    responsibilities = state.get("stakeholder_responsibilities", "")
    priorities = state.get("stakeholder_priorities", "")
    constraints = state.get("stakeholder_constraints", "")
    emotional_state = state.get("emotional_state", "critical")
    objection_detail = state.get("objection_detail", "A critical constraint was violated.")
    pitch_chat_summary = state.get("pitch_chat_summary", "")

    chain = get_action_card_veto_chain()
    raw_veto_msg = await chain.ainvoke({
        "stakeholder_name": st_name,
        "stakeholder_responsibilities": responsibilities,
        "stakeholder_priorities": priorities,
        "stakeholder_constraints": constraints,
        "challenge": challenge_context,
        "action_card_summary": action_card_summary,
        "action_card_commitments": commitments_str,
        "objection_detail": objection_detail,
        "pitch_chat_summary": pitch_chat_summary,
        "emotional_state": emotional_state,
    })

    clean_veto_msg = sanitize_dialogue_text(raw_veto_msg, name_to_strip=st_name, st_id=st_id)

    configurable = config.get("configurable", {}) if config else {}
    ws = configurable.get("ws")
    callback = configurable.get("callback")

    if callback and ws:
        asyncio.create_task(callback(
            websocket=ws,
            msg_type="veto_message",
            data={
                "type": "veto_message",
                "stakeholder_id": st_id,
                "stakeholder_name": st_name,
                "message": clean_veto_msg,
            }
        ))

    return {
        "veto_message": clean_veto_msg,
        "messages": [AIMessage(content=f"[{st_id}] {clean_veto_msg}")],
    }
