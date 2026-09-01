
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
from typing import List, Dict, Any
import random

from fastapi import WebSocket
from sqlalchemy import select

from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.application.pitch_debate_service.chains import (
    get_wrong_intel_chain,
    get_intel_artifact_chain,
)
from mlops_serious_game.infrastructure.database import IntelItem, get_session


async def generate_intel_item_artifact_content(
    curr_challenge: Challenge,
    intel_item: StakeholderIntelItem,
    artifact_type: ArtifactType = ArtifactType.EMAIL,
) -> str:
    """Generates the content of an intel item artifact based on the stakeholder's stance."""
    req = RequirementFactory.get_requirement(intel_item.requirement_id)
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
    temp_item = StakeholderIntelItem(
        id=str(uuid.uuid4()),
        requirement_id=req.id,
        intel_type=ConfidenceType.UNCONFIRMED,
        categorized_type=req.type,
        description=req.description
    )
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


async def generate_offline_intel_artifacts(curr_challenge: Challenge) -> List[Dict[str, Any]]:
    """Loads 5 offline intel artifacts from OfflineIntelArtifactFactory for the offline intel gathering phase."""
    reqs = select_reqs_for_offl_intel_gathering(curr_challenge)
    results = []
    missing_reqs = []

    for req in reqs:
        pre_artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(req.id)
        if pre_artifact:
            stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
            results.append({
                "id": pre_artifact.id,
                "requirement_id": req.id,
                "stakeholder_id": req.stakeholder_id,
                "stakeholder_name": stakeholder.name,
                "stakeholder_role": stakeholder.role_description,
                "artifact_type": pre_artifact.artifact_type.value if isinstance(pre_artifact.artifact_type, ArtifactType) else str(pre_artifact.artifact_type),
                "content": pre_artifact.content,
            })
        else:
            missing_reqs.append(req)

    if missing_reqs:
        artifact_types = list(ArtifactType)
        tasks = [
            _generate_single_artifact(curr_challenge, req, random.choice(artifact_types))
            for req in missing_reqs
        ]
        fallback_results = await asyncio.gather(*tasks)
        results.extend(list(fallback_results))

    return results


from sqlalchemy.orm.attributes import flag_modified

