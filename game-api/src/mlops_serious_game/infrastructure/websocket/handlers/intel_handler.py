import datetime
from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.infrastructure.database import get_session, GameChallenge
from mlops_serious_game.application.online_intel_service.service import (
    run_engagement_card_workflow,
)
from mlops_serious_game.application.action_card_service.service import (
    generate_action_card,
)
from mlops_serious_game.application.intel_handler import (
    clear_intel_items_for_user,
    load_known_intel_items_for_challenge,
    generate_offline_intel_artifacts,
    handle_intel_tagging,
    tag_stakeholder_convincer_archetype,
    handle_intel_verification,
    retrieve_dossier_data,
    retrieve_intel_items,
)
from ..manager import manager


async def handle_get_offline_artifacts(websocket: WebSocket, username: str, payload: dict) -> None:
    """Handles fetching/generating offline intel artifacts for the current challenge."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    
    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    # Clear previous challenge intel items when starting offline intel gathering phase
    await clear_intel_items_for_user(websocket)
    # Load known dispute intel items into DB as verified for the new challenge
    load_known_intel_items_for_challenge(curr_challenge, username)

    artifacts = await generate_offline_intel_artifacts(curr_challenge, username=username)
    await manager.send_event(
        websocket=websocket,
        event="intel:offline_artifacts",
        payload={
            "artifacts": artifacts
        }
    )

    # Send reset dossier data
    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data
        }
    )


async def handle_tag_item(websocket: WebSocket, username: str, payload: dict) -> None:
    """Handles tagging an intel artifact (requirement or convincer) and updating user dossier."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    intel_id = payload.get("intel_id") or payload.get("id") or payload.get("requirement_id")
    categorized_type = payload.get("categorized_type")
    is_convincer = payload.get("is_convincer", False) or (intel_id and str(intel_id).startswith("convincer_"))

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    if is_convincer and categorized_type:
        st_id = payload.get("stakeholder_id") or (str(intel_id).replace("convincer_", "") if intel_id else "")
        if st_id:
            await tag_stakeholder_convincer_archetype(username, st_id, categorized_type)
    elif intel_id and categorized_type:
        intel_item = await handle_intel_tagging(curr_challenge, websocket, intel_id, categorized_type)
        item_dict = intel_item.model_dump() if hasattr(intel_item, "model_dump") else dict(intel_item)
        if getattr(intel_item, "categorized_description", None):
            item_dict["description"] = intel_item.categorized_description
        # Only what the player sees for their own call, never the true reading.
        item_dict["fact"], item_dict["reading"] = intel_item.shown_parts()
        await manager.send_event(
            websocket=websocket,
            event="intel:tagged_ack",
            payload={
                "intel_item": item_dict
            }
        )

    # Return updated dossier payload
    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data
        }
    )


async def handle_tag_convincer_event(websocket: WebSocket, username: str, payload: dict) -> None:
    """Handles tagging a stakeholder's convincer archetype."""
    stakeholder_id = payload.get("stakeholder_id")
    categorized_archetype = payload.get("categorized_archetype")

    if stakeholder_id and categorized_archetype:
        try:
            await tag_stakeholder_convincer_archetype(username, stakeholder_id, categorized_archetype)
            await manager.send_event(
                websocket=websocket,
                event="intel:convincer_tagged_ack",
                payload={
                    "stakeholder_id": stakeholder_id,
                    "categorized_archetype": categorized_archetype,
                }
            )
        except ValueError as e:
            print(f"[Convincer Tagging Error] Invalid payload: {e}")


async def handle_get_dossier(websocket: WebSocket, username: str, payload: dict) -> None:
    """Handles fetching current stakeholder dossier data for the player."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    played_engagement_card_ids = []
    engagement_card_targets = {}
    with get_session() as db_session:
        stmt = select(GameChallenge).where(
            GameChallenge.user_name == username
        ).order_by(GameChallenge.id.desc())
        existing = db_session.scalars(stmt).first()
        if existing and isinstance(existing.action_card, dict):
            played_engagement_card_ids = existing.action_card.get("played_engagement_card_ids", [])
            engagement_card_targets = existing.action_card.get("engagement_card_targets", {})

    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data,
            "played_engagement_card_ids": played_engagement_card_ids,
            "engagement_card_targets": engagement_card_targets,
        }
    )


async def handle_verify_item(websocket: WebSocket, username: str, payload: dict) -> None:
    """Handles verifying an intel item during online intel gathering phase."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    intel_item_id = payload.get("intel_item_id")
    print(f"[WS Handler] handle_verify_item: user={username}, intel_item_id={intel_item_id}, phase={phase_id}, challenge={challenge_id}")

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    result = await handle_intel_verification(curr_challenge, websocket, intel_item_id)
    print(f"[WS Handler] handle_intel_verification result: {result}")

    played_engagement_card_ids = []
    engagement_card_targets = {}
    try:
        with get_session() as db_session:
            stmt = select(GameChallenge).where(
                GameChallenge.user_name == username
            ).order_by(GameChallenge.id.desc())
            existing = db_session.scalars(stmt).first()
            if existing:
                if payload.get("attention_tokens") is not None:
                    existing.attention_tokens = payload.get("attention_tokens")
                if isinstance(existing.action_card, dict):
                    played_engagement_card_ids = existing.action_card.get("played_engagement_card_ids", [])
                    engagement_card_targets = existing.action_card.get("engagement_card_targets", {})
                
                if result.get("status") == "success":
                    req_id = result.get("id")
                    from mlops_serious_game.domain.requirement_factory import RequirementFactory
                    req = RequirementFactory.get_requirement(req_id)
                    st_id = req.stakeholder_id if req else "system"
                    desc = result.get("description", "")
                    
                    current_msgs = list(existing.online_intel_gathering_messages or [])
                    current_msgs.append({
                        "id": "user",
                        "message": f" Played Card: Verify Intel Item on \"{desc}\"",
                        "ac_id": -1
                    })
                    current_msgs.append({
                        "id": st_id,
                        "message": f" Submitted \"{desc}\" for direct verification.",
                        "ac_id": -1
                    })
                    existing.online_intel_gathering_messages = current_msgs
                    flag_modified(existing, "online_intel_gathering_messages")
    except Exception as e:
        print(f"[IntelHandler DB Error] {e}")
    
    await manager.send_event(
        websocket=websocket,
        event="intel:verified_res",
        payload=result
    )

    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data,
            "played_engagement_card_ids": played_engagement_card_ids,
            "engagement_card_targets": engagement_card_targets,
        }
    )


