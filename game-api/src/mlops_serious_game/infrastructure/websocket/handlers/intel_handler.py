import datetime
from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.requirement import STANCE_TAGS, tag_label, truncate_detail
from mlops_serious_game.infrastructure.database.run_scope import current_run_index
from mlops_serious_game.infrastructure.database import get_session, GameChallenge, IntelItem
from mlops_serious_game.application.online_intel_service.service import (
    run_engagement_card_workflow,
)
from mlops_serious_game.application.action_card_service.service import (
    generate_action_card,
)
from mlops_serious_game.application.intel_handler import (
    intel_rows,
    load_known_intel_items_for_challenge,
    generate_offline_intel_artifacts,
    handle_intel_tagging,
    handle_intel_verification,
    retrieve_dossier_data,
    retrieve_intel_items,
)
from mlops_serious_game.domain.event import GameEvent
from ..manager import manager
from .case_board_handler import push_team_sync_hint
from .log_handler import send_events


async def handle_get_offline_artifacts(websocket: WebSocket, user_id: int, payload: dict) -> None:
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

    # The dossier is persistent (plan 05): what the player found in earlier phases stays.
    # Load known dispute intel items into DB as verified for the new challenge
    _, newly_on_record = load_known_intel_items_for_challenge(curr_challenge, user_id)

    # The deck/dossier already carries these (they're written above); without this the Event Log
    # has nothing to show for a baseline item that was never actually "found", only auto_card and
    # tagged items ever produced a `send_events` call. `newly_on_record` (not every known item)
    # keeps a re-entry into the same challenge from repeating this every time.
    if newly_on_record:
        on_record_events = []
        for item in newly_on_record:
            subject_name = "the system itself"
            if item.stakeholder_id:
                st = StakeholderFactory.get_stakeholder(item.stakeholder_id)
                subject_name = personalize(st.name) if st else item.stakeholder_id
            fact, reading = item.shown_parts()
            detail = " ".join(part.strip() for part in (fact, reading) if part and part.strip())
            on_record_events.append(GameEvent(
                step="offline", kind="intel", direction="none", cause="intel.on_record",
                subject_id=item.stakeholder_id,
                params={"tag": tag_label(item.categorized_type), "st": subject_name, "detail": truncate_detail(detail)},
                refs={"item_id": item.id},
            ).stamped(phase_id=phase_id, challenge_id=challenge_id))
        await send_events(websocket, user_id, on_record_events)

    artifacts = await generate_offline_intel_artifacts(curr_challenge, user_id=user_id)
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


async def handle_tag_item(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Handles tagging an intel artifact and updating user dossier."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    intel_id = payload.get("intel_id") or payload.get("id") or payload.get("requirement_id")
    categorized_type = payload.get("categorized_type")

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    if intel_id and categorized_type:
        if categorized_type not in {t.value for t in STANCE_TAGS}:
            await manager.send_event(
                websocket=websocket,
                event="system:error",
                payload={"message": f"'{categorized_type}' is not a tag a player can assign."},
            )
            return
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
        # No tag leaks (plan 11): says what the player themselves just filed it as, who it
        # concerns, and the same wording they just saw on the ack above - never whether that tag
        # is right. `refs.item_id` still points at the item itself, so the log can jump to it
        # (D51) without naming what it says beyond what's already on screen, or confirming the
        # guess.
        subject_name = "the system itself"
        if intel_item.stakeholder_id:
            st = StakeholderFactory.get_stakeholder(intel_item.stakeholder_id)
            subject_name = personalize(st.name) if st else intel_item.stakeholder_id
        detail = " ".join(part.strip() for part in (item_dict["fact"], item_dict["reading"]) if part and part.strip())
        await send_events(websocket, user_id, [GameEvent(
            step="offline", kind="intel", direction="none", cause="intel.artifact_filed",
            subject_id=intel_item.stakeholder_id,
            params={"tag": tag_label(intel_item.categorized_type), "st": subject_name, "detail": truncate_detail(detail)},
            refs={"item_id": intel_item.id},
        ).stamped(phase_id=phase_id, challenge_id=challenge_id)])

    # Return updated dossier payload
    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data
        }
    )


async def handle_get_dossier(websocket: WebSocket, user_id: int, payload: dict) -> None:
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
            GameChallenge.user_id == user_id
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


async def handle_verify_item(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Handles verifying an intel item during online intel gathering phase."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    intel_item_id = payload.get("intel_item_id")
    print(f"[WS Handler] handle_verify_item: user={user_id}, intel_item_id={intel_item_id}, phase={phase_id}, challenge={challenge_id}")

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
                GameChallenge.user_id == user_id,
                GameChallenge.phase_index == phase_id,
                GameChallenge.challenge_index == challenge_id,
            ).order_by(GameChallenge.id.desc())
            existing = db_session.scalars(stmt).first()
            if not existing:
                existing = GameChallenge(
                    user_id=user_id,
                    run_index=current_run_index(db_session, user_id),
                    phase_index=phase_id,
                    challenge_index=challenge_id,
                    challenge_loop_index=1,
                    action_card={},
                    metric_values=[],
                    time_stamp=datetime.datetime.utcnow(),
                    messages=[],
                    attention_tokens=payload.get("attention_tokens", curr_challenge.attention_tokens if curr_challenge else 20),
                )
                db_session.add(existing)
            elif payload.get("attention_tokens") is not None:
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
                    
                    current_msgs = list(existing.messages or [])
                    matching_verify_ids = {
                        m.get("conversation_id")
                        for m in current_msgs
                        if isinstance(m, dict) and str(m.get("conversation_id", "")).startswith("verify_")
                    }
                    verify_index = len(matching_verify_ids) + 1
                    verify_conv_id = f"verify_{verify_index}"

                    p_msg = f" Played Card: Verify Intel Item on \"{desc}\""
                    st_msg = f" Submitted \"{desc}\" for direct verification."
                    current_msgs.append({
                        "id": "user",
                        "message": p_msg,
                        "conversation_id": verify_conv_id,
                        "ac_id": -1
                    })
                    current_msgs.append({
                        "id": st_id,
                        "message": st_msg,
                        "conversation_id": verify_conv_id,
                        "ac_id": -1
                    })
                    existing.messages = current_msgs
                    flag_modified(existing, "messages")
    except Exception as e:
        print(f"[IntelHandler DB Error] {e}")
    
    await manager.send_event(
        websocket=websocket,
        event="intel:verified_res",
        payload=result
    )

    if result.get("status") == "success":
        confirmed = result.get("old_categorized_type") == result.get("true_categorized_type")
        # Verifying is legitimately allowed to say whether the tag was right - unlike tagging,
        # this is the action that resolves the guess (plan 11).
        await send_events(websocket, user_id, [GameEvent(
            step="offline", kind="intel", direction="up" if confirmed else "none",
            cause="intel.verified_confirmed" if confirmed else "intel.verified_corrected",
            params={"st": result.get("stakeholder_name") or "Someone"},
        ).stamped(phase_id=phase_id, challenge_id=challenge_id)])

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


