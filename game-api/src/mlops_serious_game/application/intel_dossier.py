
from langchain_core.utils import uuid
from mlops_serious_game.domain.requirement import StakeholderIntelItemArtifact, ArtifactType
from typing import List
import random

from fastapi import WebSocket
from sqlalchemy import select

from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.requirement import StakeholderIntelItem, StakeholderRequirement
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


async def store_intel_item(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Stores an intel item to the database."""
    with get_session() as session:
        record = IntelItem(
            user_name=ws.query_params.get("username", "guest"),
            intel_item_data=intel_item.model_dump()
        )
        session.add(record)


async def retrieve_intel_items(curr_challenge: Challenge, ws: WebSocket) -> List[StakeholderIntelItem]:
    """Retrieves intel items for the current challenge."""
    intel_items: List[StakeholderIntelItem] = []

    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_name == ws.query_params.get("username", "guest"))
        ).all()

        for record in records:
            data = record.intel_item_data
            if isinstance(data, dict):
                item = StakeholderIntelItem(**data)
                req = RequirementFactory.get_requirement(item.requirement_id)
                if req and req.challenge_id == curr_challenge.id:
                    intel_items.append(item)

    return intel_items



async def handle_intel_item_categorization(curr_challenge:Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """handles the categorization of intel items"""
    if intel_item.categorized_type==RequirementFactory.get_requirement(intel_item.requirement_id).type:
        intel_item.description=RequirementFactory.get_requirement(intel_item.requirement_id).description
    else:
        intel_item.description=await create_wrong_intel_item_description(curr_challenge, intel_item)
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