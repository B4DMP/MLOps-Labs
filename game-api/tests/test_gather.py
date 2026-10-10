"""Gather: engagement cards buy conversations, not batches (Section 3, plan 01-intel-and-pitch-redesign)."""

from types import SimpleNamespace
from unittest.mock import patch
import pytest

from conftest import make_intel_item as _item

from mlops_serious_game.application.pitch_debate_service import chains, gather, prompts
from mlops_serious_game.domain.requirement import ConfidenceType, IntelTag


def _req(req_id, tag, target="data.validation"):
    return SimpleNamespace(id=req_id, type=tag, suggested=SimpleNamespace(target=target))


def _conv(card_id="eng_1", stakeholder_id="dave", turns_left=3, **kw):
    return gather.GatherConversation(card_id=card_id, stakeholder_id=stakeholder_id, turns_left=turns_left, **kw)


# ---------- gather_options_for ----------

def test_gather_options_for_one_to_one_meeting():
    conv = _conv(card_id="eng_1", turns_left=3)
    pool = [_req("r1", IntelTag.DRIVER, "req.acceptance_criteria"), _req("r2", IntelTag.BOUNDARY, "req.kpi_definition")]
    held = []
    opts = gather.gather_options_for(conv, held, pool, [], seed="test-seed", phase_id=1)
    # 1-to-1 meeting offers 4 options: 1 priority query + 3 component queries
    assert len(opts) == 4
    priority_opts = [o for o in opts if o.option == "priority_query"]
    comp_opts = [o for o in opts if o.option == "component_query"]
    assert len(priority_opts) == 1
    assert priority_opts[0].available is True
    assert priority_opts[0].label == "Most Important Requirement"
    assert len(comp_opts) == 3
    assert all(o.available for o in comp_opts)


def test_gather_options_one_to_one_meeting_priority_only_once():
    # Once priority_query is asked in the conversation, it cannot be asked again
    conv = _conv(card_id="eng_1", turns_left=2, turns_used=1, asked_options=["priority_query"])
    pool = [_req("r1", IntelTag.DRIVER, "req.acceptance_criteria")]
    opts = gather.gather_options_for(conv, [], pool, [], seed="test-seed", phase_id=1)
    assert len(opts) == 4
    priority_opts = [o for o in opts if o.option == "priority_query"]
    assert len(priority_opts) == 1
    assert priority_opts[0].available is False
    assert "already asked" in (priority_opts[0].reason or "").lower()


def test_resolve_priority_query_cannot_be_asked_twice():
    conv = _conv(card_id="eng_1", turns_left=2, turns_used=1, asked_options=["priority_query"])
    pool = [_req("r1", IntelTag.DRIVER, "c1")]
    out = gather.resolve_priority_query(conv, pool, set(), seed="s", stakeholder_name="Dave")
    assert out.result == "rejected"
    assert "already asked" in (out.rejected or "").lower()


def test_gather_options_unavailable_when_conversation_not_open():
    conv = _conv(card_id="eng_1", turns_left=0)
    pool = [_req("r1", IntelTag.DRIVER, "req.acceptance_criteria")]
    held = []
    opts = gather.gather_options_for(conv, held, pool, [], seed="test-seed", phase_id=1)
    assert all(o.available is False for o in opts)
    assert all("No turns left" in (o.reason or "") for o in opts)


def test_gather_options_for_team_sync_up():
    conv = _conv(card_id="eng_3", turns_left=1)
    room_pools = {
        "reuben": [_req("r1", IntelTag.DRIVER, "req.acceptance_criteria")],
        "emilia": [_req("r2", IntelTag.BOUNDARY, "ops.alerting")],
    }
    opts = gather.gather_options_for(conv, [], [], [], seed="test-seed", room_pools=room_pools, phase_id=1)
    assert all(o.option == "component_query" for o in opts)
    assert len(opts) == 4


def test_gather_options_prioritizes_undiscovered_over_discovered():
    conv = _conv(card_id="eng_1", turns_left=3)
    # Target stakeholder has 1 undiscovered item and 1 discovered item in Phase 2
    pool = [
        _req("r1", IntelTag.DRIVER, "data.validation"),
        _req("r2", IntelTag.BOUNDARY, "data.feature_store"),
    ]
    held = [_req("r2", IntelTag.BOUNDARY, "data.feature_store")]  # r2 is discovered
    opts = gather.gather_options_for(conv, held, pool, [], seed="test-seed", phase_id=2)

    comp_opts = [o for o in opts if o.option == "component_query"]
    comp_ids = [o.component_id for o in comp_opts]

    # Both components are included
    assert "data.validation" in comp_ids
    assert "data.feature_store" in comp_ids

    # Undiscovered item component comes first
    assert comp_ids.index("data.validation") < comp_ids.index("data.feature_store")