def phase_room(phase_id: int) -> list[str]:
    """The stakeholders taking part in a phase: the same room the pitch is held in."""
    phases = PhaseFactory.get_phases()
    if 0 <= phase_id < len(phases) and phases[phase_id].stakeholders:
        return [ps.stakeholder_id for ps in phases[phase_id].stakeholders]
    return StakeholderFactory.get_active_stakeholders(phase_id) or StakeholderFactory.get_available_stakeholders()


async def _send_dossier(websocket: WebSocket, dossier_data: list) -> None:
    """The dossier itself only follows `intel:dossier_data`, so every card result sends it too."""
    await manager.send_event(websocket=websocket, event="intel:dossier_data", payload={"dossier": dossier_data})


async def handle_play_engagement_card(websocket: WebSocket, user_id: int, payload: dict) -> None:
    """Handles playing an engagement card (eng_1 - eng_4) during online intel gathering phase."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    card_id = payload.get("card_id")
    stakeholder_ids = payload.get("stakeholder_ids", [])
    if payload.get("session_id"):
        session_id = payload["session_id"]
    else:
        session_id = f"Online_Intel_{user_id}"

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    card = EngagementCardFactory.get_card(card_id)
    # Cards only reach the stakeholders taking part in this phase. Team Sync-up reaches all of them.
    room_ids = phase_room(curr_challenge.phase_id)
    if card and card.stakeholder_selection_amount == -1:
        stakeholder_ids = room_ids
    else:
        stakeholder_ids = [s_id for s_id in stakeholder_ids if s_id in room_ids]
    if card and not stakeholder_ids:
        await manager.send_event(
            websocket=websocket,
            event="system:error",
            payload={"message": "None of those stakeholders take part in this phase."},
        )
        return
    played_cards = []
    engagement_card_targets = {}
    if card:
        try:
            with get_session() as db_session:
                stmt = select(GameChallenge).where(
                    GameChallenge.user_id == user_id,
                    GameChallenge.phase_index == phase_id,
                    GameChallenge.challenge_index == challenge_id,
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
            user_id=user_id,
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
        await _send_dossier(websocket, dossier_data)
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
                GameChallenge.user_id == user_id
            ).order_by(GameChallenge.id.desc())
            existing = db_session.scalars(stmt).first()
            if existing:
                current_msgs = list(existing.messages or [])
                prefix = f"eng_{card_id}_"
                matching_conv_ids = {
                    m.get("conversation_id")
                    for m in current_msgs
                    if isinstance(m, dict) and str(m.get("conversation_id", "")).startswith(prefix)
                }
                play_index = len(matching_conv_ids) + 1
                eng_conv_id = f"{prefix}{play_index}"

                current_msgs.append({
                    "id": "user",
                    "message": player_msg,
                    "conversation_id": eng_conv_id,
                    "ac_id": -1
                })
                for resp in stakeholder_responses:
                    current_msgs.append({
                        "id": resp.get("stakeholder_id", ""),
                        "message": resp.get("message", ""),
                        "conversation_id": eng_conv_id,
                        "ac_id": -1,
                        "revealed_intel": resp.get("revealed_intel_items", [])
                    })
                existing.messages = current_msgs
                flag_modified(existing, "messages")
    except Exception as e:
        print(f"[IntelHandler DB Error in handle_play_engagement_card] {e}")

    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
    await _send_dossier(websocket, dossier_data)

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

    if card_id == "eng_3":
        # Team Sync-Up also points at one pair that has a thread to find (case board, D8).
        await push_team_sync_hint(websocket, user_id, {"phase_id": phase_id, "challenge_id": challenge_id})


async def handle_generate_action_card(websocket: WebSocket, user_id: int, payload: dict) -> None:
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
            session_id=f"ActionCard_{user_id}",
        )

        wrong_intel_ids = []
        for i_id in intel_ids:
            item = collected_map.get(i_id)
            if not item:
                with get_session() as s:
                    records = intel_rows(s, user_id)
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
                GameChallenge.user_id == user_id
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
                    user_id=user_id,
                    run_index=current_run_index(db_session, user_id),
                    phase_index=phase_id,
                    challenge_index=challenge_id,
                    challenge_loop_index=1,
                    action_card=action_card,
                    metric_values=[],
                    time_stamp=datetime.datetime.utcnow(),
                    messages=[],
                    attention_tokens=curr_challenge.attention_tokens,
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