async def store_intel_item(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Stores or updates an intel item in the database."""
    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == ws.query_params["username"])
        ).all()

        target_record = None
        for record in records:
            if isinstance(record.intel_item_data, dict):
                req_id = record.intel_item_data.get("requirement_id")
                item_id = record.intel_item_data.get("id")
                if req_id == intel_item.requirement_id or (intel_item.id and item_id == intel_item.id):
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
                req = RequirementFactory.get_requirement(item.requirement_id)
                if req and req.challenge_id == curr_challenge.id:
                    intel_items.append(item)

    return intel_items


async def handle_intel_item_categorization(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Handles the categorization of intel items using pre-generated descriptions when available."""
    req = RequirementFactory.get_requirement(intel_item.requirement_id)
    if intel_item.categorized_type == req.type:
        intel_item.description = req.description
    else:
        wrong_desc = OfflineIntelArtifactFactory.get_wrong_description(
            intel_item.requirement_id,
            intel_item.categorized_type.value if hasattr(intel_item.categorized_type, "value") else str(intel_item.categorized_type)
        )
        if wrong_desc:
            intel_item.description = wrong_desc
        else:
            intel_item.description = await create_wrong_intel_item_description(curr_challenge, intel_item)
    await store_intel_item(curr_challenge, ws, intel_item)

async def create_wrong_intel_item_description(curr_challenge: Challenge, intel_item: StakeholderIntelItem) -> str:
    """Creates a wrong description for the given intel item"""
    req = RequirementFactory.get_requirement(intel_item.requirement_id)
    stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
    stakeholder_name = stakeholder.name
    stakeholder_profile = (
        f"Responsibilities: {stakeholder.responsibilities}, Priorities: {stakeholder.priorities}"
    )

    chain = get_wrong_intel_chain()
    res = await chain.ainvoke({
        "challenge": curr_challenge.description,
        "stakeholder_name": stakeholder_name,
        "stakeholder_profile": stakeholder_profile,
        "correct_description": req.description,
        "categorized_type": intel_item.categorized_type.value
    })
    return res.strip()


async def generate_and_save_all_offline_intel_artifacts() -> Dict[str, Any]:
    """Generates offline intel artifacts and all possible miscategorizations for all requirements and saves to config."""
    from pathlib import Path
    import json
    from mlops_serious_game.domain.gameConfigLoader import GameConfigLoader

    all_reqs = RequirementFactory.get_requirements()
    if not all_reqs:
        return {"status": "error", "message": "No requirement objects found to generate artifacts for."}

    artifact_types = list(ArtifactType)
    semaphore = asyncio.Semaphore(10)

    async def _process_requirement(req: StakeholderRequirement) -> Dict[str, Any]:
        async with semaphore:
            curr_challenge = PhaseFactory.get_challenge_by_id(req.challenge_id)
            if not curr_challenge:
                phases = PhaseFactory.get_phases()
                curr_challenge = phases[0].challenges[0]
            
            stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
            art_type = random.choice(artifact_types)

            temp_item = StakeholderIntelItem(
                id=str(uuid.uuid4()),
                requirement_id=req.id,
                intel_type=ConfidenceType.UNCONFIRMED,
                categorized_type=req.type,
                description=req.description
            )

            # 1. Generate main artifact content
            try:
                content = await generate_intel_item_artifact_content(curr_challenge, temp_item, art_type)
            except Exception as e:
                print(f"[Offline Intel Generator Warning] Content generation failed for {req.id}: {e}")
                content = f"Stakeholder Note from {stakeholder.name} ({stakeholder.role_description}): {req.description}"

            # 2. Generate wrong descriptions for all 3 miscategorizations
            wrong_descriptions: Dict[str, str] = {}
            possible_types = [t for t in RequirementType if t != req.type]

            for wrong_type in possible_types:
                temp_wrong_item = StakeholderIntelItem(
                    id=str(uuid.uuid4()),
                    requirement_id=req.id,
                    intel_type=ConfidenceType.UNCONFIRMED,
                    categorized_type=wrong_type,
                    description=""
                )
                try:
                    wrong_desc = await create_wrong_intel_item_description(curr_challenge, temp_wrong_item)
                except Exception as e:
                    print(f"[Offline Intel Generator Warning] Wrong desc generation failed for {req.id} ({wrong_type.value}): {e}")
                    wrong_desc = f"Misinterpreted Stance regarding {curr_challenge.name}: {req.description}"
                
                wrong_descriptions[wrong_type.value] = wrong_desc

            return {
                "id": f"art_{req.id}",
                "requirement_id": req.id,
                "challenge_id": req.challenge_id,
                "stakeholder_id": req.stakeholder_id,
                "stakeholder_name": stakeholder.name,
                "stakeholder_role": stakeholder.role_description,
                "artifact_type": art_type.value,
                "content": content,
                "wrong_descriptions": wrong_descriptions
            }

    tasks = [_process_requirement(req) for req in all_reqs]
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
    existing_item = next((item for item in collected_items if item.requirement_id == requirement_id), None)

    if existing_item:
        item_conf = existing_item.intel_type.value if hasattr(existing_item.intel_type, "value") else str(existing_item.intel_type)
        if item_conf.lower() != "unconfirmed":
            return existing_item
        existing_item.categorized_type = RequirementType(categorized_type)
        intel_item = existing_item
    else:
        intel_item = StakeholderIntelItem(
            id=str(uuid.uuid4()),
            requirement_id=requirement_id,
            intel_type=ConfidenceType.UNCONFIRMED,
            categorized_type=RequirementType(categorized_type),
            description=""
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
        (item for item in collected_items if item.id == intel_item_id or item.requirement_id == intel_item_id),
        None
    )
    req = None
    if target_item:
        req = RequirementFactory.get_requirement(target_item.requirement_id)
    else:
        req = RequirementFactory.get_requirement(intel_item_id)
        if not req:
            all_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
            req = next((r for r in all_reqs if r.id == intel_item_id), None)

        if not req:
            return {"status": "error", "message": f"Intel requirement '{intel_item_id}' not found."}

        target_item = StakeholderIntelItem(
            id=str(uuid.uuid4()),
            requirement_id=req.id,
            intel_type=ConfidenceType.UNCONFIRMED,
            categorized_type=req.type,
            description=req.description,
        )

    stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id) if req else None

    old_categorized_type = (
        target_item.categorized_type.value
    )
    true_categorized_type = req.type.value if (req and hasattr(req.type, "value")) else (str(req.type) if req else old_categorized_type)

    # Perform verification & correction
    target_item.intel_type = ConfidenceType.VERIFIED
    target_item.categorized_type = req.type
    target_item.description = req.description

    await store_intel_item(curr_challenge, ws, target_item)

    return {
        "status": "success",
        "old_categorized_type": old_categorized_type,
        "true_categorized_type": true_categorized_type,
        "requirement_id": target_item.requirement_id,
        "stakeholder_name": stakeholder.name,
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
            if isinstance(record.intel_item_data, dict):
                r_id = record.intel_item_data.get("requirement_id")
                item_id = record.intel_item_data.get("id")
                if r_id == requirement_id or item_id == requirement_id:
                    target_record = record
                    break

        cat_type_str = req.type.value if hasattr(req.type, "value") else str(req.type)

        if target_record:
            data = dict(target_record.intel_item_data)
            data["intel_type"] = ConfidenceType.VERIFIED.value
            data["categorized_type"] = cat_type_str
            data["description"] = req.description
            target_record.intel_item_data = data
            flag_modified(target_record, "intel_item_data")
            session.commit()
            return StakeholderIntelItem(**data)
        else:
            new_item = StakeholderIntelItem(
                id=str(uuid.uuid4()),
                requirement_id=req.id,
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


async def retrieve_dossier_data(curr_challenge: Challenge, ws: WebSocket) -> List[Dict[str, Any]]:
    """Retrieves full dossier summary data for all stakeholders in the current challenge."""
    collected_items = await retrieve_intel_items(curr_challenge, ws)
    
    stakeholder_intel_map: Dict[str, List[Dict[str, Any]]] = {}
    for item in collected_items:
        req = RequirementFactory.get_requirement(item.requirement_id)
        if req:
            st_id = req.stakeholder_id
            if st_id not in stakeholder_intel_map:
                stakeholder_intel_map[st_id] = []
            intel_type_val = item.intel_type.value if hasattr(item.intel_type, "value") else str(item.intel_type)
            cat_type_val = item.categorized_type.value if hasattr(item.categorized_type, "value") else str(item.categorized_type)
            stakeholder_intel_map[st_id].append({
                "id": item.id,
                "requirement_id": item.requirement_id,
                "intel_type": intel_type_val,
                "categorized_type": cat_type_val,
                "description": item.description,
            })

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
        dossier_list.append({
            "stakeholder_id": st.id,
            "name": st.name,
            "responsibilities": st.responsibilities,
            "priorities": st.priorities,
            "constraints": getattr(st, 'constraints', getattr(st, 'requirements', "")),
            "role_description": st.role_description,
            "metric_id": st.metric_id,
            "convincer_archetype": getattr(st, 'convincer_archetype', ''),
            "power": ch_st.power if ch_st else "low",
            "interest": ch_st.interest if ch_st else "low",
            "intel_items": intel_entries,
        })

    return dossier_list