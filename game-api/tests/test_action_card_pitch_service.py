import pytest
from unittest.mock import AsyncMock, patch

from mlops_serious_game.application.action_card_pitch_service.nodes import (
    generate_player_pitch_node,
    generate_stakeholder_pitch_responses_node,
    sanitize_dialogue_text,
)
from mlops_serious_game.application.action_card_pitch_service.service import (
    run_action_card_pitch_workflow,
)
from mlops_serious_game.application.action_card_pitch_service.state import (
    ActionCardPitchState,
    StakeholderPitchContext,
)
from mlops_serious_game.application.pitch_debate_service import session
from mlops_serious_game.domain.graph import GraphState
from mlops_serious_game.domain.requirement import StakeholderRequirement, TargetLevel


# ---------- 1. Sanitization Tests ----------

def test_sanitize_dialogue_text_removes_speaker_prefixes_and_dashes():
    raw_1 = 'Efficiency Ellen: Neither my primary demand nor my compromise was addressed in the card.'
    assert sanitize_dialogue_text(raw_1, name_to_strip="Efficiency Ellen", st_id="efficiency_ellen") == (
        "Neither my primary demand nor my compromise was addressed in the card."
    )

    raw_2 = 'Requirements Robert: This crosses a hard boundary for me on req.risk_assessment—I cannot sign off on this.'
    assert sanitize_dialogue_text(raw_2, name_to_strip="Requirements Robert", st_id="requirements_robert") == (
        "This crosses a hard boundary for me on risk assessment, I cannot sign off on this."
    )

    raw_3 = '[Robert] I cannot accept this proposal!'
    assert sanitize_dialogue_text(raw_3, name_to_strip="Requirements Robert", st_id="requirements_robert") == (
        "I cannot accept this proposal!"
    )

    raw_4 = 'Player: "Welcome team to our resolution meeting."'
    assert sanitize_dialogue_text(raw_4) == "Welcome team to our resolution meeting."

    raw_5 = 'We completely missed req.acceptance_criteria and req.kpi_definition.'
    assert sanitize_dialogue_text(raw_5) == "We completely missed acceptance criteria and kpi definition."

    raw_6 = """I'm really concerned that the proposal overlooks automating data contracts.

(If allowed to speak a second sentence, it would be: We cannot afford to ignore this.)"""
    assert sanitize_dialogue_text(raw_6) == "I'm really concerned that the proposal overlooks automating data contracts."


# ---------- 2. Graph Distance & Primary Objection Tests ----------

def test_compute_stakeholder_primary_objection_detects_boundary_violation():
    req = StakeholderRequirement(
        id="b1",
        challenge_id=1,
        stakeholder_id="reliability_ruth",
        type="boundary",
        description="Must keep data validation >= 3",
    )
    warning = session.BoundaryWarning(
        item_id="b1",
        stakeholder_id="reliability_ruth",
        target="data.validation",
        violated=True,
    )

    res = session.compute_stakeholder_primary_objection(
        st_id="reliability_ruth",
        st_intel=[req],
        changes=[],
        card_atoms=set(),
        violated_boundaries=[warning],
    )

    assert res["objection_kind"] == "boundary"
    assert res["distance"] == 1.0
    assert res["objection_target"] == "data.validation"
    assert not res["is_approval"]


def test_compute_stakeholder_primary_objection_ranks_uncovered_drivers_and_tradeoffs():
    d1 = StakeholderRequirement(
        id="d1",
        challenge_id=1,
        stakeholder_id="data_dave",
        type="driver",
        description="Upgrade data versioning",
        suggested=TargetLevel(target="data.versioning", axis="automation", level=3),
        atoms=["raise_to(data.versioning, 3)"],
    )
    d2 = StakeholderRequirement(
        id="d2",
        challenge_id=1,
        stakeholder_id="data_dave",
        type="driver",
        description="Upgrade data validation",
        suggested=TargetLevel(target="data.validation", axis="automation", level=3),
        atoms=["raise_to(data.validation, 3)"],
    )

    # Card covers d1 but not d2
    card_atoms = {"raise_to(data.versioning, 3)"}

    res = session.compute_stakeholder_primary_objection(
        st_id="data_dave",
        st_intel=[d1, d2],
        changes=[],
        card_atoms=card_atoms,
        violated_boundaries=[],
    )

    assert res["objection_kind"] == "driver"
    assert res["objection_target"] == "data.validation"
    assert res["distance"] == 1.0
    assert not res["is_approval"]


def test_compute_stakeholder_primary_objection_returns_approval_when_fully_satisfied():
    d1 = StakeholderRequirement(
        id="d1",
        challenge_id=1,
        stakeholder_id="data_dave",
        type="driver",
        description="Upgrade data versioning",
        suggested=TargetLevel(target="data.versioning", axis="automation", level=3),
        atoms=["raise_to(data.versioning, 3)"],
    )

    card_atoms = {"raise_to(data.versioning, 3)"}

    res = session.compute_stakeholder_primary_objection(
        st_id="data_dave",
        st_intel=[d1],
        changes=[],
        card_atoms=card_atoms,
        violated_boundaries=[],
    )

    assert res["objection_kind"] == "none"
    assert res["distance"] == 0.0
    assert res["is_approval"] is True


