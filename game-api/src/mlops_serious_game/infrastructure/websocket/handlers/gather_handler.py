"""Websocket handlers for Gather (Section 3, plan 01-intel-and-pitch-redesign).

`gather:open` starts one conversation per target (or whole room for Team Sync-Up).
`gather:ask` resolves one turn with dynamic component queries, priority queries, generic queries, or component investigation.
`gather:close` ends a conversation early; unused turns are lost.
Every rule lives in `pitch_debate_service.gather` (pure); this module gathers context,
calls in, writes revealed items as Verified, emits stakeholder chat messages, and updates the dossier.
"""

from typing import Any, Optional

from fastapi import WebSocket
from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.application.component_investigation_service import (
    conduct_component_investigation_turn,
    resolve_component_owner,
)
from mlops_serious_game.application.intel_handler import (
    load_known_intel_items,
    retrieve_dossier_data,
    store_intel_item,
)
from mlops_serious_game.application.pitch_debate_service import gather
from mlops_serious_game.application.pitch_debate_service import gather_store
from mlops_serious_game.application.pitch_debate_service.chains import (
    generate_component_fact,
    generate_player_utterance,
    generate_stakeholder_response,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import (
    ConfidenceType,
    FactAssertion,
    IntelSource,
    IntelTag,
    StakeholderIntelItem,
)
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.database import GameChallenge, get_session, get_user_id
from mlops_serious_game.infrastructure.websocket.handlers.log_handler import send_events
from mlops_serious_game.infrastructure.websocket.manager import manager


def _challenge_and_room(phase_id: int, challenge_id: int):
    challenge = PhaseFactory.translate_challenge_index(challenge_index=challenge_id, phase_index=phase_id)
    if not challenge:
        phases = PhaseFactory.get_phases()
        challenge = phases[0].challenges[0]
    room_ids = [ps.stakeholder_id for ps in PhaseFactory.get_phases()[challenge.phase_id].stakeholders]
    return challenge, room_ids


def _stakeholder_obj(st_id: str):
    if not st_id or st_id in ("system", "System", "__environment__", "all"):
        return None
    try:
        return StakeholderFactory.get_stakeholder(st_id)
    except Exception:
        return None


def _stakeholder_name(st_id: str) -> str:
    if not st_id or st_id in ("system", "System", "__environment__"):
        return "System Telemetry"
    if st_id == "all":
        return "Whole Team"
    st = _stakeholder_obj(st_id)
    return st.name if st else st_id.replace(".", " ").replace("_", " ").title()


def _stakeholder_emotion_meta(st_id: str, emotion_values_map: dict) -> tuple[str, str, str, dict]:
    """Returns (emotion_str, emotional_state, facial_expression, ev_dict) for a stakeholder."""
    st_ev = emotion_values_map.get(st_id)
    emotion_str = "Neutral"
    emotional_state = "neutral"
    facial_expression = "neutral"
    ev_dict = {}
    if st_ev:
        try:
            derived = EmotionFactory.derive_emotional_state(st_ev)
            if derived:
                emotion_str = derived.capitalize()
                emotional_state = derived.lower()
                facial_expression = EmotionFactory.derive_facial_expression_for_state(derived)
            if hasattr(st_ev, "model_dump"):
                ev_dict = st_ev.model_dump()
            elif hasattr(st_ev, "dict"):
                ev_dict = st_ev.dict()
            elif isinstance(st_ev, dict):
                ev_dict = dict(st_ev)
        except Exception:
            pass
    return emotion_str, emotional_state, facial_expression, ev_dict


async def _held_items(username: str, phase_id: int) -> list[StakeholderIntelItem]:
    return load_known_intel_items(username, up_to_phase=phase_id)


def _options_payload(
    username: str,
    phase_id: int,
    challenge_id: int,
    conversation: gather.GatherConversation,
    card,
    held: list[StakeholderIntelItem],
) -> list[dict[str, Any]]:
    challenge, room_ids = _challenge_and_room(phase_id, challenge_id)
    graph = None
    try:
        graph = GraphFactory.get_graph()
    except Exception:
        pass

    room_pools = {
        st_id: RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, st_id)
        for st_id in room_ids
    }
    if card.id == "eng_3" or card.stakeholder_selection_amount == -1:
        pool = [item for p in room_pools.values() for item in p]
    elif card.id == "eng_5" or card.target_type == "component":
        pool = RequirementFactory.get_requirements_for_challenge(challenge.id)
    else:
        pool = room_pools.get(
            conversation.stakeholder_id,
            RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, conversation.stakeholder_id),
        )

    seed = f"{username}|{challenge.id}|{conversation.card_id}|{conversation.stakeholder_id}|{conversation.turns_used}"
    specs = gather.gather_options_for(
        conversation=conversation,
        held=held,
        pool=pool,
        allowed_types=card.allowed_requirement_types,
        seed=seed,
        room_pools=room_pools,
        graph=graph,
        phase_id=phase_id,
    )
    return [s.model_dump() for s in specs]


