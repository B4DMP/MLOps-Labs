import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.intel_handler import retrieve_dossier_data
from mlops_serious_game.config import settings
from mlops_serious_game.domain.requirement import IntelTag, StakeholderIntelItem, StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


def _requirement(req_id: str) -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id,
        challenge_id=9,
        stakeholder_id="debby_debug",
        type="boundary",
        description=f"Debby will not budge on {req_id}",
    )


async def _dossier(debug_enabled: bool):
    StakeholderFactory.register_stakeholder(
        Stakeholder(
            id="debby_debug",
            name="Debby",
            responsibilities="Debugging",
            priorities="Truth",
            requirements="Logs",
            role_description="SRE",
            metric_id="data",
            convincer_archetype="Technical Excellence",
            avatar={},
        )
    )
    pool = [_requirement("debby_found"), _requirement("debby_missing")]
    # The player read the boundary as a driver, so the key has something to disagree with.
    found = StakeholderIntelItem.from_requirement(pool[0], categorized_type=IntelTag.DRIVER)

    challenge = MagicMock()
    challenge.id = 9
    challenge.phase_id = 0
    ws = AsyncMock()
    ws.query_params = {"username": f"test_dossier_debug_{uuid.uuid4()}"}

    with patch.object(settings, "ENABLE_DOSSIER_DEBUG", debug_enabled), \
         patch.object(RequirementFactory, "requirements", pool), \
         patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()), \
         patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ), \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["debby_debug"]):
        mock_retrieve_intel.return_value = [found]
        dossier = await retrieve_dossier_data(challenge, ws)
    return next(e for e in dossier if e["stakeholder_id"] == "debby_debug")


@pytest.mark.anyio
async def test_dossier_sends_no_answer_key_when_debug_is_off():
    entry = await _dossier(debug_enabled=False)
    assert "debug" not in entry
    assert all("debug" not in note for note in entry["intel_items"])


@pytest.mark.anyio
async def test_dossier_sends_the_answer_key_when_debug_is_on():
    entry = await _dossier(debug_enabled=True)
    note = entry["intel_items"][0]
    assert note["categorized_type"] == "driver"
    assert note["debug"]["correct_tag"] == "boundary"
    assert entry["debug"]["real_archetype"] == "Technical Excellence"
    assert [m["id"] for m in entry["debug"]["missing_intel"]] == ["debby_missing"]
