import re
from typing import Any
from fastapi import WebSocket
from opik.integrations.langchain import OpikTracer
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from langchain_core.messages import AIMessage, HumanMessage
from mlops_serious_game.application.pitch_debate_service import (
    EmotionValues,
    get_response,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.requirement import StakeholderIntelItem
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.infrastructure.database import GameChallenge, GameSession, IntelItem, get_session
from mlops_serious_game.application.intel_handler import (
    correct_and_verify_intel_item,
    correct_and_verify_convincer_archetype,
    retrieve_dossier_data,
)
from mlops_serious_game.infrastructure.websocket.handlers.game_handler import (
    get_discovered_intel_items,
    get_or_create_game_session,
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

        option_id = payload.get("option_id")
        dialogue_option = payload.get("dialogue_option")
        addressed_stakeholder_id = payload.get("addressed_stakeholder_id")
        initial_start = payload.get("initial_start", False)

        action_card_payload = payload.get("action_card")

        if not option_id and not initial_start:
            raise ValueError(
                "Missing 'option_id' in payload. Dialogue options must be selected by ID."
            )

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

            # Persist conversation message to GameChallenge
            try:
                with get_session() as db_session:
                    stmt = select(GameChallenge).where(
                        GameChallenge.user_name == username
                    ).order_by(GameChallenge.id.desc())
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
                    "emotional_states": {st_index_str: EmotionFactory.derive_emotional_state(st_ev)} if (st_index_str and st_ev) else {},
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
            challenge_context = (
                f"{curr_challenge.name}: {curr_challenge.roundIntroduction} "
                f"{personalize(curr_challenge.description, resolve_markers=True)}"
            )

        intel_items = (
            get_discovered_intel_items(username=username, challenge=curr_challenge)
            if curr_challenge
            else []
        )

        initial_emotion_values = None
        if initial_start:
            with get_session() as db_session:
                stmt = select(GameChallenge).where(
                    GameChallenge.user_name == username,
                    GameChallenge.emotion_values.isnot(None)
                ).order_by(GameChallenge.id.desc())
                existing = db_session.scalars(stmt).first()
                if existing and isinstance(existing.emotion_values, dict) and existing.emotion_values:
                    initial_emotion_values = {
                        st_id: EmotionValues(**ev)
                        for st_id, ev in existing.emotion_values.items()
                    }
                else:
                    initial_emotion_values = {
                        st.id: EmotionFactory.create_default_emotion_values()
                        for st in StakeholderFactory.stakeholders
                    }

        action_card = action_card_payload if (isinstance(action_card_payload, dict) and action_card_payload.get("title")) else None
        if not action_card:
            with get_session() as db_session:
                stmt_ac = select(GameChallenge).where(
                    GameChallenge.user_name == username,
                    GameChallenge.phase_index == phase_id,
                    GameChallenge.challenge_index == challenge_id
                ).order_by(GameChallenge.id.desc())
                existing_challenge = db_session.scalars(stmt_ac).first()
                if not existing_challenge:
                    stmt_fallback = select(GameChallenge).where(
                        GameChallenge.user_name == username
                    ).order_by(GameChallenge.id.desc())
                    existing_challenge = db_session.scalars(stmt_fallback).first()
                if existing_challenge and isinstance(existing_challenge.action_card, dict) and existing_challenge.action_card.get("title"):
                    action_card = dict(existing_challenge.action_card)

        # Complement intel_items to ensure all intel items in action card are present
        if action_card and isinstance(action_card, dict):
            card_intel_ids = action_card.get("intel_ids", [])
            existing_ids = {getattr(it, "id", None) for it in intel_items}
            with get_session() as db_session:
                records = db_session.scalars(
                    select(IntelItem).where(IntelItem.user_name == username)
                ).all()
                for record in records:
                    if isinstance(record.intel_item_data, dict):
                        data = record.intel_item_data
                        iid = data.get("id")
                        if iid and (iid in card_intel_ids or iid not in existing_ids):
                            req = RequirementFactory.get_requirement(iid)
                            if req:
                                item = StakeholderIntelItem.from_requirement(
                                    req,
                                    intel_type=data.get("intel_type", "unconfirmed"),
                                    categorized_type=data.get("categorized_type", req.type),
                                    categorized_description=data.get("categorized_description", ""),
                                    description=data.get("description", req.description),
                                )
                                if iid not in existing_ids:
                                    intel_items.append(item)
                                    existing_ids.add(iid)

            wrong_intel_ids = list(action_card.get("wrong_intel_ids", []))
            for it in intel_items:
                it_id = getattr(it, "id", None)
                if it_id in card_intel_ids and not it.is_correct_intel():
                    if it_id and it_id not in wrong_intel_ids:
                        wrong_intel_ids.append(it_id)
            action_card["wrong_intel_ids"] = wrong_intel_ids

        # Run pitch debate graph
        emotion_deltas, output_state = await get_response(
            challenge=challenge_context,
            _thread_id=session_id,
            phase_id=phase_id,
            challenge_id=challenge_id,
            option_id=option_id,
            dialogue_option=dialogue_option,
            addressed_stakeholder_id=addressed_stakeholder_id,
            initial_start=initial_start,
            initial_emotion_values=initial_emotion_values,
            intel_items=intel_items,
            action_card=action_card,
            ws=websocket,
            callback=callback,
        )

        # Extract updated emotion values
        updated_emotion_values = output_state.get("emotion_values", {})
        serialized_emotion_values = {}
        if updated_emotion_values:
            serialized_emotion_values = {
                st_id: ev.model_dump() if hasattr(ev, "model_dump") else (ev.dict() if hasattr(ev, "dict") else ev)
                for st_id, ev in updated_emotion_values.items()
            }

        if serialized_emotion_values:
            with get_session() as db_session:
                stmt = select(GameChallenge).where(
                    GameChallenge.user_name == username
                ).order_by(GameChallenge.id.desc())
                existing = db_session.scalars(stmt).first()
                if existing:
                    existing.emotion_values = serialized_emotion_values
                    flag_modified(existing, "emotion_values")

        # Dossier updates:
        # 1. Any wrongly categorized intel items refuted in debate are corrected and marked Verified
        # 2. Correctly categorized intel items in pitched action card that were not refuted are confirmed as Verified
        dossier_updated = False
        corrected_req_ids = set()
        last_intel = output_state.get("last_selected_intel")
        if last_intel and not last_intel.is_correct_intel():
            corrected_req_ids.add(last_intel.id)

        for m in output_state.get("messages", []):
            add_kw = getattr(m, "additional_kwargs", {}) or {}
            for rev in add_kw.get("revealed_intel", []):
                if rev.get("is_corrected") and rev.get("id"):
                    corrected_req_ids.add(rev.get("id"))

        if corrected_req_ids:
            for req_id in corrected_req_ids:
                correct_and_verify_intel_item(
                    username=username,
                    requirement_id=req_id,
                    curr_challenge=curr_challenge,
                )
            dossier_updated = True

        if initial_start and action_card and isinstance(action_card, dict):
            card_intel_ids = action_card.get("intel_ids", [])
            wrong_card_set = set(action_card.get("wrong_intel_ids", []))
            for cid in card_intel_ids:
                if cid not in wrong_card_set and cid not in corrected_req_ids:
                    matching_item = next((it for it in intel_items if getattr(it, "id", None) == cid), None)
                    if matching_item and matching_item.is_correct_intel():
                        item_conf = matching_item.intel_type.value if hasattr(matching_item.intel_type, "value") else str(matching_item.intel_type)
                        if item_conf.lower() != "verified":
                            correct_and_verify_intel_item(
                                username=username,
                                requirement_id=cid,
                                curr_challenge=curr_challenge,
                            )
                            dossier_updated = True

        if dossier_updated:
            dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
            await manager.send_event(
                websocket=websocket,
                event="intel:dossier_data",
                payload={"dossier": dossier_data},
            )

        # Check if a Corporate Noise option was played and validate/refute convincer archetype
        convincer_verification = None
        last_option = output_state.get("last_selected_option")
        opt_arch = last_option.archetype if last_option else None
        opt_arch_name = opt_arch.name if opt_arch else ""
        opt_arch_strategy = opt_arch.strategy if opt_arch else ""

        convincer_verifications: list[dict] = []
        if opt_arch_name and not last_intel:
            # Determine candidate stakeholders involved in this exchange
            # Includes stakeholders who spoke in this turn (both 1st and 2nd routed) and the prior speaker
            candidate_ids = []
            for m in output_state.get("messages", []):
                if isinstance(m, AIMessage) or getattr(m, "type", "") == "ai":
                    content = getattr(m, "content", str(m))
                    match = re.match(r"^\[(.*?)\]", content)
                    if match:
                        st_id = match.group(1).strip()
                        if st_id not in candidate_ids:
                            candidate_ids.append(st_id)

            with get_session() as db_session:
                stmt = select(GameChallenge).where(
                    GameChallenge.user_name == username
                ).order_by(GameChallenge.id.desc())
                existing_rec = db_session.scalars(stmt).first()
                if existing_rec and existing_rec.pitch_debate_messages:
                    for msg_item in reversed(existing_rec.pitch_debate_messages):
                        msg_id = msg_item.get("id")
                        if msg_id and msg_id not in candidate_ids:
                            candidate_ids.append(msg_id)

            if not candidate_ids:
                candidate_ids = StakeholderFactory.get_active_stakeholders(phase_id) or StakeholderFactory.get_available_stakeholders()

            with get_session() as db_session:
                sess_rec = get_or_create_game_session(username, db_session)
                archs = dict(sess_rec.stakeholder_archetypes or {})

                for s_id in candidate_ids:
                    st_entry = archs.get(s_id, {})
                    cat_arch = st_entry.get("categorized_archetype")
                    st_obj = StakeholderFactory.get_stakeholder(s_id)
                    st_name = st_obj.name if st_obj else s_id
                    real_arch = st_entry.get("real_archetype") or (getattr(st_obj, "convincer_archetype", "") if st_obj else "")

                    if cat_arch and cat_arch.lower().strip() == opt_arch_name.lower().strip():
                        if cat_arch.lower().strip() == real_arch.lower().strip():
                            # Validated!
                            verif = {
                                "was_correct": True,
                                "stakeholder_id": s_id,
                                "stakeholder_name": st_name,
                                "categorized_archetype": cat_arch,
                                "true_archetype": real_arch,
                                "strategy": opt_arch_strategy,
                            }
                            convincer_verifications.append(verif)
                        else:
                            # Misattributed! Correct and mark validated
                            corr_res = correct_and_verify_convincer_archetype(username, s_id)
                            true_arch_cfg = EmotionFactory.get_archetype_by_name(real_arch)
                            verif = {
                                "was_correct": False,
                                "stakeholder_id": s_id,
                                "stakeholder_name": st_name,
                                "old_archetype": cat_arch,
                                "true_archetype": real_arch,
                                "strategy": true_arch_cfg.strategy if true_arch_cfg else "",
                                "explanation": f"{st_name}'s actual convincer archetype is '{real_arch}', not '{cat_arch}'. The archetype has been corrected in your dossier.",
                            }
                            convincer_verifications.append(verif)

        if any(not v.get("was_correct") for v in convincer_verifications):
            dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
            await manager.send_event(
                websocket=websocket,
                event="intel:dossier_data",
                payload={"dossier": dossier_data},
            )

        # Serialize dialogue options for the next turn (excluding prompt text)
        raw_options = output_state.get("dialogue_options", [])
        dialogue_options = [
            opt.model_dump(exclude={"text"}, exclude_none=True) if hasattr(opt, "model_dump") else opt
            for opt in raw_options
        ]

        serialized_deltas = {
            st_id: ed.model_dump() if hasattr(ed, "model_dump") else (ed.dict() if hasattr(ed, "dict") else ed)
            for st_id, ed in (emotion_deltas or {}).items()
        }

        facial_expressions = EmotionFactory.get_facial_expressions_dict(updated_emotion_values)
        emotional_states = EmotionFactory.get_emotion_states_dict(updated_emotion_values)

        graph_completed_payload = {
            "progressionIndex": 2,
            "type": "graph_completed",
            "dialogue_options": dialogue_options,
            "facial_expressions": facial_expressions,
            "emotional_states": emotional_states,
            "emotion_values": serialized_emotion_values,
            "emotion_deltas": serialized_deltas,
            "convincer_archetypes": EmotionFactory.get_convincer_archetypes_dict(),
            "error": False,
            "errorMsg": None,
        }
        if convincer_verifications:
            graph_completed_payload["convincer_verifications"] = convincer_verifications
            graph_completed_payload["convincer_verification"] = convincer_verifications[0]

        await manager.send_event(
            websocket=websocket,
            event="chat:graph_completed",
            payload=graph_completed_payload,
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