async def handle_play_engagement_card(websocket: WebSocket, username: str, payload: dict) -> None:
    """Handles playing an engagement card (eng_1 - eng_4) during online intel gathering phase."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    card_id = payload.get("card_id")
    stakeholder_ids = payload.get("stakeholder_ids", [])
    session_id = payload.get("session_id") or f"Online_Intel_{username}"

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    # If stakeholder_ids is empty or card targets all stakeholders (e.g. eng_3 team sync)
    card = EngagementCardFactory.get_card(card_id)
    played_cards = []
    engagement_card_targets = {}
    if card:
        try:
            with get_session() as db_session:
                stmt = select(GameChallenge).where(
                    GameChallenge.user_name == username
                ).order_by(GameChallenge.id.desc())
                existing = db_session.scalars(stmt).first()
                if existing:
                    if payload.get("attention_tokens") is not None:
                        existing.attention_tokens = payload.get("attention_tokens")
                    current_ac = dict(existing.action_card or {})
                    played_cards = list(current_ac.get("played_engagement_card_ids", []))
                    if card.max_plays_per_phase == 1 or card.stakeholder_selection_amount == -1:
                        if card_id not in played_cards:
                            played_cards.append(card_id)
                    current_ac["played_engagement_card_ids"] = played_cards
                    
                    engagement_card_targets = dict(current_ac.get("engagement_card_targets", {}))
                    current_targets = list(engagement_card_targets.get(card_id, []))
                    for s_id in stakeholder_ids:
                        if s_id not in current_targets:
                            current_targets.append(s_id)
                    engagement_card_targets[card_id] = current_targets
                    current_ac["engagement_card_targets"] = engagement_card_targets
                    
                    existing.action_card = current_ac
                    flag_modified(existing, "action_card")
        except Exception as e:
            print(f"[IntelHandler DB Error] {e}")

    if card and (card.stakeholder_selection_amount == -1 or not stakeholder_ids):
        active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id)
        if not active_st_ids:
            active_st_ids = StakeholderFactory.get_available_stakeholders()
    async def callback(websocket: WebSocket = None, msg_type: str = "", data: dict = None, **kwargs):
        target_ws = websocket
        if not target_ws:
            return
        await manager.send_event(
            websocket=target_ws,
            event="intel:message_received",
            payload=data or {}
        )

    try:
        player_msg, stakeholder_responses, _ = await run_engagement_card_workflow(
            username=username,
            curr_challenge=curr_challenge,
            card_id=card_id,
            stakeholder_ids=stakeholder_ids,
            phase_id=phase_id,
            challenge_id=challenge_id,
            ws=websocket,
            session_id=session_id,
            callback=callback,
        )
    except Exception as e:
        print(f"[IntelHandler Error in run_engagement_card_workflow] {e}")
        import traceback
        traceback.print_exc()
        dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
        await manager.send_event(
            websocket=websocket,
            event="intel:engagement_complete",
            payload={
                "card_id": card_id,
                "player_message": f"Played {card.title if card else card_id}",
                "stakeholder_responses": [],
                "dossier": dossier_data,
                "played_engagement_card_ids": played_cards,
                "engagement_card_targets": engagement_card_targets,
                "error": str(e),
            }
        )
        await manager.send_event(
            websocket=websocket,
            event="system:error",
            payload={"error": str(e), "message": f"Failed to generate stakeholder response: {str(e)}"},
        )
        return

    try:
        with get_session() as db_session:
            stmt = select(GameChallenge).where(
                GameChallenge.user_name == username
            ).order_by(GameChallenge.id.desc())
            existing = db_session.scalars(stmt).first()
            if existing:
                current_msgs = list(existing.online_intel_gathering_messages or [])
                current_msgs.append({
                    "id": "user",
                    "message": player_msg,
                    "ac_id": -1
                })
                for resp in stakeholder_responses:
                    current_msgs.append({
                        "id": resp.get("stakeholder_id", ""),
                        "message": resp.get("message", ""),
                        "ac_id": -1,
                        "revealed_intel": resp.get("revealed_intel_items", [])
                    })
                existing.online_intel_gathering_messages = current_msgs
                flag_modified(existing, "online_intel_gathering_messages")
    except Exception as e:
        print(f"[IntelHandler DB Error in handle_play_engagement_card] {e}")

    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)

    await manager.send_event(
        websocket=websocket,
        event="intel:engagement_complete",
        payload={
            "card_id": card_id,
            "player_message": player_msg,
            "stakeholder_responses": stakeholder_responses,
            "dossier": dossier_data,
            "played_engagement_card_ids": played_cards,
            "engagement_card_targets": engagement_card_targets,
        }
    )

    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data,
            "played_engagement_card_ids": played_cards,
            "engagement_card_targets": engagement_card_targets,
        }
    )


async def handle_generate_action_card(websocket: WebSocket, username: str, payload: dict) -> None:
    """Handles generating an Action Card via LLM LangGraph service based on merged intel item IDs."""
    intel_ids = payload.get("intel_ids", [])
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id,
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    collected_items = await retrieve_intel_items(curr_challenge, websocket)
    collected_map = {item.id: item for item in collected_items}

    merged_intel_data = []
    for i_id in intel_ids:
        if i_id in collected_map:
            item = collected_map[i_id]
            st = StakeholderFactory.get_stakeholder(item.stakeholder_id)
            st_name = st.name if st else (item.stakeholder_id or "Stakeholder")
            cat_type = item.categorized_type.value if hasattr(item.categorized_type, "value") else str(item.categorized_type)
            merged_intel_data.append({
                "id": item.id,
                "description": item.description,
                "stakeholder_name": st_name,
                "categorized_type": cat_type,
            })
        else:
            req = RequirementFactory.get_requirement(i_id)
            if req:
                st = StakeholderFactory.get_stakeholder(req.stakeholder_id)
                st_name = st.name if st else req.stakeholder_id
                cat_type = req.type.value if hasattr(req.type, "value") else str(req.type)
                merged_intel_data.append({
                    "id": req.id,
                    "description": req.description,
                    "stakeholder_name": st_name,
                    "categorized_type": cat_type,
                })

    challenge_context = (
        f"{curr_challenge.name}: {curr_challenge.roundIntroduction} "
        f"{personalize(curr_challenge.description, resolve_markers=True)}"
    )

    try:
        action_card = await generate_action_card(
            challenge_context=challenge_context,
            intel_items=merged_intel_data,
            intel_ids=intel_ids,
            phase_id=phase_id,
            challenge_id=challenge_id,
            session_id=f"ActionCard_{username}",
        )

        wrong_intel_ids = []
        for i_id in intel_ids:
            item = collected_map.get(i_id)
            if not item:
                with get_session() as s:
                    records = s.scalars(select(IntelItem).where(IntelItem.user_name == username)).all()
                    for r in records:
                        if isinstance(r.intel_item_data, dict) and r.intel_item_data.get("id") == i_id:
                            try:
                                item = StakeholderIntelItem(**r.intel_item_data)
                            except Exception:
                                pass
                            break
            if item and not item.is_correct_intel():
                wrong_intel_ids.append(item.id)
        action_card["wrong_intel_ids"] = wrong_intel_ids

        with get_session() as db_session:
            stmt = select(GameChallenge).where(
                GameChallenge.user_name == username
            ).order_by(GameChallenge.id.desc())
            existing = db_session.scalars(stmt).first()
            if existing:
                current_ac = dict(existing.action_card or {})
                merged_ac = {
                    **action_card,
                    "played_engagement_card_ids": current_ac.get("played_engagement_card_ids", []),
                    "engagement_card_targets": current_ac.get("engagement_card_targets", {}),
                }
                existing.action_card = merged_ac
                flag_modified(existing, "action_card")
            else:
                new_record = GameChallenge(
                    user_name=username,
                    phase_index=phase_id,
                    challenge_index=challenge_id,
                    challenge_loop_index=1,
                    action_card=action_card,
                    metric_values=[],
                    time_stamp=datetime.datetime.utcnow(),
                    pitch_debate_messages=[],
                    online_intel_gathering_messages=[],
                    attention_tokens=8,
                    emotion_values={},
                )
                db_session.add(new_record)

        await manager.send_event(
            websocket=websocket,
            event="intel:action_card_generated",
            payload={
                "action_card": action_card,
            }
        )

    except Exception as e:
        print(f"[Action Card Generation Error] {e}")
        import traceback
        traceback.print_exc()
        await manager.send_error(websocket, f"Failed to generate action card: {e!s}")


