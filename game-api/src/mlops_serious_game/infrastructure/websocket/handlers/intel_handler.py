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
from mlops_serious_game.infrastructure.database import get_session, GameChallenge
from mlops_serious_game.application.intel_handler import (
    load_known_intel_items_for_challenge,
    generate_offline_intel_artifacts,
    handle_intel_tagging,
    handle_intel_verification,
    retrieve_dossier_data,
    retrieve_intel_items,
)
from mlops_serious_game.domain.event import GameEvent
from ..manager import manager
from .log_handler import send_events


VERIFY_CARD_ID = "eng_0"


async def _item_in_reach(curr_challenge, websocket: WebSocket, item_id) -> bool:
    """An item the player may act on: one of this challenge's own notes, or one already in their dossier."""
    if not item_id:
        return False
    if any(r.id == item_id for r in RequirementFactory.get_requirements_for_challenge(curr_challenge.id)):
        return True
    return any(item.id == item_id for item in await retrieve_intel_items(curr_challenge, websocket))


def _challenge_row(db_session, user_id: int, phase_id: int, challenge_id: int):
    return db_session.scalars(
        select(GameChallenge).where(
            GameChallenge.user_id == user_id,
            GameChallenge.phase_index == phase_id,
            GameChallenge.challenge_index == challenge_id,
        ).order_by(GameChallenge.id.desc())
    ).first()


def can_afford(user_id: int, phase_id: int, challenge_id: int, cost: int) -> bool:
    """Tokens are server-side state: a card is refused when the stored balance cannot cover it."""
    with get_session() as db_session:
        row = _challenge_row(db_session, user_id, phase_id, challenge_id)
        return row is None or row.attention_tokens is None or row.attention_tokens >= cost


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
        if not await _item_in_reach(curr_challenge, websocket, intel_id):
            await manager.send_event(
                websocket=websocket, event="system:error", payload={"message": "That note is not part of this challenge."}
            )
            return
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

    verify_card = EngagementCardFactory.get_card(VERIFY_CARD_ID)
    verify_cost = verify_card.token_cost if verify_card else 0
    if not await _item_in_reach(curr_challenge, websocket, intel_item_id):
        await manager.send_event(
            websocket=websocket, event="system:error", payload={"message": "That note is not part of this challenge."}
        )
        return
    if not can_afford(user_id, phase_id, challenge_id, verify_cost):
        await manager.send_event(
            websocket=websocket, event="system:error", payload={"message": "Not enough attention tokens."}
        )
        return

    result = await handle_intel_verification(curr_challenge, websocket, intel_item_id)
    print(f"[WS Handler] handle_intel_verification result: {result}")
    spent = verify_cost if result.get("status") == "success" else 0

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
                    attention_tokens=max(0, (curr_challenge.attention_tokens if curr_challenge else 20) - spent),
                )
                db_session.add(existing)
            elif existing.attention_tokens is not None:
                existing.attention_tokens = max(0, existing.attention_tokens - spent)

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
