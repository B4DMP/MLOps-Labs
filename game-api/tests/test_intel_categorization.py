import pytest
from mlops_serious_game.domain.prompts import STAKEHOLDER_CHARACTER_CARD
from mlops_serious_game.domain.requirement import IntelTag, describe_tag

# Needs a real Postgres connection (not mocked) - excluded from CI via `-m "not db"`,
# runs locally/in docker-compose where Postgres is actually available.
pytestmark = pytest.mark.db



def test_driver_is_never_described_as_a_hard_line():
    assert "can be talked into less" in describe_tag("driver")
    assert "refuse" in describe_tag("boundary")


def test_unknown_tag_reads_as_driver():
    assert describe_tag("requirement") == describe_tag("driver")


def test_prompts_contain_stance_category_consistency():
    card_prompt = STAKEHOLDER_CHARACTER_CARD.prompt
    assert "STANCE CATEGORY CONSISTENCY" in card_prompt
    assert "NEVER claim, imply, or state that a Driver is non-negotiable" in card_prompt
    assert "negotiable preference" not in card_prompt.lower()


@pytest.mark.anyio
async def test_retag_challenge_specific_stance_updates_description():
    import uuid
    from unittest.mock import AsyncMock
    from mlops_serious_game.application.services.auth_service import PLAYER_COOKIE_NAME, _create_player_token
    from mlops_serious_game.application.intel_handler import handle_intel_tagging, retrieve_dossier_data
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.domain.requirement import IntelTag, join_wording
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory

    all_reqs = RequirementFactory.get_requirements()
    # A stance from whatever is in gameConfig. The id this used to name belonged to the hand written
    # challenges, which are gone, and generated ids move on every regeneration.
    target_req = next((r for r in all_reqs if r.type != IntelTag.FACT and r.stakeholder_id), all_reqs[0])
    challenge = PhaseFactory.get_challenge_by_id(target_req.challenge_id)
    import sqlalchemy
    from mlops_serious_game.config import settings

    try:
        url = sqlalchemy.engine.make_url(settings.POSTGRES_URI)
        with sqlalchemy.create_engine(url).connect():
            pass
    except Exception:
        pytest.skip("Postgres is not reachable")

    from conftest import ensure_test_user

    unique_user = f"test_retag_user_{uuid.uuid4()}"
    user_id = ensure_test_user(unique_user)
    mock_ws = AsyncMock()
    mock_ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(user_id)}

    # The first wrong tag is the other plain stance, where the dossier shows the item's stored
    # reading for that tag. The second is Trade-off, which goes down the branch inventing path and
    # gets its wording from the model, so it is only checked for being different.
    wrong_1 = IntelTag.DRIVER if target_req.type == IntelTag.BOUNDARY else IntelTag.BOUNDARY
    wrong_2 = IntelTag.TRADE_OFF

    # Tag it wrong once
    item1 = await handle_intel_tagging(challenge, mock_ws, target_req.id, wrong_1.value)
    dossier1 = await retrieve_dossier_data(challenge, mock_ws)
    st_entry1 = next((s for s in dossier1 if s["stakeholder_id"] == target_req.stakeholder_id), None)
    intel_entry1 = next((i for i in st_entry1["intel_items"] if i["id"] == target_req.id), None)
    assert intel_entry1 is not None

    wrong_req_desc = OfflineIntelArtifactFactory.get_wrong_description(target_req.id, wrong_1.value)
    if wrong_req_desc:
        assert intel_entry1["description"] == join_wording(target_req.fact, wrong_req_desc)

    # Re-tag wrong a different way
    item2 = await handle_intel_tagging(challenge, mock_ws, target_req.id, wrong_2.value)
    dossier2 = await retrieve_dossier_data(challenge, mock_ws)
    st_entry2 = next((s for s in dossier2 if s["stakeholder_id"] == target_req.stakeholder_id), None)
    intel_entry2 = next((i for i in st_entry2["intel_items"] if i["id"] == target_req.id), None)
    assert intel_entry2 is not None

    assert intel_entry2["description"]
    assert intel_entry2["description"] != intel_entry1["description"]
    assert intel_entry2["description"] != target_req.description

    # Re-tag back to the true tag
    true_type_val = target_req.type.value if hasattr(target_req.type, "value") else str(target_req.type)
    item3 = await handle_intel_tagging(challenge, mock_ws, target_req.id, true_type_val)
    dossier3 = await retrieve_dossier_data(challenge, mock_ws)
    st_entry3 = next((s for s in dossier3 if s["stakeholder_id"] == target_req.stakeholder_id), None)
    intel_entry3 = next((i for i in st_entry3["intel_items"] if i["id"] == target_req.id), None)
    assert intel_entry3 is not None
    assert intel_entry3["description"] == target_req.description




@pytest.mark.anyio
async def test_handle_intel_tagging_rejects_the_fact_tag():
    from unittest.mock import AsyncMock
    from mlops_serious_game.application.intel_handler import handle_intel_tagging

    with pytest.raises(ValueError, match="Facts cannot be tagged"):
        await handle_intel_tagging(AsyncMock(), AsyncMock(), "any_req", IntelTag.FACT.value)


@pytest.mark.anyio
async def test_handle_tag_item_refuses_a_fact_tag_before_tagging():
    from unittest.mock import AsyncMock, patch
    from mlops_serious_game.infrastructure.websocket.handlers import intel_handler as ws_intel

    with patch.object(ws_intel, "handle_intel_tagging", new_callable=AsyncMock) as tagging, \
         patch.object(ws_intel, "_item_in_reach", new_callable=AsyncMock, return_value=True), \
         patch.object(ws_intel, "manager") as manager:
        manager.send_event = AsyncMock()
        await ws_intel.handle_tag_item(
            AsyncMock(), "alice", {"phase_id": 1, "challenge_id": 0, "intel_id": "r1", "categorized_type": "fact"}
        )

    tagging.assert_not_called()
    assert manager.send_event.await_args.kwargs["event"] == "system:error"
