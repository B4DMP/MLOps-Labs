from fastapi import WebSocket
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.application.intel_dossier import (
    clear_intel_items_for_user,
    generate_offline_intel_artifacts,
    handle_intel_tagging,
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
