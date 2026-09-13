import pytest
import uuid
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.application.intel_handler import retrieve_dossier_data
from unittest.mock import MagicMock, AsyncMock, patch

@pytest.mark.anyio
async def test_stakeholder_dossier_contains_convincer_archetype():
    # Ensure StakeholderFactory has stakeholders registered
    st = Stakeholder(
        id="data_dave",
        name="Data Dave",
        responsibilities="Data pipelines",
        priorities="Data quality",
        requirements="Storage infrastructure",
        role_description="Data Engineer",
        metric_id="data",
        convincer_archetype="Technical Excellence",
        avatar={}
    )
    StakeholderFactory.register_stakeholder(st)

    mock_challenge = MagicMock()
    mock_challenge.phase_id = 0
    mock_challenge.stakeholders = []
    import uuid
    unique_user = f"test_user_{uuid.uuid4()}"
    mock_ws = AsyncMock()
    mock_ws.query_params = {"username": unique_user}

    with patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["data_dave"]):
        mock_retrieve_intel.return_value = []
        dossier = await retrieve_dossier_data(mock_challenge, mock_ws)
    
    dave_entry = next((entry for entry in dossier if entry["stakeholder_id"] == "data_dave"), None)
    assert dave_entry is not None
    assert "convincer_archetype" in dave_entry
    # Initially untagged
    assert dave_entry["convincer_archetype"] == ""
    assert dave_entry["convincer_status"] == "unknown"

    from mlops_serious_game.application.intel_handler import tag_stakeholder_convincer_archetype
    await tag_stakeholder_convincer_archetype(unique_user, "data_dave", "Technical Excellence")

    with patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["data_dave"]):
        mock_retrieve_intel.return_value = []
        dossier_tagged = await retrieve_dossier_data(mock_challenge, mock_ws)

    # A correct guess is not verified yet: only the pitch can confirm it
    dave_tagged_entry = next((entry for entry in dossier_tagged if entry["stakeholder_id"] == "data_dave"), None)
    assert dave_tagged_entry["convincer_archetype"] == "Technical Excellence"
    assert dave_tagged_entry["is_validated"] is False
    assert dave_tagged_entry["convincer_status"] == "unconfirmed"

    # So re-tagging is still allowed
    await tag_stakeholder_convincer_archetype(unique_user, "data_dave", "Business Value")
    with patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["data_dave"]):
        mock_retrieve_intel.return_value = []
        dossier_retagged = await retrieve_dossier_data(mock_challenge, mock_ws)
    dave_retagged_entry = next((entry for entry in dossier_retagged if entry["stakeholder_id"] == "data_dave"), None)
    assert dave_retagged_entry["convincer_archetype"] == "Business Value"
    assert dave_retagged_entry["convincer_status"] == "unconfirmed"

    # Once the pitch verifies it, the archetype is stamped and locked
    from mlops_serious_game.application.intel_handler import correct_and_verify_convincer_archetype
    correct_and_verify_convincer_archetype(unique_user, "data_dave")
    await tag_stakeholder_convincer_archetype(unique_user, "data_dave", "Autonomy")
    with patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["data_dave"]):
        mock_retrieve_intel.return_value = []
        dossier_locked = await retrieve_dossier_data(mock_challenge, mock_ws)

    dave_locked_entry = next((entry for entry in dossier_locked if entry["stakeholder_id"] == "data_dave"), None)
    assert dave_locked_entry["convincer_archetype"] == "Technical Excellence"
    assert dave_locked_entry["is_validated"] is True
    assert dave_locked_entry["convincer_status"] == "validated"

def test_emotion_factory_convincer_archetypes_dict():
    from mlops_serious_game.domain.emotion_factory import EmotionFactory
    archetypes = EmotionFactory.get_convincer_archetypes_dict()
    assert "Technical Excellence" in archetypes
    tech = archetypes["Technical Excellence"]
    assert tech["name"] == "Technical Excellence"
    assert tech["icon"] == "⚙️"
    assert tech["color"] == "#2563eb"
    assert "strategy" in tech


@pytest.mark.anyio
async def test_convincer_refutation_and_correction():
    from mlops_serious_game.application.intel_handler import (
        tag_stakeholder_convincer_archetype,
        correct_and_verify_convincer_archetype,
    )
    user = f"test_refute_{uuid.uuid4()}"
    # Tag data_dave with wrong archetype (Autonomy instead of Technical Excellence)
    await tag_stakeholder_convincer_archetype(user, "data_dave", "Autonomy")

    # Correct and verify
    corr = correct_and_verify_convincer_archetype(user, "data_dave")
    assert corr["stakeholder_id"] == "data_dave"
    assert corr["old_archetype"] == "Autonomy"
    assert corr["true_archetype"] == "Technical Excellence"
