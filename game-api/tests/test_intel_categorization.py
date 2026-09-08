import pytest
from mlops_serious_game.application.online_intel_service.nodes import _format_revealed_intel_item
from mlops_serious_game.domain.prompts import STAKEHOLDER_CHARACTER_CARD, ONLINE_INTEL_STAKEHOLDER_PROMPT
from mlops_serious_game.domain.requirement import RequirementType


def test_format_revealed_intel_item_negotiable_preference():
    item = {
        "categorized_type": RequirementType.NEGOTIABLE_PREFERENCE,
        "description": "Automation Alex prefers containers and Docker for runtime packaging consistency.",
    }
    formatted = _format_revealed_intel_item(item)
    assert "Negotiable Preference" in formatted
    assert "NOT non-negotiable" in formatted
    assert "Automation Alex prefers containers and Docker for runtime packaging consistency." in formatted


def test_format_revealed_intel_item_core_requirement():
    item = {
        "categorized_type": "requirement",
        "description": "Deployment templates must use standard IaC declarations.",
    }
    formatted = _format_revealed_intel_item(item)
    assert "Core Requirement" in formatted
    assert "mandatory" in formatted


def test_format_revealed_intel_item_personal_friction():
    item = {
        "categorized_type": "personal_friction",
        "description": "Automation Alex is frustrated when custom platform designs ignore operational automation.",
    }
    formatted = _format_revealed_intel_item(item)
    assert "Personal Friction" in formatted
    assert "interpersonal tension" in formatted


def test_prompts_contain_stance_category_consistency():
    card_prompt = STAKEHOLDER_CHARACTER_CARD.prompt
    assert "STANCE CATEGORY CONSISTENCY" in card_prompt
    assert "NEVER claim, imply, or state that a negotiable preference is non-negotiable" in card_prompt

    online_prompt = ONLINE_INTEL_STAKEHOLDER_PROMPT.prompt
    assert "NEVER state or imply that a negotiable preference is non-negotiable" in online_prompt


@pytest.mark.anyio
async def test_determine_intel_items_node_engagement_card():
    from mlops_serious_game.application.online_intel_service.nodes import determine_intel_items_node
    from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.domain.requirement_factory import RequirementFactory

    assert len(EngagementCardFactory.cards) > 0
    card = EngagementCardFactory.cards[0]

    phases = PhaseFactory.get_phases()
    challenge = phases[0].challenges[0]
    reqs = RequirementFactory.get_requirements_for_challenge(challenge.id)
    assert len(reqs) > 0
    stakeholder_id = reqs[0].stakeholder_id

    state = {
        "phase_id": 0,
        "challenge_id": 0,
        "challenge": challenge.description,
        "card_id": card.id,
        "stakeholder_ids": [stakeholder_id],
    }

    result = await determine_intel_items_node(state)
    assert "revealed_intel_by_stakeholder" in result
    revealed = result["revealed_intel_by_stakeholder"]
    assert stakeholder_id in revealed
    for item in revealed[stakeholder_id]:
        assert "id" in item
        assert "description" in item
        assert "categorized_type" in item


@pytest.mark.anyio
async def test_retag_challenge_specific_stance_updates_description():
    import uuid
    from unittest.mock import AsyncMock
    from mlops_serious_game.application.intel_handler import handle_intel_tagging, retrieve_dossier_data
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.domain.requirement import RequirementType
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory

    all_reqs = RequirementFactory.get_requirements()
    target_req = next((r for r in all_reqs if r.id == "req_2_data_dave_negotiable_preference_26"), None)
    if not target_req:
        target_req = all_reqs[0]
    challenge = PhaseFactory.get_challenge_by_id(target_req.challenge_id)

    unique_user = f"test_retag_user_{uuid.uuid4()}"
    mock_ws = AsyncMock()
    mock_ws.query_params = {"username": unique_user}

    # Tag as requirement (miscategorized)
    item1 = await handle_intel_tagging(challenge, mock_ws, target_req.id, RequirementType.REQUIREMENT.value)
    dossier1 = await retrieve_dossier_data(challenge, mock_ws)
    st_entry1 = next((s for s in dossier1 if s["stakeholder_id"] == target_req.stakeholder_id), None)
    intel_entry1 = next((i for i in st_entry1["intel_items"] if i["id"] == target_req.id), None)
    assert intel_entry1 is not None

    wrong_req_desc = OfflineIntelArtifactFactory.get_wrong_description(target_req.id, "requirement")
    if wrong_req_desc:
        assert intel_entry1["description"] == wrong_req_desc

    # Re-tag as personal_friction (different miscategorization)
    item2 = await handle_intel_tagging(challenge, mock_ws, target_req.id, RequirementType.PERSONAL_FRICTION.value)
    dossier2 = await retrieve_dossier_data(challenge, mock_ws)
    st_entry2 = next((s for s in dossier2 if s["stakeholder_id"] == target_req.stakeholder_id), None)
    intel_entry2 = next((i for i in st_entry2["intel_items"] if i["id"] == target_req.id), None)
    assert intel_entry2 is not None

    wrong_friction_desc = OfflineIntelArtifactFactory.get_wrong_description(target_req.id, "personal_friction")
    if wrong_friction_desc:
        assert intel_entry2["description"] == wrong_friction_desc
        if wrong_req_desc:
            assert intel_entry2["description"] != intel_entry1["description"]

    # Re-tag back to true type (negotiable_preference)
    true_type_val = target_req.type.value if hasattr(target_req.type, "value") else str(target_req.type)
    item3 = await handle_intel_tagging(challenge, mock_ws, target_req.id, true_type_val)
    dossier3 = await retrieve_dossier_data(challenge, mock_ws)
    st_entry3 = next((s for s in dossier3 if s["stakeholder_id"] == target_req.stakeholder_id), None)
    intel_entry3 = next((i for i in st_entry3["intel_items"] if i["id"] == target_req.id), None)
    assert intel_entry3 is not None
    assert intel_entry3["description"] == target_req.description


