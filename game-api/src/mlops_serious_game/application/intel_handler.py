
import asyncio
import uuid
from mlops_serious_game.domain.requirement import (
    StakeholderIntelItemArtifact,
    ArtifactType,
    ConfidenceType,
    RequirementType,
    StakeholderIntelItem,
    StakeholderRequirement,
)
from typing import List, Dict, Any, Optional
import random

from fastapi import WebSocket
from sqlalchemy import select

from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.domain.convincer_archetype_artifact_factory import ConvincerArchetypeArtifactFactory
from mlops_serious_game.application.pitch_debate_service.chains import (
    get_wrong_intel_chain,
    get_intel_artifact_chain,
)
from mlops_serious_game.application.pitch_debate_service.state import DialogueOption
from mlops_serious_game.infrastructure.database import IntelItem, GameSession, get_session


async def generate_intel_item_artifact_content(
    curr_challenge: Challenge,
    intel_item: StakeholderIntelItem,
    artifact_type: ArtifactType = ArtifactType.EMAIL,
) -> str:
    """Generates the content of an intel item artifact based on the stakeholder's stance."""
    req = RequirementFactory.get_requirement(intel_item.id)
    stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
    stakeholder_name = stakeholder.name
    stakeholder_profile = (
        f"Responsibilities: {stakeholder.responsibilities}, Priorities: {stakeholder.priorities}"
    )

    chain = get_intel_artifact_chain()
    res = await chain.ainvoke({
        "challenge": curr_challenge.description,
        "stakeholder_name": stakeholder_name,
        "stakeholder_profile": stakeholder_profile,
        "requirement_description": req.description,
        "requirement_type": req.type.value,
        "artifact_type": artifact_type.value if isinstance(artifact_type, ArtifactType) else str(artifact_type),
    })
    return res.strip()


async def generate_intel_item_artifact(
    curr_challenge: Challenge,
    intel_item: StakeholderIntelItem,
    artifact_type: ArtifactType = ArtifactType.EMAIL,
) -> StakeholderIntelItemArtifact:
    """Generates an intel item artifact for the given intel item."""
    content = await generate_intel_item_artifact_content(curr_challenge, intel_item, artifact_type)
    return StakeholderIntelItemArtifact(
        id=str(uuid.uuid4()),
        intel_item_id=intel_item.id,
        type=artifact_type,
        content=content,
    )


def select_reqs_for_offl_intel_gathering(curr_challenge: Challenge) -> List[StakeholderRequirement]:
    """Selects 5 random requirement objects across all stakeholders and types for the current challenge."""
    all_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
    if len(all_reqs) <= 5:
        return all_reqs.copy()
    return random.sample(all_reqs, 5)


async def _generate_single_artifact(curr_challenge: Challenge, req: StakeholderRequirement, art_type: ArtifactType) -> Dict[str, Any]:
    stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
    temp_item = StakeholderIntelItem.from_requirement(req)
    try:
        content = await generate_intel_item_artifact_content(curr_challenge, temp_item, art_type)
    except Exception as e:
        print(f"[Offline Intel Generation Error] {e}")
        content = f"Stakeholder Stance Note regarding {curr_challenge.name}: {req.description}"

    return {
        "id": str(uuid.uuid4()),
        "requirement_id": req.id,
        "stakeholder_id": req.stakeholder_id,
        "stakeholder_name": stakeholder.name,
        "stakeholder_role": stakeholder.role_description,
        "artifact_type": art_type.value if isinstance(art_type, ArtifactType) else str(art_type),
        "content": content,
    }