def test_gather_options_excludes_already_clicked():
    # When a component was already asked, it should not appear in subsequent options
    conv = _conv(card_id="eng_1", turns_left=2, turns_used=1, asked_options=["data.validation"])
    pool = [
        _req("r1", IntelTag.DRIVER, "data.validation"),
        _req("r2", IntelTag.BOUNDARY, "data.feature_store"),
        _req("r3", IntelTag.DRIVER, "data.ingestion"),
    ]
    opts = gather.gather_options_for(conv, [], pool, [], seed="test-seed", phase_id=2)
    comp_ids = [o.component_id for o in opts if o.option == "component_query"]

    assert "data.validation" not in comp_ids
    assert "data.feature_store" in comp_ids
    assert len(opts) == 4


def test_gather_options_includes_stakeholder_items_across_domains():
    # Stakeholder intel items across domains (e.g. data, model, ops) are included. Investigate
    # Component (eng_1) offers 3 component slots (plus the priority option), so this pool has 3
    # items - one per domain - all of which should fit.
    conv = _conv(card_id="eng_1", turns_left=1)
    pool = [
        _req("r2", IntelTag.BOUNDARY, "data.validation"),
        _req("r3", IntelTag.DRIVER, "model.training"),
        _req("r4", IntelTag.DRIVER, "ops.alerting"),
    ]
    opts = gather.gather_options_for(conv, [], pool, [], seed="test-seed", phase_id=1)
    comp_ids = [o.component_id for o in opts if o.option == "component_query"]

    assert "data.validation" in comp_ids
    assert "model.training" in comp_ids
    assert "ops.alerting" in comp_ids


def test_gather_options_team_sync_ranks_by_frequency():
    conv = _conv(card_id="eng_3", turns_left=1)
    room_pools = {
        "dave": [
            _req("r1", IntelTag.DRIVER, "data.validation"),
            _req("r2", IntelTag.DRIVER, "data.feature_store"),
        ],
        "monica": [
            _req("m1", IntelTag.DRIVER, "data.validation"),  # data.validation has count 2
        ],
    }
    opts = gather.gather_options_for(conv, [], [], [], seed="test-seed", room_pools=room_pools, phase_id=2)
    comp_opts = [o for o in opts if o.option == "component_query"]
    comp_ids = [o.component_id for o in comp_opts]

    # data.validation has 2 references, should be ranked first
    assert comp_ids[0] == "data.validation"
    assert "data.feature_store" in comp_ids


def test_gather_options_deterministic():
    conv = _conv(card_id="eng_1", turns_left=3)
    pool = [
        _req("r1", IntelTag.DRIVER, "data.validation"),
        _req("r2", IntelTag.BOUNDARY, "model.training_pipeline"),
        _req("r3", IntelTag.DRIVER, "data.feature_store"),
    ]
    opts_1 = gather.gather_options_for(conv, [], pool, [], seed="fixed-seed")
    opts_2 = gather.gather_options_for(conv, [], pool, [], seed="fixed-seed")

    assert [o.component_id for o in opts_1] == [o.component_id for o in opts_2]
    assert [o.prompt for o in opts_1] == [o.prompt for o in opts_2]


# ---------- turn resolutions ----------

def test_resolve_component_query_reveals_item():
    conv = _conv(card_id="eng_1", turns_left=3)
    pool = [_req("r1", IntelTag.DRIVER, "data.validation"), _req("r2", IntelTag.DRIVER, "model.training")]
    out = gather.resolve_component_query(
        conv, pool, set(), "data.validation", seed="s", stakeholder_name="Dave"
    )
    assert out.result == "revealed"
    assert out.item_id == "r1"
    assert out.conversation.turns_left == 2
    assert out.conversation.discovered_item_ids == ["r1"]
    assert len(out.events) == 1
    assert out.events[0].cause == "intel.revealed"


def test_resolve_team_sync_up_reveals_item_per_stakeholder():
    conv = _conv(card_id="eng_3", turns_left=1)
    room_pools = {
        "dave": [_req("r1", IntelTag.DRIVER, "data.validation")],
        "monica": [_req("r2", IntelTag.BOUNDARY, "data.validation")],
    }
    names = {"dave": "Dave", "monica": "Monica"}
    out = gather.resolve_team_sync_up(
        conv, room_pools, set(), "data.validation", seed="s", names_by_stakeholder=names
    )
    assert out.result == "revealed"
    assert set(out.item_ids) == {"r1", "r2"}
    assert len(out.events) == 2
    assert out.conversation.turns_left == 0


