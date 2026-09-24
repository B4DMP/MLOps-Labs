"""Refinement chains in the persistent dossier (plan 05, steps 5 to 7)."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.services.auth_service import PLAYER_COOKIE_NAME, _create_player_token
from mlops_serious_game.application.intel_handler import (
    ENVIRONMENT_ENTRY_ID,
    chain_index,
    locked_links_ahead,
    retrieve_dossier_data,
    stage_of_target,
    _graph_snapshot,
)
from mlops_serious_game.domain.requirement import StakeholderIntelItem, StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


def _requirement(req_id: str, **kw) -> StakeholderRequirement:
    fields = {
        "id": req_id,
        "challenge_id": 7,
        "stakeholder_id": "tess_tester",
        "type": "driver",
        "description": f"Tess cares about {req_id}",
    }
    fields.update(kw)
    return StakeholderRequirement(**fields)


def _item(req_id: str, phase: int = 0, **kw) -> StakeholderIntelItem:
    item = StakeholderIntelItem.from_requirement(_requirement(req_id, **kw))
    item.discovered_phase_id = phase
    return item


def test_chain_index_names_the_chain_after_its_oldest_link():
    first = _item("tess_1", phase=0)
    second = _item("tess_2", phase=2, refines_id="tess_1")
    index = chain_index([second, first])

    assert index["tess_1"]["chain_id"] == "tess_1"
    assert index["tess_2"]["chain_id"] == "tess_1"
    assert index["tess_1"]["chain_position"] == 0
    assert index["tess_2"]["chain_position"] == 1
    assert index["tess_2"]["chain_length"] == 2
    # The newest link is the headline, so it is the one the builder offers.
    assert index["tess_2"]["chain_newest"] is True
    assert index["tess_1"]["chain_newest"] is False


def test_an_item_on_its_own_is_a_chain_of_one():
    index = chain_index([_item("tess_alone")])
    assert index["tess_alone"] == {
        "chain_id": "tess_alone",
        "chain_position": 0,
        "chain_length": 1,
        "chain_newest": True,
    }


def test_locked_links_counts_every_authored_refinement_still_out_there():
    successors = {"tess_1": ["tess_2"], "tess_2": ["tess_3"]}
    assert locked_links_ahead("tess_1", {"tess_1"}, successors) == 2
    assert locked_links_ahead("tess_2", {"tess_1", "tess_2"}, successors) == 1
    assert locked_links_ahead("tess_3", {"tess_3"}, successors) == 0


def test_stage_of_target_names_the_stage_a_target_sits_in():
    snapshot = _graph_snapshot(f"chain_stage_probe_{uuid.uuid4()}")
    if snapshot is None:
        pytest.skip("no graph configured in this environment")
    graph = snapshot[0]
    component = graph.components[0]
    assert stage_of_target(snapshot, component.id) == (
        component.stage_id,
        graph.stage(component.stage_id).name,
    )
    assert stage_of_target(snapshot, None) == (None, None)


@pytest.mark.anyio
async def test_dossier_chains_stances_and_pages_facts_separately():
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
    first = _item("tess_1", phase=0)
    second = _item("tess_2", phase=0, refines_id="tess_1")
    # A Fact the player filed as a Fact belongs to the environment, not to anybody's page.
    fact = _item("sys_1", stakeholder_id=None, type="fact", asserts={"target": "model.evaluation"})

    challenge = MagicMock()
    challenge.id = 7
    challenge.phase_id = 0
    challenge.conflict = None
    challenge.focus_stage_ids = ["model"]
    ws = AsyncMock()
    username = f"test_dossier_chains_{uuid.uuid4()}"
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(username)}

    pool = [_requirement("tess_1"), _requirement("tess_2", refines_id="tess_1")]
    with patch.object(RequirementFactory, "requirements", pool), \
         patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve, \
         patch("mlops_serious_game.application.intel_handler._archived_items", return_value=[]), \
         patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()), \
         patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ), \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve.return_value = [first, second, fact]
        dossier = await retrieve_dossier_data(challenge, ws)

    tess = next(e for e in dossier if e["stakeholder_id"] == "tess_tester")
    assert {i["id"] for i in tess["intel_items"]} == {"tess_1", "tess_2"}
    assert {i["chain_id"] for i in tess["intel_items"]} == {"tess_1"}
    assert tess["focus_stage_ids"] == ["model"]

    environment = next(e for e in dossier if e["stakeholder_id"] == ENVIRONMENT_ENTRY_ID)
    assert environment["is_environment"] is True
    assert [i["id"] for i in environment["intel_items"]] == ["sys_1"]


@pytest.mark.anyio
async def test_dossier_does_not_leak_trade_off_branches_for_boundary_item():
    from mlops_serious_game.domain.requirement import TradeOffBranch, ConfidenceType, IntelTag

    # A boundary requirement that accidentally still carries trade-off branches
    boundary_req = _requirement("reuben_boundary", type="boundary", stakeholder_id="tess_tester")
    item = StakeholderIntelItem.from_requirement(
        boundary_req,
        intel_type=ConfidenceType.VERIFIED,
        categorized_type=IntelTag.BOUNDARY,
    )
    # Simulate leftover branch_x and branch_y from prior trade-off miscategorization
    item.branch_x = TradeOffBranch(name="X", description="automating kpi definitions")
    item.branch_y = TradeOffBranch(name="Y", description="maintaining basic data contracts")

    challenge = MagicMock()
    challenge.id = 7
    challenge.phase_id = 0
    challenge.conflict = None
    challenge.focus_stage_ids = ["model"]
    ws = AsyncMock()
    username = f"test_boundary_branches_{uuid.uuid4()}"
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(username)}

    with patch.object(RequirementFactory, "requirements", [boundary_req]), \
         patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve, \
         patch("mlops_serious_game.application.intel_handler._archived_items", return_value=[]), \
         patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()), \
         patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ), \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve.return_value = [item]
        dossier = await retrieve_dossier_data(challenge, ws)

    tess = next(e for e in dossier if e["stakeholder_id"] == "tess_tester")
    boundary_entry = next(i for i in tess["intel_items"] if i["id"] == "reuben_boundary")
    assert boundary_entry["categorized_type"] == "boundary"
    assert boundary_entry["branch_x"] is None
    assert boundary_entry["branch_y"] is None