def get_default_stakeholder_archetypes(existing_archs: Optional[dict] = None) -> dict:
    """Helper function to build or update default stakeholder convincer archetypes."""
    archs = dict(existing_archs or {})
    stakeholder_list = (
        StakeholderFactory.stakeholders
        if isinstance(StakeholderFactory.stakeholders, list)
        else list(StakeholderFactory.stakeholders.values())
    )
    for st in stakeholder_list:
        s_id = getattr(st, "id", None) or (st.get("id") if isinstance(st, dict) else str(st))
        real_arch = getattr(st, "convincer_archetype", "") if hasattr(st, "convincer_archetype") else (st.get("convincer_archetype", "") if isinstance(st, dict) else "")
        if s_id not in archs:
            archs[s_id] = {
                "real_archetype": real_arch,
                "categorized_archetype": None,
            }
        else:
            archs[s_id]["real_archetype"] = real_arch
    return archs


async def tag_stakeholder_convincer_archetype(
    player: str,
    stakeholder_id: str,
    categorized_archetype: str,
) -> dict:
    """Processes tagging or re-tagging of a stakeholder's convincer archetype."""
    if stakeholder_id not in StakeholderFactory.get_available_stakeholders():
        raise ValueError(f"Invalid stakeholder_id: {stakeholder_id}")
    if categorized_archetype not in EmotionFactory.get_available_archetype_names():
        raise ValueError(f"Invalid categorized_archetype: {categorized_archetype}")

    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
    with get_session() as db_session:
        session_rec = get_or_create_game_session(player, db_session)
        archs = dict(session_rec.stakeholder_archetypes or {})
        st_entry = dict(archs.get(stakeholder_id, {}))
        st = StakeholderFactory.get_stakeholder(stakeholder_id)
        real_arch = getattr(st, "convincer_archetype", "") if st else st_entry.get("real_archetype", "")

        # Check if the archetype is already validated
        current_cat = st_entry.get("categorized_archetype")
        if current_cat and real_arch and current_cat == real_arch:
            # Archetype is already validated; do not overwrite
            return st_entry

        st_entry["real_archetype"] = real_arch
        st_entry["categorized_archetype"] = categorized_archetype
        archs[stakeholder_id] = st_entry
        session_rec.stakeholder_archetypes = archs
        flag_modified(session_rec, "stakeholder_archetypes")
        db_session.commit()
        return st_entry


def correct_and_verify_convincer_archetype(
    username: str,
    stakeholder_id: str,
) -> dict:
    """Corrects a misattributed convincer archetype to the true archetype in GameSession."""
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
    with get_session() as session:
        session_rec = get_or_create_game_session(username, session)
        archs = dict(session_rec.stakeholder_archetypes or {})
        st_entry = dict(archs.get(stakeholder_id, {}))
        st = StakeholderFactory.get_stakeholder(stakeholder_id)
        real_arch = getattr(st, "convincer_archetype", "") if st else st_entry.get("real_archetype", "")
        old_cat = st_entry.get("categorized_archetype")
        st_entry["real_archetype"] = real_arch
        st_entry["categorized_archetype"] = real_arch
        archs[stakeholder_id] = st_entry
        session_rec.stakeholder_archetypes = archs
        flag_modified(session_rec, "stakeholder_archetypes")
        session.commit()
        return {
            "stakeholder_id": stakeholder_id,
            "old_archetype": old_cat,
            "true_archetype": real_arch,
        }


