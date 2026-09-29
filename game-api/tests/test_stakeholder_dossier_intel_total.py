import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.intel_handler import retrieve_dossier_data
from mlops_serious_game.application.services.auth_service import PLAYER_COOKIE_NAME, _create_player_token
from mlops_serious_game.domain.offline_intel_artifact import OfflineIntelArtifact
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
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


def _narrated_fact(req_id: str, challenge_id: int, narrator_id: str) -> StakeholderRequirement:
    """A Fact (no stakeholder of its own) voiced by `narrator_id` - the artifact carries the
    narrator, the requirement's own `stakeholder_id` stays None, exactly like real content."""
    return StakeholderRequirement(
        id=req_id,
        challenge_id=challenge_id,
        stakeholder_id=None,
        type="fact",
        description=f"The system does something about {req_id}",
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
    from conftest import ensure_test_user

    ws = AsyncMock()
    username = f"test_intel_total_{uuid.uuid4()}"
    user_id = ensure_test_user(username)
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(user_id)}

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


@pytest.mark.anyio
async def test_narrated_facts_never_count_towards_a_stakeholders_total():
    """Facts live on the Challenge-Intel page, so a narrated Fact is neither shown on nor counted
    for its narrator's page, whatever tag it carries."""
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
    driver = _requirement("tess_driver", challenge_id=7)
    fact = _narrated_fact("tess_fact", challenge_id=7, narrator_id="tess_tester")
    artifact = OfflineIntelArtifact(
        id="art_tess_fact",
        requirement_id="tess_fact",
        challenge_id=7,
        stakeholder_id=None,
        narrator_id="tess_tester",
        artifact_type="email",
        content="An email about the system.",
        is_known=False,
    )

    challenge = MagicMock()
    challenge.id = 7
    challenge.phase_id = 0
    from conftest import ensure_test_user

    ws = AsyncMock()
    username = f"test_narrated_fact_{uuid.uuid4()}"
    user_id = ensure_test_user(username)
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(user_id)}

    # Whatever tag it carries, a Fact (true type) is never a stakeholder-page item.
    fact_item = StakeholderIntelItem.from_requirement(fact, categorized_type="driver")
    found = StakeholderIntelItem.from_requirement(driver)

    with patch.object(RequirementFactory, "requirements", [driver, fact]),          patch.object(OfflineIntelArtifactFactory, "artifacts_by_requirement", {"tess_fact": artifact}),          patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel,          patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()),          patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ),          patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve_intel.return_value = [found, fact_item]
        dossier = await retrieve_dossier_data(challenge, ws)

    entry = next(e for e in dossier if e["stakeholder_id"] == "tess_tester")
    assert [i["id"] for i in entry["intel_items"]] == ["tess_driver"]
    assert entry["intel_total"] == 1
    # The Fact is not known from the start, so it is not counted for Challenge-Intel either.
    challenge_intel = next(e for e in dossier if e["stakeholder_id"] == "__challenge_intel__")
    assert challenge_intel["intel_total"] == 0