async def _send_conversation(
    websocket: WebSocket,
    username: str,
    phase_id: int,
    challenge_id: int,
    conversation: gather.GatherConversation,
    card,
    held: list[StakeholderIntelItem],
    **extra,
) -> None:
    if conversation.stakeholder_id == "all":
        st_name = "Whole Team"
    else:
        st_name = _stakeholder_name(conversation.stakeholder_id)

    payload = {
        "phase_id": phase_id,
        "challenge_id": challenge_id,
        "card_id": conversation.card_id,
        "conversation_id": conversation.conversation_id,
        "stakeholder_id": conversation.stakeholder_id,
        "stakeholder_name": st_name,
        "turns_left": conversation.turns_left,
        "turns_used": conversation.turns_used,
        "closed": conversation.closed,
        "options": _options_payload(username, phase_id, challenge_id, conversation, card, held),
    }
    payload.update(extra)
    await manager.send_event(websocket=websocket, event="gather:state", payload=payload)


def _target_room_ids(card, requested: list[str], room_ids: list[str]) -> list[str]:
    if card.stakeholder_selection_amount == -1:
        return room_ids
    return [st_id for st_id in requested if st_id in room_ids]


def _is_component_allowed_for_phase(comp_id: str, phase_id: int) -> bool:
    phase_prefixes = {
        0: {"req", "gov"},
        1: {"req", "gov"},
        2: {"data", "gov"},
        3: {"model", "gov"},
        4: {"deploy", "gov"},
        5: {"ops", "gov"},
    }
    allowed = phase_prefixes.get(phase_id, {"req", "gov"})
    prefix = comp_id.split(".")[0] if "." in comp_id else comp_id
    return prefix in allowed


async def handle_gather_open(websocket: WebSocket, username: str, payload: dict) -> None:
    """Plays a card: starts one conversation per target (or whole room for Team Sync-Up)."""
    phase_id, challenge_id = payload.get("phase_id", 0), payload.get("challenge_id", 0)
    card_id = payload.get("card_id")
    card = EngagementCardFactory.get_card(card_id)
    challenge, room_ids = _challenge_and_room(phase_id, challenge_id)

    target_comp_id = None
    if card.id == "eng_3" or card.stakeholder_selection_amount == -1:
        targets = ["all"]
    elif card.target_type == "component" or card.id == "eng_5":
        comp_id = (
            payload.get("component_id")
            or (payload.get("component_ids") or [None])[0]
            or (payload.get("stakeholder_ids") or [None])[0]
        )
        if comp_id and not _is_component_allowed_for_phase(comp_id, phase_id):
            await manager.send_event(
                websocket=websocket,
                event="system:error",
                payload={"message": "Component is not relevant to the current phase or governance and infrastructure."},
            )
            return

        graph = None
        try:
            graph = GraphFactory.get_graph()
        except Exception:
            pass
        if comp_id:
            owner_id = resolve_component_owner(comp_id, graph)
            targets = [owner_id]
            target_comp_id = comp_id
        else:
            targets = []
    else:
        targets = _target_room_ids(card, payload.get("stakeholder_ids", []), room_ids)

    if not targets:
        await manager.send_event(
            websocket=websocket,
            event="system:error",
            payload={"message": "None of those targets are valid for this engagement card."},
        )
        return

    existing_messages = []
    with get_session() as db:
        row = db.scalars(
            select(GameChallenge)
            .where(
                GameChallenge.user_id == get_user_id(db, username),
                GameChallenge.phase_index == phase_id,
                GameChallenge.challenge_index == challenge_id,
            )
            .order_by(GameChallenge.id.desc())
        ).first()
        if row is not None:
            existing_messages = list(row.messages or [])
            current_ac = dict(row.action_card or {})
            played = list(current_ac.get("played_engagement_card_ids", []))
            if card_id not in played:
                played.append(card_id)
            current_ac["played_engagement_card_ids"] = played
            card_targets = dict(current_ac.get("engagement_card_targets", {}))
            existing_targets = list(card_targets.get(card_id, []))
            target_record = room_ids if card.stakeholder_selection_amount == -1 else targets
            for t in target_record:
                if t not in existing_targets:
                    existing_targets.append(t)
            card_targets[card_id] = existing_targets
            current_ac["engagement_card_targets"] = card_targets
            row.action_card = current_ac
            flag_modified(row, "action_card")
            db.commit()

    prefix = f"eng_{card_id}_"
    matching_conv_ids = {
        m.get("conversation_id")
        for m in existing_messages
        if isinstance(m, dict) and str(m.get("conversation_id", "")).startswith(prefix)
    }
    play_index = len(matching_conv_ids) + 1
    conversation_id = f"{prefix}{play_index}"

    held = await _held_items(username, phase_id)
    events: list[GameEvent] = []
    conversations = []
    for target in targets:
        conversation = gather.GatherConversation(
            conversation_id=conversation_id,
            card_id=card_id,
            stakeholder_id=target,
            component_id=target_comp_id,
            turns_left=card.turns,
        )
        gather_store.save_conversation(username, phase_id, challenge_id, conversation)
        conversations.append(conversation)
        display_name = "Whole Team" if target == "all" else _stakeholder_name(target)
        events.append(GameEvent(
            step="gather",
            kind="tokens",
            subject_id=target,
            direction="down",
            magnitude="clear",
            cause="tokens.spent",
            params={"card": card.title, "st": display_name},
        ))

    await send_events(websocket, username, [e.stamped(phase_id=phase_id, challenge_id=challenge_id) for e in events])
    for conversation in conversations:
        await _send_conversation(websocket, username, phase_id, challenge_id, conversation, card, held)