async def generate_offline_intel_artifacts(curr_challenge: Challenge, username: str = None) -> List[Dict[str, Any]]:
    """Loads unconfirmed offline intel artifacts and additional convincer profile artifacts for newly introduced stakeholders."""
    challenge_artifacts = OfflineIntelArtifactFactory.get_artifacts_for_challenge(curr_challenge.id)
    unconfirmed_artifacts = [art for art in challenge_artifacts if not art.is_known][:3]

    results = []
    for art in unconfirmed_artifacts:
        stakeholder = StakeholderFactory.get_stakeholder(art.stakeholder_id)
        results.append({
            "id": art.id,
            "requirement_id": art.requirement_id,
            "stakeholder_id": art.stakeholder_id,
            "stakeholder_name": stakeholder.name if stakeholder else art.stakeholder_name,
            "stakeholder_role": stakeholder.role_description if stakeholder else art.stakeholder_role,
            "artifact_type": art.artifact_type.value if isinstance(art.artifact_type, ArtifactType) else str(art.artifact_type),
            "content": art.content,
            "is_known": False,
        })


    # Append convincer profile artifacts for stakeholders newly introduced in this phase
    # Append convincer profile artifacts for stakeholders active in this phase that need introduction/categorization
    active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id)
    phases = PhaseFactory.get_phases()
    if not active_st_ids and 0 <= curr_challenge.phase_id < len(phases):
        active_st_ids = [ps.stakeholder_id for ps in phases[curr_challenge.phase_id].stakeholders]
    
    session_archs = {}
    if username:
        from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
        with get_session() as db_session:
            sess_rec = get_or_create_game_session(username, db_session)
            session_archs = dict(sess_rec.stakeholder_archetypes or {})

    previous_st_ids = set()
    for p_idx in range(curr_challenge.phase_id):
        if p_idx < len(phases):
            for ps in phases[p_idx].stakeholders:
                previous_st_ids.add(ps.stakeholder_id)

    # Include any active stakeholder who is either newly introduced in this phase or not yet categorized
    st_ids_to_introduce = []
    for s_id in active_st_ids:
        st_cat = session_archs.get(s_id, {}).get("categorized_archetype")
        if st_cat is None or s_id not in previous_st_ids:
            if s_id not in st_ids_to_introduce:
                st_ids_to_introduce.append(s_id)
        
    all_archetypes = EmotionFactory.get_available_archetype_names()

    for s_id in st_ids_to_introduce:
        st = StakeholderFactory.get_stakeholder(s_id)
        if not st:
            continue
        real_arch_name = getattr(st, "convincer_archetype", "")
        art_def = ConvincerArchetypeArtifactFactory.get_artifact_for_archetype(real_arch_name)
        
        if art_def:
            template = art_def.convincer_archetype_artifact
            artifact_type_val = (
                art_def.artifact_type.value
                if hasattr(art_def.artifact_type, "value")
                else str(art_def.artifact_type)
            )
        else:
            template = f"#team-chat Slack\n{{stakeholder_name}}: Let's make sure our approach is aligned with our priorities."
            artifact_type_val = "slack_message"

        content = template.replace("{stakeholder_name}", st.name)
        
        cat_type = session_archs.get(s_id, {}).get("categorized_archetype") if session_archs else None

        results.append({
            "id": f"convincer_{st.id}",
            "requirement_id": f"convincer_{st.id}",
            "stakeholder_id": st.id,
            "stakeholder_name": st.name,
            "stakeholder_role": getattr(st, "role_description", ""),
            "artifact_type": artifact_type_val,
            "content": content,
            "is_convincer_profile": True,
            "possible_archetypes": all_archetypes,
            "categorized_type": cat_type,
        })

    # Shuffle the combined list so convincer and intel artifacts are mixed
    random.shuffle(results)
    return results


from sqlalchemy.orm.attributes import flag_modified