# ---------- 3. LangGraph Workflow Tests ----------

@pytest.mark.anyio
async def test_generate_player_pitch_node_first_attempt():
    state: ActionCardPitchState = {
        "challenge_context": "Deploy High-Performance Pipeline",
        "addressed_stakeholders": "Ellen, Robert, Aaron",
        "action_card_summary": "- Upgrade Data Versioning to level 3",
        "pitch_attempt": 1,
    }

    mock_chain = AsyncMock()
    mock_chain.ainvoke.return_value = 'Player: "Welcome everyone to our resolution meeting. I propose upgrading data versioning to level 3."'

    with patch("mlops_serious_game.application.action_card_pitch_service.nodes.get_player_pitch_chain", return_value=mock_chain):
        out = await generate_player_pitch_node(state)
        assert out["player_message"] == "Welcome everyone to our resolution meeting. I propose upgrading data versioning to level 3."
        assert len(out["messages"]) == 1


@pytest.mark.anyio
async def test_generate_stakeholder_pitch_responses_node_single_response_per_stakeholder():
    stakeholders: list[StakeholderPitchContext] = [
        {
            "stakeholder_id": "efficiency_ellen",
            "stakeholder_name": "Efficiency Ellen",
            "responsibilities": "Throughput and costs",
            "priorities": "High efficiency",
            "constraints": "No cloud sprawl",
            "power": "high",
            "emotional_state": "frustrated",
            "buy_in": 0.25,
            "band": "red",
            "boundary_violated": False,
            "is_approval": False,
            "objection_kind": "trade_off",
            "objection_detail": "Neither my primary demand nor my compromise was addressed in the card.",
        },
        {
            "stakeholder_id": "requirements_robert",
            "stakeholder_name": "Requirements Robert",
            "responsibilities": "Risk and compliance",
            "priorities": "Governance",
            "constraints": "Strict audit",
            "power": "high",
            "emotional_state": "confident",
            "buy_in": 0.90,
            "band": "green",
            "boundary_violated": False,
            "is_approval": True,
            "objection_kind": "none",
            "objection_detail": "No objections.",
        },
    ]

    state: ActionCardPitchState = {
        "challenge_context": "Deploy High-Performance Pipeline",
        "player_message": "Welcome everyone. I propose we upgrade data versioning.",
        "action_card_summary": "- Upgrade Data Versioning to level 3",
        "stakeholders": stakeholders,
    }

    mock_chain = AsyncMock()
    mock_chain.ainvoke.side_effect = [
        "Efficiency Ellen: Neither my primary demand nor my compromise was addressed in this card.",
        "Requirements Robert: The proposal looks solid and addresses our requirements.",
    ]

    with patch("mlops_serious_game.application.action_card_pitch_service.nodes.get_stakeholder_pitch_chain", return_value=mock_chain):
        out = await generate_stakeholder_pitch_responses_node(state)
        responses = out["stakeholder_responses"]
        assert len(responses) == 2
        # Verify sanitization stripped the "Name: " prefix
        assert responses[0]["stakeholder_id"] == "efficiency_ellen"
        assert responses[0]["message"] == "Neither my primary demand nor my compromise was addressed in this card."
        assert responses[1]["stakeholder_id"] == "requirements_robert"
        assert responses[1]["message"] == "The proposal looks solid and addresses our requirements."


@pytest.mark.anyio
@pytest.mark.db  # the workflow's checkpointer opens a real Postgres connection
async def test_run_action_card_pitch_workflow_end_to_end():
    stakeholders: list[StakeholderPitchContext] = [
        {
            "stakeholder_id": "efficiency_ellen",
            "stakeholder_name": "Efficiency Ellen",
            "responsibilities": "Throughput and costs",
            "priorities": "High efficiency",
            "constraints": "No cloud sprawl",
            "power": "high",
            "emotional_state": "neutral",
            "buy_in": 0.50,
            "band": "amber",
            "boundary_violated": False,
            "is_approval": True,
            "objection_kind": "none",
            "objection_detail": "No objections.",
        }
    ]

    mock_player_chain = AsyncMock()
    mock_player_chain.ainvoke.return_value = "I have reconsidered our strategy and am now proposing this updated action plan."

    mock_st_chain = AsyncMock()
    mock_st_chain.ainvoke.return_value = "The proposal looks aligned with my priorities. I am on board."

    with patch("mlops_serious_game.application.action_card_pitch_service.nodes.get_player_pitch_chain", return_value=mock_player_chain), \
         patch("mlops_serious_game.application.action_card_pitch_service.nodes.get_stakeholder_pitch_chain", return_value=mock_st_chain):

        player_msg, st_resps, out_state = await run_action_card_pitch_workflow(
            username="testuser",
            phase_id=0,
            challenge_id=0,
            challenge_context="Challenge intro",
            pitch_attempt=2,
            action_card_summary="- Upgrade data validation",
            action_card_commitments=["Upgrade data validation to level 3"],
            stakeholders=stakeholders,
            addressed_stakeholders="Efficiency Ellen",
        )

        assert "reconsidered" in player_msg
        assert len(st_resps) == 1
        assert st_resps[0]["stakeholder_id"] == "efficiency_ellen"
        assert "aligned" in st_resps[0]["message"]