async def handle_gather_ask(websocket: WebSocket, username: str, payload: dict) -> None:
    """Resolves one turn: one option, one target, one outcome."""
    phase_id, challenge_id = payload.get("phase_id", 0), payload.get("challenge_id", 0)
    card_id, stakeholder_id = payload.get("card_id"), payload.get("stakeholder_id")
    option = payload.get("option", "")
    card = EngagementCardFactory.get_card(card_id)
    challenge, room_ids = _challenge_and_room(phase_id, challenge_id)

    conversation = gather_store.load_conversation(username, phase_id, challenge_id, card_id, stakeholder_id)
    if conversation is None and (card_id == "eng_3" or card.stakeholder_selection_amount == -1):
        conversation = gather_store.load_conversation(username, phase_id, challenge_id, card_id, "all")
    if conversation is None or not conversation.is_open:
        await manager.send_event(
            websocket=websocket, event="system:error",
            payload={"message": "that conversation is not open"},
        )
        return

    held = await _held_items(username, phase_id)
    known_ids = {i.id for i in held} | set(conversation.discovered_item_ids)
    seed = f"{username}|{challenge.id}|{card_id}|{conversation.stakeholder_id}|{conversation.turns_used}"
    graph = None
    try:
        graph = GraphFactory.get_graph()
    except Exception:
        pass

    allowed = _options_payload(username, phase_id, challenge_id, conversation, card, held)
    req_comp = payload.get("component_id")
    matching = next(
        (
            o for o in allowed
            if o["option"] == option and o["available"]
            and (not req_comp or o.get("component_id") == req_comp)
        ),
        None,
    )
    if matching is None:
        await _send_conversation(
            websocket, username, phase_id, challenge_id, conversation, card, held,
            error="that option is not available here",
        )
        return

    chosen_component = payload.get("component_id") or matching.get("component_id")
    chosen_prompt = matching.get("prompt", "")

    # Load recent conversation history and emotion values
    recent_msgs: list[dict[str, Any]] = []
    emotion_values_map: dict[str, Any] = {}
    try:
        with get_session() as db:
            row = db.scalars(
                select(GameChallenge)
                .where(
                    GameChallenge.user_id == get_user_id(db, username),
                    GameChallenge.phase_index == phase_id,
                    GameChallenge.challenge_index == challenge_id,
                )
                .order_by(GameChallenge.id.desc())
            ).first()
            if row:
                recent_msgs = list(row.messages or [])
                emotion_values_map = dict(row.emotion_values or {})
    except Exception as e:
        logger.warning(f"[gather_handler] Error loading recent messages/emotions: {e}")

    history_lines = []
    for m in recent_msgs[-6:]:
        mid = m.get("id", "")
        m_name = "Project Manager" if mid == "user" else _stakeholder_name(mid)
        history_lines.append(f"{m_name}: {m.get('message', '')}")
    history_str = "\n".join(history_lines)
    latest_statement = history_lines[-1] if history_lines else ""

    # Resolve target information
    if conversation.stakeholder_id == "all":
        target_st_name = "Whole Team"
        target_st_role = "Project Stakeholders"
    else:
        st_obj = _stakeholder_obj(conversation.stakeholder_id)
        target_st_name = st_obj.name if st_obj else conversation.stakeholder_id.replace("_", " ").title()
        target_st_role = st_obj.role_description if st_obj else ""

    comp_display = gather.component_display_name(chosen_component, graph) if chosen_component else ""
    challenge_context = f"{challenge.name}: {challenge.description}"

    # Determine turn progress for context-aware dialogue
    is_first_turn = conversation.turns_used == 0
    is_last_turn = conversation.turns_left == 1

    # Generate player utterance via LLM for standard queries (investigate_component handled by service)
    player_spoken_message = ""
    if option != "investigate_component" and card_id != "eng_5":
        player_spoken_message = await generate_player_utterance(
            challenge=challenge_context,
            target_stakeholder_name=target_st_name,
            target_stakeholder_role=target_st_role,
            dialogue_option_label=matching.get("label", ""),
            dialogue_option_prompt=chosen_prompt,
            component_name=comp_display,
            history=history_str,
            latest_statement=latest_statement,
            default_prompt=chosen_prompt,
            card_title=card.title,
            card_description=card.description,
            is_first_turn=is_first_turn,
            is_last_turn=is_last_turn,
        )
        if player_spoken_message:
            await manager.send_event(
                websocket=websocket,
                event="intel:message_received",
                payload={
                    "type": "player_message",
                    "message": player_spoken_message,
                    "conversation_id": conversation.conversation_id,
                },
            )

    st_name = target_st_name
    revealed_db_entries = []

    # Resolve pure outcome
    if card_id == "eng_3":
        room_pools = {
            s_id: RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, s_id)
            for s_id in room_ids
        }
        names_by_st = {s_id: _stakeholder_name(s_id) for s_id in room_ids}
        outcome = gather.resolve_team_sync_up(
            conversation=conversation,
            room_pools=room_pools,
            known_ids=known_ids,
            component_id=chosen_component,
            seed=seed,
            names_by_stakeholder=names_by_st,
            graph=graph,
        )
    elif option == "component_query":
        pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, conversation.stakeholder_id)
        outcome = gather.resolve_component_query(
            conversation=conversation,
            pool=pool,
            known_ids=known_ids,
            component_id=chosen_component,
            seed=seed,
            stakeholder_name=st_name,
            graph=graph,
        )
    elif option == "priority_query":
        pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, conversation.stakeholder_id)
        outcome = gather.resolve_priority_query(
            conversation=conversation,
            pool=pool,
            known_ids=known_ids,
            seed=seed,
            stakeholder_name=st_name,
        )
    elif option == "generic_query":
        pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, conversation.stakeholder_id)
        outcome = gather.resolve_generic_query(
            conversation=conversation,
            pool=pool,
            known_ids=known_ids,
            seed=seed,
            stakeholder_name=st_name,
        )
    elif option == "investigate_component" or card_id == "eng_5":
        comp_id = chosen_component or conversation.component_id or conversation.stakeholder_id
        investigation_result = await conduct_component_investigation_turn(
            websocket=websocket,
            username=username,
            challenge=challenge,
            conversation=conversation,
            component_id=comp_id,
            history_str=history_str,
            emotion_values_map=emotion_values_map,
            graph=graph,
            known_ids=known_ids,
            chosen_prompt=chosen_prompt,
        )
        outcome = investigation_result.outcome
        revealed_db_entries.extend(investigation_result.revealed_db_entries)
    else:
        await _send_conversation(
            websocket, username, phase_id, challenge_id, conversation, card, held,
            error="unknown option",
        )
        return

    # Persist updated conversation
    gather_store.save_conversation(username, phase_id, challenge_id, outcome.conversation)

    # The investigate_component service already emitted all messages and stored intel items;
    # skip the emit block to avoid duplicates and preserve the entries it returned.
    if option != "investigate_component" and card_id != "eng_5":
        # If revealed items, persist as Verified and emit stakeholder/telemetry responses
        revealed_db_entries = []

        held_by_id = {i.id: i for i in held}

    if card_id == "eng_3":
        # Team Sync-Up: All stakeholders in the room respond to the inquiry about chosen_component
        current_known_ids = set(known_ids)
        for s_id in sorted(room_ids):
            s_pool = room_pools.get(s_id, [])
            s_name = _stakeholder_name(s_id)
            s_obj = _stakeholder_obj(s_id)

            matching = [r for r in s_pool if gather.component_for_item(r, graph) == chosen_component]
            matching_undisc = [r for r in matching if r.id not in current_known_ids and r.id not in conversation.discovered_item_ids]
            matching_disc = [r for r in matching if r.id in current_known_ids or r.id in conversation.discovered_item_ids]

            emotion_str, emotional_state, facial_expression, ev_dict = _stakeholder_emotion_meta(
                s_id, emotion_values_map
            )

            if matching_undisc:
                ordered = gather._stable_order(f"{seed}|sync|{s_id}|{chosen_component}", matching_undisc)
                revealed_dicts = []
                descriptions = []
                tags = []
                for req in ordered:
                    current_known_ids.add(req.id)
                    held_item = held_by_id.get(req.id)
                    was_unverified = held_item and getattr(held_item, "intel_type", None) != ConfidenceType.VERIFIED
                    intel_item = StakeholderIntelItem.from_requirement(
                        req,
                        intel_type=ConfidenceType.VERIFIED,
                        categorized_type=req.type,
                        description=req.description,
                        source=IntelSource.INTERVIEW,
                    )
                    await store_intel_item(challenge, websocket, intel_item)
                    held_by_id[req.id] = intel_item

                    tag_str = (
                        req.type.value if hasattr(req.type, "value") else str(req.type)
                    ).replace("_", " ").title()
                    descriptions.append(req.description)
                    tags.append(tag_str)

                    item_dict = intel_item.model_dump(mode="json")
                    item_dict["stakeholder_name"] = s_name
                    if was_unverified:
                        item_dict["is_verified"] = True
                    revealed_dicts.append(item_dict)

                combined_desc = " ".join(descriptions)
                combined_tag = ", ".join(tags)
                spoken_response = await generate_stakeholder_response(
                    stakeholder_name=s_name,
                    stakeholder_role=s_obj.role_description if s_obj else "",
                    challenge=challenge_context,
                    responsibilities=s_obj.responsibilities if s_obj else "",
                    priorities=s_obj.priorities if s_obj else "",
                    emotion=emotion_str,
                    option_type=option,
                    component_name=comp_display,
                    revealed_intel_description=combined_desc,
                    revealed_intel_tag=combined_tag,
                    is_revealed=True,
                    history=history_str,
                    player_utterance=player_spoken_message,
                    default_response=combined_desc,
                )

                msg_payload = {
                    "type": "stakeholder_message",
                    "stakeholder_id": s_id,
                    "stakeholder_name": s_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "revealed_intel_items": revealed_dicts,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                }
                await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
                revealed_db_entries.append({
                    "id": s_id,
                    "stakeholder_id": s_id,
                    "stakeholder_name": s_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "ac_id": -1,
                    "revealed_intel": revealed_dicts,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                })
            elif matching_disc:
                req = matching_disc[0]
                tag_str = (
                    req.type.value if hasattr(req.type, "value") else str(req.type)
                ).replace("_", " ").title()

                spoken_response = await generate_stakeholder_response(
                    stakeholder_name=s_name,
                    stakeholder_role=s_obj.role_description if s_obj else "",
                    challenge=challenge_context,
                    responsibilities=s_obj.responsibilities if s_obj else "",
                    priorities=s_obj.priorities if s_obj else "",
                    emotion=emotion_str,
                    option_type=option,
                    component_name=comp_display,
                    revealed_intel_description=req.description,
                    revealed_intel_tag=tag_str,
                    is_revealed=True,
                    history=history_str,
                    player_utterance=player_spoken_message,
                    default_response=req.description,
                )

                held_item = held_by_id.get(req.id)
                newly_verified_items = []
                if held_item and getattr(held_item, "intel_type", None) != ConfidenceType.VERIFIED:
                    verified_item = StakeholderIntelItem.from_requirement(
                        req,
                        intel_type=ConfidenceType.VERIFIED,
                        categorized_type=req.type,
                        description=req.description,
                        source=IntelSource.INTERVIEW,
                    )
                    await store_intel_item(challenge, websocket, verified_item)
                    held_by_id[req.id] = verified_item
                    item_dict = verified_item.model_dump(mode="json")
                    item_dict["is_verified"] = True
                    item_dict["stakeholder_name"] = s_name
                    newly_verified_items.append(item_dict)

                msg_payload = {
                    "type": "stakeholder_message",
                    "stakeholder_id": s_id,
                    "stakeholder_name": s_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "revealed_intel_items": newly_verified_items,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                }
                await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
                revealed_db_entries.append({
                    "id": s_id,
                    "stakeholder_id": s_id,
                    "stakeholder_name": s_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "ac_id": -1,
                    "revealed_intel": newly_verified_items,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                })
            else:
                default_msg = f"I don't have any specific requirements or concerns regarding {comp_display} from my end."
                spoken_response = await generate_stakeholder_response(
                    stakeholder_name=s_name,
                    stakeholder_role=s_obj.role_description if s_obj else "",
                    challenge=challenge_context,
                    responsibilities=s_obj.responsibilities if s_obj else "",
                    priorities=s_obj.priorities if s_obj else "",
                    emotion=emotion_str,
                    option_type=option,
                    component_name=comp_display,
                    revealed_intel_description="",
                    revealed_intel_tag="",
                    is_revealed=False,
                    history=history_str,
                    player_utterance=player_spoken_message,
                    default_response=default_msg,
                )

                msg_payload = {
                    "type": "stakeholder_message",
                    "stakeholder_id": s_id,
                    "stakeholder_name": s_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "revealed_intel_items": [],
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                }
                await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
                revealed_db_entries.append({
                    "id": s_id,
                    "stakeholder_id": s_id,
                    "stakeholder_name": s_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "ac_id": -1,
                    "revealed_intel": [],
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                })

    elif option == "component_query":
        # Single stakeholder component inquiry (e.g. eng_1, eng_2)
        speaker_id = conversation.stakeholder_id
        speaker_st = _stakeholder_obj(speaker_id)
        speaker_name = speaker_st.name if speaker_st else _stakeholder_name(speaker_id)

        emotion_str, emotional_state, facial_expression, ev_dict = _stakeholder_emotion_meta(
            speaker_id, emotion_values_map
        )

        revealed_item_ids = outcome.item_ids if outcome.item_ids else ([outcome.item_id] if outcome.item_id else [])
        if outcome.result == "revealed" and revealed_item_ids:
            revealed_dicts = []
            descriptions = []
            tags = []
            for item_id in revealed_item_ids:
                req = RequirementFactory.get_requirement(item_id)
                if req:
                    held_item = held_by_id.get(req.id)
                    was_unverified = held_item and getattr(held_item, "intel_type", None) != ConfidenceType.VERIFIED
                    intel_item = StakeholderIntelItem.from_requirement(
                        req,
                        intel_type=ConfidenceType.VERIFIED,
                        categorized_type=req.type,
                        description=req.description,
                        source=IntelSource.INTERVIEW,
                    )
                    await store_intel_item(challenge, websocket, intel_item)
                    held_by_id[req.id] = intel_item
                    tag_str = (
                        req.type.value if hasattr(req.type, "value") else str(req.type)
                    ).replace("_", " ").title()
                    descriptions.append(req.description)
                    tags.append(tag_str)

                    item_dict = intel_item.model_dump(mode="json")
                    item_dict["stakeholder_name"] = speaker_name
                    if was_unverified:
                        item_dict["is_verified"] = True
                    revealed_dicts.append(item_dict)

            if revealed_dicts:
                combined_desc = " ".join(descriptions)
                combined_tag = ", ".join(tags)
                spoken_response = await generate_stakeholder_response(
                    stakeholder_name=speaker_name,
                    stakeholder_role=speaker_st.role_description if speaker_st else "",
                    challenge=challenge_context,
                    responsibilities=speaker_st.responsibilities if speaker_st else "",
                    priorities=speaker_st.priorities if speaker_st else "",
                    emotion=emotion_str,
                    option_type=option,
                    component_name=comp_display,
                    revealed_intel_description=combined_desc,
                    revealed_intel_tag=combined_tag,
                    is_revealed=True,
                    history=history_str,
                    player_utterance=player_spoken_message,
                    default_response=combined_desc,
                )

                msg_payload = {
                    "type": "stakeholder_message",
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "revealed_intel_items": revealed_dicts,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                }
                await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
                revealed_db_entries.append({
                    "id": speaker_id,
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "ac_id": -1,
                    "revealed_intel": revealed_dicts,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                })
        else:
            # Check if stakeholder has already discovered items on this component
            st_pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge.id, speaker_id)
            matching_disc = [
                r for r in st_pool
                if gather.component_for_item(r, graph) == chosen_component
                and (r.id in known_ids or r.id in conversation.discovered_item_ids)
            ]
            if matching_disc:
                req = matching_disc[0]
                tag_str = (
                    req.type.value if hasattr(req.type, "value") else str(req.type)
                ).replace("_", " ").title()

                spoken_response = await generate_stakeholder_response(
                    stakeholder_name=speaker_name,
                    stakeholder_role=speaker_st.role_description if speaker_st else "",
                    challenge=challenge_context,
                    responsibilities=speaker_st.responsibilities if speaker_st else "",
                    priorities=speaker_st.priorities if speaker_st else "",
                    emotion=emotion_str,
                    option_type=option,
                    component_name=comp_display,
                    revealed_intel_description=req.description,
                    revealed_intel_tag=tag_str,
                    is_revealed=True,
                    history=history_str,
                    player_utterance=player_spoken_message,
                    default_response=req.description,
                )

                held_item = held_by_id.get(req.id)
                newly_verified_items = []
                if held_item and getattr(held_item, "intel_type", None) != ConfidenceType.VERIFIED:
                    verified_item = StakeholderIntelItem.from_requirement(
                        req,
                        intel_type=ConfidenceType.VERIFIED,
                        categorized_type=req.type,
                        description=req.description,
                        source=IntelSource.INTERVIEW,
                    )
                    await store_intel_item(challenge, websocket, verified_item)
                    held_by_id[req.id] = verified_item
                    item_dict = verified_item.model_dump(mode="json")
                    item_dict["is_verified"] = True
                    item_dict["stakeholder_name"] = speaker_name
                    newly_verified_items.append(item_dict)

                msg_payload = {
                    "type": "stakeholder_message",
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "revealed_intel_items": newly_verified_items,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                }
                await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
                revealed_db_entries.append({
                    "id": speaker_id,
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "ac_id": -1,
                    "revealed_intel": newly_verified_items,
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                })
            else:
                default_msg = f"I don't have any specific requirements or concerns regarding {comp_display} at this time."
                spoken_response = await generate_stakeholder_response(
                    stakeholder_name=speaker_name,
                    stakeholder_role=speaker_st.role_description if speaker_st else "",
                    challenge=challenge_context,
                    responsibilities=speaker_st.responsibilities if speaker_st else "",
                    priorities=speaker_st.priorities if speaker_st else "",
                    emotion=emotion_str,
                    option_type=option,
                    component_name=comp_display,
                    revealed_intel_description="",
                    revealed_intel_tag="",
                    is_revealed=False,
                    history=history_str,
                    player_utterance=player_spoken_message,
                    default_response=default_msg,
                )

                msg_payload = {
                    "type": "stakeholder_message",
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "revealed_intel_items": [],
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                }
                await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
                revealed_db_entries.append({
                    "id": speaker_id,
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "ac_id": -1,
                    "revealed_intel": [],
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                })

    elif option == "investigate_component" or card_id == "eng_5":
        # Handled entirely by conduct_component_investigation_turn(); no further emit needed.
        pass

    else:
        # priority_query, generic_query, etc.
        speaker_id = conversation.stakeholder_id
        speaker_st = _stakeholder_obj(speaker_id)
        speaker_name = speaker_st.name if speaker_st else _stakeholder_name(speaker_id)

        emotion_str, emotional_state, facial_expression, ev_dict = _stakeholder_emotion_meta(
            speaker_id, emotion_values_map
        )

        if outcome.result == "revealed" and outcome.item_id:
            req = RequirementFactory.get_requirement(outcome.item_id)
            if req:
                held_item = held_by_id.get(req.id)
                was_unverified = held_item and getattr(held_item, "intel_type", None) != ConfidenceType.VERIFIED
                intel_item = StakeholderIntelItem.from_requirement(
                    req,
                    intel_type=ConfidenceType.VERIFIED,
                    categorized_type=req.type,
                    description=req.description,
                    source=IntelSource.INTERVIEW,
                )
                await store_intel_item(challenge, websocket, intel_item)
                held_by_id[req.id] = intel_item
                tag_str = (
                    req.type.value if hasattr(req.type, "value") else str(req.type)
                ).replace("_", " ").title()

                if option == "priority_query" and not comp_display:
                    req_cid = gather.component_for_item(req, graph)
                    comp_display = gather.component_display_name(req_cid, graph) if req_cid else ""

                spoken_response = await generate_stakeholder_response(
                    stakeholder_name=speaker_name,
                    stakeholder_role=speaker_st.role_description if speaker_st else "",
                    challenge=challenge_context,
                    responsibilities=speaker_st.responsibilities if speaker_st else "",
                    priorities=speaker_st.priorities if speaker_st else "",
                    emotion=emotion_str,
                    option_type=option,
                    component_name=comp_display,
                    revealed_intel_description=req.description,
                    revealed_intel_tag=tag_str,
                    is_revealed=True,
                    history=history_str,
                    player_utterance=player_spoken_message,
                    default_response=req.description,
                )

                item_dict = intel_item.model_dump(mode="json")
                item_dict["stakeholder_name"] = speaker_name
                if was_unverified:
                    item_dict["is_verified"] = True

                msg_payload = {
                    "type": "stakeholder_message",
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "revealed_intel_items": [item_dict],
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                }
                await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
                revealed_db_entries.append({
                    "id": speaker_id,
                    "stakeholder_id": speaker_id,
                    "stakeholder_name": speaker_name,
                    "message": spoken_response,
                    "conversation_id": conversation.conversation_id,
                    "ac_id": -1,
                    "revealed_intel": [item_dict],
                    "emotional_state": emotional_state,
                    "facial_expression": facial_expression,
                    "emotion_values": ev_dict,
                })
        else:
            if option == "priority_query":
                default_msg = "All of my main priorities and critical constraints have already been discussed."
            else:
                default_msg = "I don't have any additional requirements or notes to share right now."

            spoken_response = await generate_stakeholder_response(
                stakeholder_name=speaker_name,
                stakeholder_role=speaker_st.role_description if speaker_st else "",
                challenge=challenge_context,
                responsibilities=speaker_st.responsibilities if speaker_st else "",
                priorities=speaker_st.priorities if speaker_st else "",
                emotion=emotion_str,
                option_type=option,
                component_name=comp_display,
                revealed_intel_description="",
                revealed_intel_tag="",
                is_revealed=False,
                history=history_str,
                player_utterance=player_spoken_message,
                default_response=default_msg,
            )

            msg_payload = {
                "type": "stakeholder_message",
                "stakeholder_id": speaker_id,
                "stakeholder_name": speaker_name,
                "message": spoken_response,
                "conversation_id": conversation.conversation_id,
                "revealed_intel_items": [],
                "emotional_state": emotional_state,
                "facial_expression": facial_expression,
                "emotion_values": ev_dict,
            }
            await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)
            revealed_db_entries.append({
                "id": speaker_id,
                "stakeholder_id": speaker_id,
                "stakeholder_name": speaker_name,
                "message": spoken_response,
                "conversation_id": conversation.conversation_id,
                "ac_id": -1,
                "revealed_intel": [],
                "emotional_state": emotional_state,
                "facial_expression": facial_expression,
                "emotion_values": ev_dict,
            })

    # Save chat messages to GameChallenge DB row for persistent chat history
    if player_spoken_message or revealed_db_entries:
        try:
            with get_session() as db:
                row = db.scalars(
                    select(GameChallenge)
                    .where(
                        GameChallenge.user_id == get_user_id(db, username),
                        GameChallenge.phase_index == phase_id,
                        GameChallenge.challenge_index == challenge_id,
                    )
                    .order_by(GameChallenge.id.desc())
                ).first()
                if row:
                    current_msgs = list(row.messages or [])
                    if player_spoken_message:
                        current_msgs.append({
                            "id": "user",
                            "message": player_spoken_message,
                            "conversation_id": conversation.conversation_id,
                            "ac_id": -1,
                        })
                    current_msgs.extend(revealed_db_entries)
                    row.messages = current_msgs
                    flag_modified(row, "messages")
                    db.commit()
        except Exception as e:
            logger.warning(f"[gather_handler] Error updating messages: {e}")

    # Send game events
    await send_events(
        websocket, username, [e.stamped(phase_id=phase_id, challenge_id=challenge_id) for e in outcome.events]
    )

    # Send updated dossier data
    held_after = await _held_items(username, phase_id)
    dossier = await retrieve_dossier_data(challenge, websocket)
    await manager.send_event(websocket=websocket, event="intel:dossier_data", payload={"dossier": dossier})

    # Send updated conversation state
    await _send_conversation(
        websocket, username, phase_id, challenge_id, outcome.conversation, card, held_after, result=outcome.result,
    )