def load_known_intel_items_for_challenge(curr_challenge: Challenge, username: str) -> List[StakeholderIntelItem]:
    """Loads all is_known==True intel items for the current challenge into the DB as verified and returns them."""
    known_artifacts = [
        art for art in OfflineIntelArtifactFactory.get_artifacts_for_challenge(curr_challenge.id)
        if art.is_known
    ]
    if not known_artifacts:
        return []

    loaded_items: List[StakeholderIntelItem] = []
    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == username)
        ).all()
        existing_ids = {
            r.intel_item_data.get("id")
            for r in records
            if isinstance(r.intel_item_data, dict)
        }

        for art in known_artifacts:
            req = RequirementFactory.get_requirement(art.requirement_id)
            if not req:
                continue

            if req.id not in existing_ids:
                new_item = StakeholderIntelItem.from_requirement(
                    req,
                    intel_type=ConfidenceType.VERIFIED,
                    categorized_type=req.type,
                    description=req.description,
                    is_public_record=True,
                )
                new_record = IntelItem(
                    user_name=username,
                    intel_item_data=new_item.model_dump(mode="json"),
                )
                session.add(new_record)
                existing_ids.add(req.id)
                loaded_items.append(new_item)
            else:
                for r in records:
                    if isinstance(r.intel_item_data, dict) and r.intel_item_data.get("id") == req.id:
                        data = dict(r.intel_item_data)
                        cat_type_str = req.type.value if hasattr(req.type, "value") else str(req.type)
                        if data.get("intel_type") != ConfidenceType.VERIFIED.value or data.get("categorized_type") != cat_type_str or data.get("description") != req.description or data.get("categorized_description") != req.description or not data.get("is_public_record"):
                            data["intel_type"] = ConfidenceType.VERIFIED.value
                            data["categorized_type"] = cat_type_str
                            data["description"] = req.description
                            data["categorized_description"] = req.description
                            # Items persisted before the two-stamp split carry no provenance flag;
                            # anything the known-intel loader touches is on the public record.
                            data["is_public_record"] = True
                            r.intel_item_data = data
                            flag_modified(r, "intel_item_data")
                        loaded_items.append(StakeholderIntelItem(**data))
                        break
        session.commit()
    return loaded_items


