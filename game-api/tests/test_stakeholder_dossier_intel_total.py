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
    ensure_test_user(username)
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(username)}

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
async def test_a_mistagged_narrated_fact_does_not_change_the_stakeholders_total():
    """A Fact has no stakeholder of its own - only a narrator - so it never shows up in
    `get_requirements_for_stakeholder_in_challenge`. Filed as a stance (mistagged, or simply not
    yet corrected) it lands on its narrator's page anyway (`speaker_of`), so the pool that page's
    `intel_total` is drawn from has to count it too - otherwise the total grows the moment the
    player (mis)tags it and shrinks back once they fix the tag, instead of staying the fixed,
    authored number it is meant to be."""
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
    ensure_test_user(username)
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(username)}

    # Mistagged: the player filed the Fact as a driver, the way an unconfirmed narrated Fact
    # (nothing marks it as a Fact until the player says so) is easy to misread as a stance.
    mistagged_fact = StakeholderIntelItem.from_requirement(fact, categorized_type="driver")
    found = StakeholderIntelItem.from_requirement(driver)

    with patch.object(RequirementFactory, "requirements", [driver, fact]), \
         patch.object(OfflineIntelArtifactFactory, "artifacts_by_requirement", {"tess_fact": artifact}), \
         patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve_intel, \
         patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()), \
         patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ), \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve_intel.return_value = [found, mistagged_fact]
        mistagged_dossier = await retrieve_dossier_data(challenge, ws)

        correctly_tagged_fact = StakeholderIntelItem.from_requirement(fact, categorized_type="fact")
        mock_retrieve_intel.return_value = [found, correctly_tagged_fact]
        corrected_dossier = await retrieve_dossier_data(challenge, ws)

    mistagged_entry = next(e for e in mistagged_dossier if e["stakeholder_id"] == "tess_tester")
    corrected_entry = next(e for e in corrected_dossier if e["stakeholder_id"] == "tess_tester")

    # Both the real Driver and the mistagged Fact sit on Tess's page while it is mistagged.
    assert len(mistagged_entry["intel_items"]) == 2
    # Corrected, the Fact moves to the System page, leaving only the real Driver.
    assert len(corrected_entry["intel_items"]) == 1
    # The total (2: the Driver plus the one Fact Tess narrates) never changes either way.
    assert mistagged_entry["intel_total"] == 2
    assert corrected_entry["intel_total"] == 2