def test_resolve_priority_query_prefers_boundary_over_driver():
    conv = _conv(card_id="eng_1", turns_left=2)
    pool = [_req("r1", IntelTag.DRIVER, "c1"), _req("r2", IntelTag.BOUNDARY, "c2")]
    out = gather.resolve_priority_query(conv, pool, set(), seed="s", stakeholder_name="Dave")
    assert out.result == "revealed"
    assert out.item_id == "r2"  # Boundary has higher priority than Driver
    assert out.conversation.turns_left == 1


def test_close_conversation_logs_lost_turns():
    conv = _conv(card_id="eng_1", turns_left=2)
    out = gather.close_conversation(conv, "Dave")
    assert out.conversation.closed is True
    assert len(out.events) == 1
    assert out.events[0].cause == "card.turn_lost"
    assert out.events[0].params["n"] == "2"

    zero_turns = _conv(card_id="eng_1", turns_left=0)
    out_zero = gather.close_conversation(zero_turns, "Dave")
    assert out_zero.events == []


# ---------- dialogue prompts & chains ----------

def test_player_utterance_prompt_formats():
    rendered = prompts.PLAYER_UTTERANCE_PROMPT.format(
        challenge="Predictive Maintenance",
        target_stakeholder_name="Data Dave",
        target_stakeholder_role="Data Engineer",
        dialogue_option_label="Inquire about data validation",
        dialogue_option_prompt="Ask how data validation pipeline is monitored",
        component_name="Data Validation",
        history="Dave: We have pipeline alerts set up.",
        latest_statement="Dave: We have pipeline alerts set up.",
    )
    assert "Data Dave" in rendered
    assert "Inquire about data validation" in rendered
    assert "Data Validation" in rendered
    assert "Corporate Noise" not in rendered


def test_stakeholder_engagement_response_prompt_revealed():
    rendered = prompts.STAKEHOLDER_ENGAGEMENT_RESPONSE_PROMPT.format(
        stakeholder_name="Data Dave",
        stakeholder_role="Data Engineer",
        challenge="Predictive Maintenance",
        responsibilities="Maintains data quality and ingestion pipelines",
        priorities="Data consistency, low drift",
        emotion="Engaged",
        option_type="component_query",
        component_name="Data Validation",
        revealed_intel_description="All incoming data must have schema tests",
        revealed_intel_tag="Boundary",
        is_revealed=True,
        history="PM: Could you elaborate on data validation?",
        player_utterance="How do you handle schema validation?",
    )
    assert "Data Dave" in rendered
    assert "Boundary" in rendered
    assert "All incoming data must have schema tests" in rendered


def test_stakeholder_engagement_response_prompt_not_revealed():
    rendered = prompts.STAKEHOLDER_ENGAGEMENT_RESPONSE_PROMPT.format(
        stakeholder_name="Data Dave",
        stakeholder_role="Data Engineer",
        challenge="Predictive Maintenance",
        responsibilities="Data pipelines",
        priorities="Consistency",
        emotion="Neutral",
        option_type="component_query",
        component_name="",
        revealed_intel_description="",
        revealed_intel_tag="",
        is_revealed=False,
        history="",
        player_utterance="Do you have any other concerns?",
    )
    assert "Data Dave" in rendered
    assert "do not have any specific concerns" in rendered


@pytest.mark.anyio
async def test_generate_player_utterance_fallback_on_error():
    with patch("mlops_serious_game.application.pitch_debate_service.chains.get_player_utterance_chain") as mock_chain:
        mock_chain.side_effect = RuntimeError("LLM unavailable")
        utterance = await chains.generate_player_utterance(
            challenge="Predictive Maintenance",
            target_stakeholder_name="Data Dave",
            dialogue_option_prompt="How do we validate schemas?",
            default_prompt="How do we validate schemas?",
        )
        assert utterance == "How do we validate schemas?"


@pytest.mark.anyio
async def test_generate_stakeholder_response_fallback_on_error():
    with patch("mlops_serious_game.application.pitch_debate_service.chains.get_stakeholder_engagement_response_chain") as mock_chain:
        mock_chain.side_effect = RuntimeError("LLM unavailable")
        resp_revealed = await chains.generate_stakeholder_response(
            stakeholder_name="Data Dave",
            is_revealed=True,
            revealed_intel_description="Validation must run hourly.",
        )
        assert resp_revealed == "Validation must run hourly."

        resp_unrevealed = await chains.generate_stakeholder_response(
            stakeholder_name="Data Dave",
            is_revealed=False,
        )
        assert "do not have any specific concerns" in resp_unrevealed