async def store_intel_item(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Stores or updates an intel item in the database."""
    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == ws.query_params["username"])
        ).all()

        target_record = None
        for record in records:
            if isinstance(record.intel_item_data, dict):
                item_id = record.intel_item_data.get("id")
                if item_id == intel_item.id:
                    target_record = record
                    break

        item_dict = intel_item.model_dump(mode="json") if hasattr(intel_item, "model_dump") else intel_item
        if target_record:
            target_record.intel_item_data = dict(item_dict)
            flag_modified(target_record, "intel_item_data")
        else:
            new_record = IntelItem(
                user_name=ws.query_params["username"],
                intel_item_data=dict(item_dict)
            )
            session.add(new_record)
        session.commit()



async def clear_intel_items_for_user(ws: WebSocket) -> None:
    """Deletes all collected intel items for the user when a new challenge starts."""
    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == ws.query_params["username"])
        ).all()
        for r in records:
            session.delete(r)
        session.commit()


async def retrieve_intel_items(curr_challenge: Challenge, ws: WebSocket) -> List[StakeholderIntelItem]:
    """Retrieves intel items for the current challenge."""
    intel_items: List[StakeholderIntelItem] = []

    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == ws.query_params["username"])
        ).all()

        for record in records:
            data = record.intel_item_data
            if isinstance(data, dict):
                item = StakeholderIntelItem(**data)
                if item.challenge_id == curr_challenge.id:
                    intel_items.append(item)

    return intel_items



async def handle_intel_item_categorization(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Handles the categorization of intel items using pre-generated descriptions when available."""
    cat_type = intel_item.categorized_type.value if hasattr(intel_item.categorized_type, "value") else str(intel_item.categorized_type)
    true_type = intel_item.type.value if hasattr(intel_item.type, "value") else str(intel_item.type)
    if cat_type == true_type:
        intel_item.categorized_description = intel_item.description
    else:
        wrong_desc = OfflineIntelArtifactFactory.get_wrong_description(
            intel_item.id,
            cat_type,
        )
        if wrong_desc:
            intel_item.categorized_description = wrong_desc
        else:
            intel_item.categorized_description = await create_wrong_intel_item_description(curr_challenge, intel_item)
    await store_intel_item(curr_challenge, ws, intel_item)

async def create_wrong_intel_item_description(curr_challenge: Challenge, intel_item: StakeholderIntelItem) -> str:
    """Creates a wrong description for the given intel item"""
    stakeholder = StakeholderFactory.get_stakeholder(intel_item.stakeholder_id)
    stakeholder_name = stakeholder.name if stakeholder else "Stakeholder"
    stakeholder_profile = (
        f"Responsibilities: {stakeholder.responsibilities}, Priorities: {stakeholder.priorities}"
        if stakeholder else ""
    )

    chain = get_wrong_intel_chain()
    res = await chain.ainvoke({
        "challenge": curr_challenge.description,
        "stakeholder_name": stakeholder_name,
        "stakeholder_profile": stakeholder_profile,
        "correct_description": intel_item.description,
        "categorized_type": intel_item.categorized_type.value if hasattr(intel_item.categorized_type, "value") else str(intel_item.categorized_type)
    })
    return res.strip()


async def generate_and_save_all_offline_intel_artifacts() -> Dict[str, Any]:
    """Generates offline intel artifacts and all possible miscategorizations for all requirements and saves to config."""
    from pathlib import Path
    import json
    from mlops_serious_game.domain.gameConfigLoader import GameConfigLoader

    existing_artifacts = OfflineIntelArtifactFactory.artifacts_by_requirement
    all_reqs = RequirementFactory.get_requirements()
    if not all_reqs:
        return {"status": "error", "message": "No requirement objects found to generate artifacts for."}

    # Only process requirements that are configured in OfflineIntelArtifactFactory
    reqs_to_process = [r for r in all_reqs if r.id in existing_artifacts] if existing_artifacts else all_reqs

    artifact_types = list(ArtifactType)
    semaphore = asyncio.Semaphore(10)

    async def _process_requirement(req: StakeholderRequirement) -> Dict[str, Any]:
        async with semaphore:
            curr_challenge = PhaseFactory.get_challenge_by_id(req.challenge_id)
            if not curr_challenge:
                phases = PhaseFactory.get_phases()
                curr_challenge = phases[0].challenges[0]
            
            stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
            existing_art = existing_artifacts.get(req.id)
            art_type = existing_art.artifact_type if existing_art else random.choice(artifact_types)
            art_id = existing_art.id if existing_art else f"art_{req.id}"
            is_known = existing_art.is_known if existing_art is not None else False

            temp_item = StakeholderIntelItem.from_requirement(req)

            # 1. Generate main artifact content
            try:
                content = await generate_intel_item_artifact_content(curr_challenge, temp_item, art_type)
            except Exception as e:
                print(f"[Offline Intel Generator Warning] Content generation failed for {req.id}: {e}")
                content = f"Stakeholder Note from {stakeholder.name}: {req.description}"

            # 2. Generate wrong descriptions for all 3 miscategorizations
            wrong_descriptions: Dict[str, str] = {}
            possible_types = [t for t in RequirementType if t != req.type]

            for wrong_type in possible_types:
                temp_wrong_item = StakeholderIntelItem.from_requirement(req, categorized_type=wrong_type)
                try:
                    wrong_desc = await create_wrong_intel_item_description(curr_challenge, temp_wrong_item)
                except Exception as e:
                    print(f"[Offline Intel Generator Warning] Wrong desc generation failed for {req.id} ({wrong_type.value}): {e}")
                    wrong_desc = f"Misinterpreted Stance regarding {curr_challenge.name}: {req.description}"
                
                wrong_descriptions[wrong_type.value] = wrong_desc

            return {
                "id": art_id,
                "requirement_id": req.id,
                "challenge_id": req.challenge_id,
                "stakeholder_id": req.stakeholder_id,
                "stakeholder_name": stakeholder.name,
                "stakeholder_role": stakeholder.role_description,
                "artifact_type": art_type.value if hasattr(art_type, "value") else str(art_type),
                "content": content,
                "wrong_descriptions": wrong_descriptions,
                "is_known": is_known,
            }

    tasks = [_process_requirement(req) for req in reqs_to_process]
    generated_artifacts = await asyncio.gather(*tasks)

    # Save to gameConfig/OfflineIntelArtifacts.json
    base_dir = Path(__file__).parent
    target_path = (base_dir / "../../../../gameConfig/OfflineIntelArtifacts.json").resolve()
    
    output_data = {
        "artifacts": list(generated_artifacts)
    }

    with target_path.open("w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    # Re-initialize GameConfigLoader to refresh in-memory factory
    GameConfigLoader.initialize()

    return {
        "status": "success",
        "count": len(generated_artifacts),
        "message": f"Successfully generated and saved {len(generated_artifacts)} offline intel artifacts to OfflineIntelArtifacts.json!"
    }


async def handle_intel_tagging(
    curr_challenge: Challenge,
    ws: WebSocket,
    requirement_id: str,
    categorized_type: str,
) -> StakeholderIntelItem:
    """Processes tagging or re-tagging of an intel artifact by the player, creating or updating an intel item."""
    collected_items = await retrieve_intel_items(curr_challenge, ws)
    existing_item = next((item for item in collected_items if item.id == requirement_id), None)

    if existing_item:
        item_conf = existing_item.intel_type.value if hasattr(existing_item.intel_type, "value") else str(existing_item.intel_type)
        if item_conf.lower() != "unconfirmed":
            return existing_item
        existing_item.categorized_type = RequirementType(categorized_type)
        req = RequirementFactory.get_requirement(existing_item.id)
        if req:
            existing_item.description = req.description
            existing_item.type = req.type
        intel_item = existing_item
    else:
        req = RequirementFactory.get_requirement(requirement_id)
        if not req:
            all_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
            req = next((r for r in all_reqs if r.id == requirement_id), None)
        if not req:
            raise ValueError(f"Requirement '{requirement_id}' not found.")
        intel_item = StakeholderIntelItem.from_requirement(
            req,
            intel_type=ConfidenceType.UNCONFIRMED,
            categorized_type=RequirementType(categorized_type),
        )

    await handle_intel_item_categorization(curr_challenge, ws, intel_item)
    return intel_item


async def handle_intel_verification(
    curr_challenge: Challenge,
    ws: WebSocket,
    intel_item_id: str,
) -> Dict[str, Any]:
    """Handles verification of an intel item.
    If correctly categorized: mark as verified.
    If incorrectly categorized: correct the categorized_type to true req.type, set true description, and mark as verified.
    Returns result details for frontend popup.
    """
    collected_items = await retrieve_intel_items(curr_challenge, ws)
    target_item = next(
        (item for item in collected_items if item.id == intel_item_id),
        None
    )
    if not target_item:
        req = RequirementFactory.get_requirement(intel_item_id)
        if not req:
            all_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
            req = next((r for r in all_reqs if r.id == intel_item_id), None)

        if not req:
            return {"status": "error", "message": f"Intel requirement '{intel_item_id}' not found."}

        target_item = StakeholderIntelItem.from_requirement(
            req,
            intel_type=ConfidenceType.VERIFIED,
            categorized_type=req.type,
            description=req.description,
        )
    else:
        req = RequirementFactory.get_requirement(target_item.id)

    stakeholder = StakeholderFactory.get_stakeholder(target_item.stakeholder_id) if target_item else None

    old_categorized_type = (
        target_item.categorized_type.value
        if hasattr(target_item.categorized_type, "value")
        else str(target_item.categorized_type)
    )
    true_categorized_type = (
        req.type.value if (req and hasattr(req.type, "value"))
        else (str(req.type) if req else old_categorized_type)
    )

    # Perform verification & correction
    target_item.intel_type = ConfidenceType.VERIFIED
    if req:
        target_item.categorized_type = req.type
        target_item.description = req.description
        target_item.categorized_description = req.description

    await store_intel_item(curr_challenge, ws, target_item)

    return {
        "status": "success",
        "old_categorized_type": old_categorized_type,
        "true_categorized_type": true_categorized_type,
        "id": target_item.id,
        "stakeholder_name": stakeholder.name if stakeholder else "",
        "description": target_item.description,
        "intel_item": target_item.model_dump(mode="json"),
    }


def correct_and_verify_intel_item(
    username: str,
    requirement_id: str,
    curr_challenge: Challenge = None,
) -> StakeholderIntelItem:
    """Corrects an intel item in the database and marks it as verified."""
    req = RequirementFactory.get_requirement(requirement_id)
    if not req:
        return None

    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == username)
        ).all()

        target_record = None
        for record in records:
            if isinstance(record.intel_item_data, dict) and record.intel_item_data.get("id") == requirement_id:
                target_record = record
                break

        cat_type_str = req.type.value if hasattr(req.type, "value") else str(req.type)

        if target_record:
            data = dict(target_record.intel_item_data)
            data["intel_type"] = ConfidenceType.VERIFIED.value
            data["categorized_type"] = cat_type_str
            data["description"] = req.description
            data["categorized_description"] = req.description
            target_record.intel_item_data = data
            flag_modified(target_record, "intel_item_data")
            session.commit()
            return StakeholderIntelItem(**data)
        else:
            new_item = StakeholderIntelItem.from_requirement(
                req,
                intel_type=ConfidenceType.VERIFIED,
                categorized_type=req.type,
                description=req.description,
            )
            new_record = IntelItem(
                user_name=username,
                intel_item_data=new_item.model_dump(mode="json")
            )
            session.add(new_record)
            session.commit()
            return new_item


