from typing import Any
from fastapi import WebSocket, WebSocketDisconnect
from opik.integrations.langchain import OpikTracer

from philoagents.application.conversation_service.generate_response import get_response
from philoagents.domain.stakeholder_factory import StakeholderFactory
from ..manager import manager


async def handle_chat_message(
    websocket: WebSocket,
    username: str,
    payload: dict
) -> None:
    session_id = payload.get("session_id") or f"MLOps_Convo_{username}"
    message_text = payload.get("message", "")
    challenge_context = payload.get("challenge", "")
    phase_id = payload.get("phase_id", 0)
    selection_mask = payload.get("selectionmask", [])
    
    async def callback(ws: WebSocket = None, state: dict = None, websocket: WebSocket = None, **kwargs):
        ws = websocket or ws
        json_response = []
        action_cards = []
        st_index_str = ""
        for s_id in StakeholderFactory.get_available_stakeholders():
            st = StakeholderFactory.get_stakeholder(s_id)
            if state["messages"][-1].content.startswith(f"[{st.division}-{st.name}]"):
                st_index_str = st.id
                break

        content = state["messages"][-1].content.split("]", 1)[1].lstrip() if "]" in state["messages"][-1].content else state["messages"][-1].content
        json_response.append({"message": content, "stakeholder_id": st_index_str})

        if "action_cards" in state:
            action_cards = [
                card.model_dump() if hasattr(card, 'model_dump') else card
                for card in state["action_cards"]
            ]
            all_stakeholders = [StakeholderFactory.get_stakeholder(s_id) for s_id in StakeholderFactory.get_available_stakeholders()]
            name_to_index = {st.name: st.id for st in all_stakeholders}

            for card in action_cards:
                if "stakeholder_names" in card:
                    card["stakeholder_ids"] = [name_to_index.get(name) for name in card["stakeholder_names"] if name in name_to_index]

        await manager.send_event(
            websocket=ws,
            event="chat:message_received",
            payload={
                "progressionIndex": 2,
                "type": "message",
                "messages": json_response,
                "action_cards": action_cards,
                "streaming": False
            }
        )

    try:
        messages, output_state = await get_response(
            messages=message_text,
            challenge=challenge_context,
            _thread_id=session_id,
            phase_id=phase_id,
            ws=websocket,
            callback=callback,
            selectionmask=selection_mask
        )

        is_cheating = output_state.get("cheating_detected") == True
        await manager.send_event(
            websocket=websocket,
            event="chat:graph_completed",
            payload={
                "progressionIndex": 2,
                "type": "graph_completed",
                "error": is_cheating,
                "errorMsg": "Your input was flagged as inappropriate for the serious game environment. Please rephrase your message." if is_cheating else None
            }
        )
    except Exception as e:
        opik_tracer = OpikTracer()
        opik_tracer.flush()
        print(f"[ChatHandler Error] {e}")
        await manager.send_event(
            websocket=websocket,
            event="chat:graph_completed",
            payload={
                "progressionIndex": 2,
                "type": "graph_completed",
                "error": True,
                "errorMsg": "An error occurred in the conversation service. Please try sending your message again."
            }
        )
