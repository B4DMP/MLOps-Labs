from fastapi import WebSocket
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
from mlops_serious_game.application.online_intel_service.service import (
    run_engagement_card_workflow,
)
from mlops_serious_game.application.intel_dossier import (
    clear_intel_items_for_user,
    generate_offline_intel_artifacts,
    handle_intel_tagging,
    handle_intel_verification,
    retrieve_dossier_data,
)
from ..manager import manager


async def handle_get_offline_artifacts(websocket: WebSocket, username: str, payload: dict) -> None:

    """Handles fetching/generating 5 offline intel artifacts for the current challenge."""
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

    artifacts = await generate_offline_intel_artifacts(curr_challenge)
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
    """Handles tagging an intel artifact and updating user dossier."""
    phase_id = payload.get("phase_id", 0)
    challenge_id = payload.get("challenge_id", 0)
    requirement_id = payload.get("requirement_id")
    categorized_type = payload.get("categorized_type")

    curr_challenge = PhaseFactory.translate_challenge_index(
        challenge_index=challenge_id,
        phase_index=phase_id
    )
    if not curr_challenge:
        phases = PhaseFactory.get_phases()
        curr_challenge = phases[0].challenges[0]

    if requirement_id and categorized_type:
        intel_item = await handle_intel_tagging(curr_challenge, websocket, requirement_id, categorized_type)
        await manager.send_event(
            websocket=websocket,
            event="intel:tagged_ack",
            payload={
                "intel_item": intel_item.model_dump() if hasattr(intel_item, "model_dump") else intel_item
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

    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)
    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data
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
            "dossier": dossier_data
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
    if card.stakeholder_selection_amount == -1 or not stakeholder_ids:
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

    dossier_data = await retrieve_dossier_data(curr_challenge, websocket)

    await manager.send_event(
        websocket=websocket,
        event="intel:engagement_complete",
        payload={
            "card_id": card_id,
            "player_message": player_msg,
            "stakeholder_responses": stakeholder_responses,
            "dossier": dossier_data,
        }
    )

    await manager.send_event(
        websocket=websocket,
        event="intel:dossier_data",
        payload={
            "dossier": dossier_data
        }
    )

