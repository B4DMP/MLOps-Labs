
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
from mlops_serious_game.application.conversation_service.workflow.chains import (
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
    """Generates 5 random intel artifacts in parallel for the offline intel gathering phase."""
    reqs = select_reqs_for_offl_intel_gathering(curr_challenge)
    artifact_types = list(ArtifactType)
    tasks = [
        _generate_single_artifact(curr_challenge, req, random.choice(artifact_types))
        for req in reqs
    ]
    results = await asyncio.gather(*tasks)
    return list(results)


async def store_intel_item(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Stores or updates an intel item in the database."""
    with get_session() as session:
        record = IntelItem(
            user_name=ws.query_params["username"],
            intel_item_data=intel_item.model_dump()
        )
        session.add(record)
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
    """handles the categorization of intel items"""
    req = RequirementFactory.get_requirement(intel_item.requirement_id)
    if intel_item.categorized_type == req.type:
        intel_item.description = req.description
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


async def handle_intel_tagging(
    curr_challenge: Challenge,
    ws: WebSocket,
    requirement_id: str,
    categorized_type: str,
) -> StakeholderIntelItem:
    """Processes tagging of an intel artifact by the player, creating an unconfirmed intel item."""
    req = RequirementFactory.get_requirement(requirement_id)
    intel_item = StakeholderIntelItem(
        id=str(uuid.uuid4()),
        requirement_id=requirement_id,
        intel_type=ConfidenceType.UNCONFIRMED,
        categorized_type=RequirementType(categorized_type),
        description=""
    )

    await handle_intel_item_categorization(curr_challenge, ws, intel_item)
    return intel_item


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
            stakeholder_intel_map[st_id].append({
                "id": item.id,
                "requirement_id": item.requirement_id,
                "intel_type": item.intel_type.value,
                "categorized_type": item.categorized_type.value,
                "description": item.description,
            })

    dossier_list = []
    active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id)
    if not active_st_ids:
        active_st_ids = StakeholderFactory.get_available_stakeholders()
        
    for st_id in active_st_ids:
        st = StakeholderFactory.get_stakeholder(st_id)
        if not st:
            continue
        intel_entries = stakeholder_intel_map.get(st_id, [])
        dossier_list.append({
            "stakeholder_id": st.id,
            "name": st.name,
            "responsibilities": st.responsibilities,
            "priorities": st.priorities,
            "constraints": getattr(st, 'constraints', getattr(st, 'requirements', "")),
            "role_description": st.role_description,
            "metric_id": st.metric_id,
            "intel_items": intel_entries,
        })

    return dossier_list