correct_and_infer_intel_item = correct_and_verify_intel_item


def _is_public_record(item: StakeholderIntelItem) -> bool:
    """True when the item was already public at challenge start rather than confirmed by the player.

    The persisted flag only exists on items written since the two-stamp split, and the known-intel
    loader repairs items for the *current* challenge only, so saves in progress would keep showing
    the wrong stamp on earlier challenges. Fall back to the artifact config, which is the source of
    truth: an `is_known` artifact never reaches the player's tagging deck, so it can only be public
    record.
    """
    if getattr(item, "is_public_record", False):
        return True
    artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(item.id)
    return bool(artifact and artifact.is_known)


async def retrieve_dossier_data(curr_challenge: Challenge, ws: WebSocket) -> List[Dict[str, Any]]:
    """Retrieves full dossier summary data for all stakeholders in the current challenge."""
    username = ws.query_params["username"]
    collected_items = await retrieve_intel_items(curr_challenge, ws)
    
    stakeholder_intel_map: Dict[str, List[Dict[str, Any]]] = {}
    for item in collected_items:
        st_id = item.stakeholder_id
        if st_id:
            if st_id not in stakeholder_intel_map:
                stakeholder_intel_map[st_id] = []
            intel_type_val = item.intel_type.value if hasattr(item.intel_type, "value") else str(item.intel_type)
            cat_type_val = item.categorized_type.value if hasattr(item.categorized_type, "value") else str(item.categorized_type)
            is_verified = (item.intel_type == ConfidenceType.VERIFIED or str(item.intel_type).lower() == "verified")
            display_desc = item.description if is_verified else (item.categorized_description if item.categorized_description else item.description)
            stakeholder_intel_map[st_id].append({
                "id": item.id,
                "intel_type": intel_type_val,
                "categorized_type": cat_type_val,
                "description": display_desc,
                "is_correct": item.is_correct_intel(),
                "is_public_record": _is_public_record(item),
            })



    session_archs = {}
    if username:
        from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
        with get_session() as db_session:
            sess_rec = get_or_create_game_session(username, db_session)
            session_archs = dict(sess_rec.stakeholder_archetypes or {})

    phase = PhaseFactory.get_phases()[curr_challenge.phase_id]
    ph_st_map = {ps.stakeholder_id: ps for ps in phase.stakeholders}
    active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id) or StakeholderFactory.get_available_stakeholders()

    dossier_list = []
    for st_id in active_st_ids:
        st = StakeholderFactory.get_stakeholder(st_id)
        if not st:
            continue
        ch_st = ph_st_map.get(st.id)
        intel_entries = stakeholder_intel_map.get(st_id, [])

        st_arch_entry = session_archs.get(st_id, {})
        cat_arch = st_arch_entry.get("categorized_archetype")
        real_arch = st_arch_entry.get("real_archetype") or getattr(st, 'convincer_archetype', '')
        is_val = bool(cat_arch and cat_arch == real_arch)
        status = "validated" if is_val else ("unconfirmed" if cat_arch else "unknown")

        dossier_list.append({
            "stakeholder_id": st.id,
            "name": st.name,
            "responsibilities": st.responsibilities,
            "priorities": st.priorities,
            "constraints": getattr(st, 'constraints', getattr(st, 'requirements', "")),
            "role_description": st.role_description,
            "metric_id": st.metric_id,
            "convincer_archetype": cat_arch or "",
            "is_validated": is_val,
            "convincer_status": status,
            "power": ch_st.power if ch_st else "low",
            "interest": ch_st.interest if ch_st else "low",
            "intel_items": intel_entries,
        })

    return dossier_list


