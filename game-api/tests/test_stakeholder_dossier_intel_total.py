import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.intel_handler import retrieve_dossier_data
from mlops_serious_game.domain.requirement import StakeholderIntelItem, StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


def _requirement(req_id: str, challenge_id: int, stakeholder_id: str = "tess_tester") -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id,
        challenge_id=challenge_id,
        stakeholder_id=stakeholder_id,
        type="driver",
        description=f"Tess cares about {req_id}",
    )


@pytest.mark.anyio
async def test_dossier_counts_the_whole_intel_pool_found_or_not():
    StakeholderFactory.register_stakeholder(
        Stakeholder(
            id="tess_tester",
            name="Tess",
            responsibilities="Test suites",
            priorities="Coverage",
            requirements="A CI runner",
            role_description="QA Engineer",
            metric_id="data",
            convincer_archetype="Technical Excellence",
            avatar={},
        )
    )
    pool = [_requirement(f"tess_{i}", challenge_id=7) for i in range(4)]
    # Neither of these belongs to Tess in challenge 7, so neither may count toward her total.
    unrelated = [_requirement("tess_elsewhere", challenge_id=8), _requirement("dave_here", 7, "data_dave")]
    found = StakeholderIntelItem.from_requirement(pool[0])

    challenge = MagicMock()
    challenge.id = 7
    challenge.phase_id = 0
    ws = AsyncMock()
    ws.query_params = {"username": f"test_intel_total_{uuid.uuid4()}"}

    # The session lookup only feeds the convincer fields; stub it so this never touches the database.
    with patch.object(RequirementFactory, "requirements", pool + unrelated), \
         patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()), \
         patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ), \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve_intel.return_value = [found]
        dossier = await retrieve_dossier_data(challenge, ws)

    entry = next(e for e in dossier if e["stakeholder_id"] == "tess_tester")
    assert len(entry["intel_items"]) == 1
    assert entry["intel_total"] == 4
