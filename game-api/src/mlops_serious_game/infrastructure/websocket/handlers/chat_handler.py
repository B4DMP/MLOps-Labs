from typing import Any
from fastapi import WebSocket
from opik.integrations.langchain import OpikTracer
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from langchain_core.messages import HumanMessage
from mlops_serious_game.application.pitch_debate_service import (
    EmotionValues,
    get_response,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database import GameSession, get_session
from mlops_serious_game.infrastructure.websocket.handlers.game_handler import (
    get_discovered_intel_items,
)
from ..manager import manager


async def handle_chat_message(
    websocket: WebSocket,
    username: str,
    payload: dict,
) -> None:
    try:
        session_id = payload.get("session_id") or f"MLOps_Convo_{username}"
        challenge_context = payload.get("challenge", "")
        phase_id = payload.get("phase_id", 0)
        challenge_id = payload.get("challenge_id", 0)

        option_index = payload.get("option_index")
        initial_start = payload.get("initial_start", False)

        if option_index is None and not initial_start:
            raise ValueError(
                "Missing 'option_index' in payload. Dialogue options must be selected by index."
            )

        if option_index is not None and isinstance(option_index, str):
            if option_index.isdigit():
                option_index = int(option_index)
            else:
                raise ValueError(f"Invalid option_index '{option_index}'. Must be an integer.")

        async def callback(ws: WebSocket = None, state: dict = None, websocket: WebSocket = None, **kwargs):
            ws = websocket or ws
            json_response = []
            last_msg = state["messages"][-1]
            last_msg_content = getattr(last_msg, "content", str(last_msg))

            revealed_intel = []
            if isinstance(last_msg, HumanMessage) or getattr(last_msg, "type", "") == "human":
                st_index_str = ""
                content = last_msg_content
                st_face = None
                st_ev = None
                st_ed = None
            else:
                if last_msg_content.startswith("[") and "]" in last_msg_content:
                    st_index_str = last_msg_content.split("]", 1)[0].lstrip("[")
                    content = last_msg_content.split("]", 1)[1].lstrip()
                else:
                    st_index_str = ""
                    content = last_msg_content

                add_kwargs = getattr(last_msg, "additional_kwargs", {}) or {}
                st_ev = add_kwargs.get("emotion_values")
                st_ed = add_kwargs.get("emotion_delta")
                revealed_intel = add_kwargs.get("revealed_intel", [])
                st_face = EmotionFactory.derive_facial_expression(st_ev) if st_ev else "smile"

            msg_payload = {
                "message": content,
                "stakeholder_id": st_index_str,
                "emotion_values": st_ev,
                "emotion_delta": st_ed,
                "facial_expression": st_face,
            }
            if revealed_intel:
                msg_payload["revealed_intel"] = revealed_intel

            json_response.append(msg_payload)

            # Persist conversation message to GameSession
            try:
                with get_session() as db_session:
                    stmt = select(GameSession).where(
                        GameSession.user_name == username
                    ).order_by(GameSession.id.desc())
                    existing = db_session.scalars(stmt).first()
                    if existing:
                        current_msgs = list(existing.pitch_debate_messages or [])
                        for r in json_response:
                            msg_entry = {
                                "id": r.get("stakeholder_id", ""),
                                "message": r.get("message", ""),
                                "ac_id": -1,
                            }
                            if r.get("revealed_intel"):
                                msg_entry["revealed_intel"] = r.get("revealed_intel")
                            current_msgs.append(msg_entry)
                        existing.pitch_debate_messages = current_msgs
                        flag_modified(existing, "pitch_debate_messages")
            except Exception as db_err:
                print(f"[ChatHandler DB Callback Error] {db_err}")

            await manager.send_event(
                websocket=ws,
                event="chat:message_received",
                payload={
                    "progressionIndex": 2,
                    "type": "message",
                    "messages": json_response,
                    "facial_expressions": {st_index_str: st_face} if (st_index_str and st_face) else {},
                    "action_cards": [],
                    "streaming": False,
                },
            )

        # Fetch challenge and discovered intel items
        curr_challenge = PhaseFactory.translate_challenge_index(
            challenge_index=challenge_id,
            phase_index=phase_id,
        )
        if not curr_challenge:
            try:
                curr_challenge = PhaseFactory.get_challenge_by_id(challenge_id)
            except Exception:
                curr_challenge = None

        if not challenge_context and curr_challenge:
            challenge_context = f"{curr_challenge.name}: {curr_challenge.roundIntroduction} {curr_challenge.description}"

        intel_items = (
            get_discovered_intel_items(username=username, challenge=curr_challenge)
            if curr_challenge
            else []
        )

        # Fetch initial/saved emotion values from DB session
        initial_emotion_values = None
        with get_session() as db_session:
            stmt = select(GameSession).where(
                GameSession.user_name == username,
                GameSession.emotion_values.isnot(None)
            ).order_by(GameSession.id.desc())
            existing = db_session.scalars(stmt).first()
            if existing and isinstance(existing.emotion_values, dict) and existing.emotion_values:
                initial_emotion_values = {
                    st_id: EmotionValues(**ev) if isinstance(ev, dict) else ev
                    for st_id, ev in existing.emotion_values.items()
                }

        emotion_deltas, output_state = await get_response(
            challenge=challenge_context,
            _thread_id=session_id,
            phase_id=phase_id,
            challenge_id=challenge_id,
            option_index=option_index,
            initial_start=initial_start,
            initial_emotion_values=initial_emotion_values,
            intel_items=intel_items,
            ws=websocket,
            callback=callback,
        )

        # Persist user choice and updated emotion values to DB
        updated_emotion_values = output_state.get("emotion_values", {})
        serialized_emotion_values = {}
        if updated_emotion_values:
            serialized_emotion_values = {
                st_id: ev.model_dump() if hasattr(ev, "model_dump") else (ev.dict() if hasattr(ev, "dict") else ev)
                for st_id, ev in updated_emotion_values.items()
            }

        user_text = ""
        if not initial_start and output_state.get("last_selected_option"):
            user_text = output_state["last_selected_option"].text

        with get_session() as db_session:
            stmt = select(GameSession).where(
                GameSession.user_name == username
            ).order_by(GameSession.id.desc())
            existing = db_session.scalars(stmt).first()
            if existing:
                if user_text:
                    current_msgs = list(existing.pitch_debate_messages or [])
                    current_msgs.append({"id": "", "message": user_text, "ac_id": -1})
                    existing.pitch_debate_messages = current_msgs
                    flag_modified(existing, "pitch_debate_messages")
                if serialized_emotion_values:
                    existing.emotion_values = serialized_emotion_values
                    flag_modified(existing, "emotion_values")

        # If a wrongly categorized intel item was played, correct and mark it as verified in DB and update dossier
        last_intel = output_state.get("last_selected_intel")
        if last_intel and not last_intel.is_correct_intel():
            from mlops_serious_game.application.intel_dossier import (
                correct_and_verify_intel_item,
                retrieve_dossier_data,
            )
            correct_and_verify_intel_item(
                username=username,
                requirement_id=last_intel.requirement_id,
                curr_challenge=curr_challenge,
            )
            dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
            await manager.send_event(
                websocket=websocket,
                event="intel:dossier_data",
                payload={"dossier": dossier_data},
            )

        # Serialize dialogue options for the next turn
        raw_options = output_state.get("dialogue_options", [])
        dialogue_options = [
            opt.model_dump() if hasattr(opt, "model_dump") else opt
            for opt in raw_options
        ]

        serialized_deltas = {
            st_id: ed.model_dump() if hasattr(ed, "model_dump") else (ed.dict() if hasattr(ed, "dict") else ed)
            for st_id, ed in (emotion_deltas or {}).items()
        }

        facial_expressions = EmotionFactory.get_facial_expressions_dict(updated_emotion_values)

        await manager.send_event(
            websocket=websocket,
            event="chat:graph_completed",
            payload={
                "progressionIndex": 2,
                "type": "graph_completed",
                "dialogue_options": dialogue_options,
                "facial_expressions": facial_expressions,
                "emotion_values": serialized_emotion_values,
                "emotion_deltas": serialized_deltas,
                "error": False,
                "errorMsg": None,
            },
        )
    except Exception as e:
        print(f"[handle_chat_message Error] {e}")
        await manager.send_event(
            websocket=websocket,
            event="chat:graph_completed",
            payload={
                "progressionIndex": 2,
                "type": "graph_completed",
                "dialogue_options": [],
                "facial_expressions": {},
                "emotion_values": {},
                "emotion_deltas": {},
                "error": True,
                "errorMsg": str(e),
            },
        )
        await manager.send_event(
            websocket=websocket,
            event="system:error",
            payload={"error": str(e), "message": str(e)},
        )