def determine_dialogue_options(
    discovered_intel_items: Optional[list[Any]] = None,
) -> list[DialogueOption]:
    """Determines 4 distinct dialogue options (intel-based and corporate noise) for the player outside of LangGraph.

    Selects up to 2 discovered intel items and fills the remaining slots with random corporate noise archetypes.
    Concrete prompts are NOT generated here; they are determined dynamically inside the debate graph once chosen.
    """
    options: list[DialogueOption] = []
    items = list(discovered_intel_items or [])
    selected_intels = []

    if items:
        k = min(2, len(items))
        selected_intels = random.sample(items, k)
        for idx, item in enumerate(selected_intels, 1):
            if isinstance(item, dict):
                item_id = item.get("id")
                item_desc = item.get("categorized_description") or item.get("description", "")
                st_id = item.get("stakeholder_id")
                intel_type = (
                    item.get("intel_type")
                    or item.get("categorized_type")
                )
            else:
                item_id = getattr(item, "id", None)
                item_desc = getattr(item, "categorized_description", "") or getattr(item, "description", "")
                st_id = getattr(item, "stakeholder_id", None)
                intel_type = (
                    getattr(item, "intel_type", None)
                    or getattr(item, "categorized_type", None)
                )

            if hasattr(intel_type, "value"):
                intel_type = intel_type.value

            if not item_id:
                item_id = f"intel_{st_id}_{idx}" if st_id else f"intel_{idx}"

            st_obj = None
            if st_id:
                try:
                    st_obj = StakeholderFactory.get_stakeholder(st_id)
                except Exception:
                    st_obj = None

            if st_obj:
                st_name = st_obj.name
            elif st_id:
                st_name = " ".join([w.capitalize() for w in st_id.split("_")])
            else:
                st_name = "Stakeholder"

            options.append(
                DialogueOption(
                    id=f"opt_intel_{idx}_{uuid.uuid4().hex[:6]}",
                    type="intel",
                    text=None,
                    intel_item_id=str(item_id) if item_id else None,
                    intel_description=str(item_desc) if item_desc else None,
                    intel_stakeholder_id=str(st_id) if st_id else None,
                    intel_stakeholder_name=str(st_name) if st_name else None,
                    intel_type=str(intel_type) if intel_type else None,
                )
            )

    all_archetypes = list(EmotionFactory.get_convincer_archetypes().values())
    needed_noise = 4 - len(selected_intels)
    assigned_archetypes = random.sample(
        all_archetypes, min(needed_noise, len(all_archetypes))
    )

    for idx, arch in enumerate(assigned_archetypes, 1):
        options.append(
            DialogueOption(
                id=f"opt_noise_{idx}_{uuid.uuid4().hex[:6]}",
                type="corporate_noise",
                text=None,
                archetype=arch,
            )
        )

    random.shuffle(options)
    return options