def test_safe_stakeholder_lookups():
    from mlops_serious_game.infrastructure.websocket.handlers.gather_handler import (
        _stakeholder_name,
        _stakeholder_obj,
    )

    # System and Challenge-Intel IDs should not throw StakeholderNameNotFound
    for sys_id in ["system", "System", "__challenge_intel__"]:
        assert _stakeholder_obj(sys_id) is None
        assert _stakeholder_name(sys_id) == "System Telemetry"

    assert _stakeholder_obj("all") is None
    assert _stakeholder_name("all") == "Whole Team"

    # Non-existent stakeholder ID should not throw exception
    assert _stakeholder_obj("nonexistent_unknown_actor") is None
    assert _stakeholder_name("nonexistent_unknown_actor") == "Nonexistent Unknown Actor"


def test_resolve_component_query_reveals_all_matching_items():
    conv = _conv(card_id="eng_1", turns_left=2)
    pool = [
        _req("r1", IntelTag.DRIVER, "data.validation"),
        _req("r2", IntelTag.BOUNDARY, "data.validation"),
        _req("r3", IntelTag.FACT, "data.ingestion"),
    ]
    out = gather.resolve_component_query(
        conv, pool, set(), "data.validation", seed="s", stakeholder_name="Dave"
    )
    assert out.result == "revealed"
    assert set(out.item_ids) == {"r1", "r2"}
    assert len(out.events) == 2
    assert set(out.conversation.discovered_item_ids) == {"r1", "r2"}
    assert out.conversation.turns_left == 1


def test_resolve_team_sync_up_reveals_all_matching_items_across_stakeholders():
    conv = _conv(card_id="eng_3", turns_left=1)
    room_pools = {
        "dave": [
            _req("r1", IntelTag.DRIVER, "data.validation"),
            _req("r2", IntelTag.BOUNDARY, "data.validation"),
        ],
        "monica": [
            _req("r3", IntelTag.FACT, "data.validation"),
        ],
    }
    names = {"dave": "Dave", "monica": "Monica"}
    out = gather.resolve_team_sync_up(
        conv, room_pools, set(), "data.validation", seed="s", names_by_stakeholder=names
    )
    assert out.result == "revealed"
    assert set(out.item_ids) == {"r1", "r2", "r3"}
    assert len(out.events) == 3
    assert out.conversation.turns_left == 0


def test_select_single_stakeholder_components_undiscovered_returns_intel():
    conv = _conv(card_id="eng_1", turns_left=3, stakeholder_id="dave")
    pool = [
        _req("r1", IntelTag.DRIVER, "data.validation"),
        _req("r2", IntelTag.BOUNDARY, "data.ingestion"),
        _req("r3", IntelTag.FACT, "data.feature_store"),
        _req("r4", IntelTag.TRADE_OFF, "data.versioning"),
    ]
    opts = gather.gather_options_for(conv, held=[], pool=pool, allowed_types=[], seed="seed", phase_id=1)
    comp_opts = [o for o in opts if o.option == "component_query"]
    assert len(comp_opts) == 3
    # All 3 selected components belong to undiscovered items of Dave
    for opt in comp_opts:
        out = gather.resolve_component_query(
            conv, pool, set(), opt.component_id, seed="seed", stakeholder_name="Dave"
        )
        assert out.result == "revealed"
        assert len(out.item_ids) >= 1


def test_engagement_card_roster_after_merge():
    from mlops_serious_game.domain.engagementCardFactory import EngagementCardFactory

    ids = [c.id for c in EngagementCardFactory.get_available_cards()]
    assert "eng_2" not in ids  # merged into eng_1
    assert "eng_4" not in ids  # Ask Generic Question removed
    assert "generic_query" not in gather.GatherOptionKind.__args__

    merged = next(c for c in EngagementCardFactory.get_available_cards() if c.id == "eng_1")
    assert merged.title == "Investigate Component"
    assert merged.turns == 1
    assert merged.repeatable_target is True

    patience_reset = next(c for c in EngagementCardFactory.get_available_cards() if c.id == "eng_5")
    assert patience_reset.effect_kind == "patience_reset"
    assert patience_reset.repeatable_target is True

    pep_talk = next(c for c in EngagementCardFactory.get_available_cards() if c.id == "eng_6")
    assert pep_talk.effect_kind == "pep_talk"
    assert pep_talk.stakeholder_selection_amount == -1
    assert pep_talk.max_plays_per_phase == 1
