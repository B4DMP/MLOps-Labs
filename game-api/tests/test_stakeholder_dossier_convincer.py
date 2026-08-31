import pytest
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.application.intel_dossier import retrieve_dossier_data
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
    mock_ws = AsyncMock()
    mock_ws.query_params = {"username": "test_user"}

    with patch("mlops_serious_game.application.intel_dossier.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["data_dave"]):
        mock_retrieve_intel.return_value = []
        dossier = await retrieve_dossier_data(mock_challenge, mock_ws)
    
    dave_entry = next((entry for entry in dossier if entry["stakeholder_id"] == "data_dave"), None)
    assert dave_entry is not None
    assert "convincer_archetype" in dave_entry
    assert dave_entry["convincer_archetype"] == "Technical Excellence"