async def handle_gather_close(websocket: WebSocket, username: str, payload: dict) -> None:
    """Ends a conversation early; unused turns are lost."""
    phase_id, challenge_id = payload.get("phase_id", 0), payload.get("challenge_id", 0)
    card_id, stakeholder_id = payload.get("card_id"), payload.get("stakeholder_id")
    card = EngagementCardFactory.get_card(card_id)

    conversation = gather_store.load_conversation(username, phase_id, challenge_id, card_id, stakeholder_id)
    if conversation is None and (card_id == "eng_3" or card.stakeholder_selection_amount == -1):
        conversation = gather_store.load_conversation(username, phase_id, challenge_id, card_id, "all")
    if conversation is None:
        await manager.send_event(
            websocket=websocket, event="system:error", payload={"message": "no such conversation"},
        )
        return

    st_name = _stakeholder_name(conversation.stakeholder_id) if conversation.stakeholder_id != "all" else "Whole Team"
    outcome = gather.close_conversation(conversation, st_name)
    gather_store.save_conversation(username, phase_id, challenge_id, outcome.conversation)
    await send_events(
        websocket, username, [e.stamped(phase_id=phase_id, challenge_id=challenge_id) for e in outcome.events]
    )
    held = await _held_items(username, phase_id)
    await _send_conversation(websocket, username, phase_id, challenge_id, outcome.conversation, card, held)
