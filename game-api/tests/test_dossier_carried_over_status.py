"""A note whose challenge has already passed is never "open" for the current one (Dossier
phase scoping): the graph either shows its condition was met (DONE / "addressed") or it wasn't
and the moment for it has gone (OUT OF DATE / "stale"). See `carried_over_status`."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.intel_handler import (
    carried_over_status,
    retrieve_dossier_data,
)
from mlops_serious_game.application.services.auth_service import PLAYER_COOKIE_NAME, _create_player_token
from mlops_serious_game.domain.requirement import StakeholderIntelItem, StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

DUMMY_SNAPSHOT = ("graph", "state", "evaluation")


def _driver(req_id: str, challenge_id: int = 3) -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id,
        challenge_id=challenge_id,
        stakeholder_id="tess_tester",
        type="driver",
        description=f"Tess wants {req_id}",
        suggested={"target": "deploy.cicd", "level": 3, "axis": "automation"},
    )


def _fact(req_id: str, challenge_id: int = 3) -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id,
        challenge_id=challenge_id,
        stakeholder_id=None,
        type="fact",
        description=f"The system says {req_id}",
        asserts={"target": "deploy.cicd", "level": 2, "axis": "automation"},
    )


def test_driver_condition_met_reads_as_addressed():
    item = StakeholderIntelItem.from_requirement(_driver("tess_driver"))
    with patch("mlops_serious_game.application.intel_handler._effective_level", return_value=4):
        assert carried_over_status(item, DUMMY_SNAPSHOT) == "addressed"


def test_driver_condition_unmet_reads_as_stale():
    item = StakeholderIntelItem.from_requirement(_driver("tess_driver"))
    with patch("mlops_serious_game.application.intel_handler._effective_level", return_value=1):
        assert carried_over_status(item, DUMMY_SNAPSHOT) == "stale"


def test_fact_still_true_reads_as_addressed():
    item = StakeholderIntelItem.from_requirement(_fact("sys_fact"))
    with patch("mlops_serious_game.application.intel_handler._effective_level", return_value=2):
        assert carried_over_status(item, DUMMY_SNAPSHOT) == "addressed"


def test_fact_no_longer_true_reads_as_stale():
    item = StakeholderIntelItem.from_requirement(_fact("sys_fact"))
    with patch("mlops_serious_game.application.intel_handler._effective_level", return_value=0):
        assert carried_over_status(item, DUMMY_SNAPSHOT) == "stale"


def test_no_graph_snapshot_defaults_to_stale_not_open():
    item = StakeholderIntelItem.from_requirement(_driver("tess_driver"))
    assert carried_over_status(item, None) == "stale"


@pytest.mark.anyio
async def test_dossier_marks_a_previous_challenges_item_done_not_open():
    """The screenshot bug: an earlier challenge's trade-off kept showing as an active, open
    stance while playing a later challenge. It should collapse into DONE/OUT OF DATE instead."""
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
    carried_req = _driver("tess_old_driver", challenge_id=3)
    carried_item = StakeholderIntelItem.from_requirement(carried_req)
    carried_item.discovered_phase_id = 0

    current_req = _driver("tess_new_driver", challenge_id=7)
    current_item = StakeholderIntelItem.from_requirement(current_req)

    challenge = MagicMock()
    challenge.id = 7
    challenge.phase_id = 1
    challenge.conflict = None
    challenge.focus_stage_ids = ["deploy"]
    from conftest import ensure_test_user

    ws = AsyncMock()
    username = f"test_carried_over_status_{uuid.uuid4()}"
    ensure_test_user(username)
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(username)}

    with patch.object(RequirementFactory, "requirements", [carried_req, current_req]), \
         patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve, \
         patch("mlops_serious_game.application.intel_handler._archived_items", return_value=[carried_item]), \
         patch("mlops_serious_game.application.intel_handler._graph_snapshot", return_value=DUMMY_SNAPSHOT), \
         patch("mlops_serious_game.application.intel_handler._effective_level", return_value=1), \
         patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()), \
         patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ), \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve.return_value = [current_item]
        dossier = await retrieve_dossier_data(challenge, ws)

    tess = next(e for e in dossier if e["stakeholder_id"] == "tess_tester")
    by_id = {i["id"]: i for i in tess["intel_items"]}

    # Unmet condition (_effective_level=1 < suggested level 3), from a previous challenge: stale,
    # never the plain "open" an active stance would get.
    assert by_id["tess_old_driver"]["status"] == "stale"
    # This challenge's own item keeps the ordinary open/addressed/stale read.
    assert by_id["tess_new_driver"]["status"] == "open"
