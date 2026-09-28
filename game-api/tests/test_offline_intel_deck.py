"""The offline intel deck: capped stances only for tagging, Facts only as known Challenge-Intel."""

import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.intel_handler import (
    CHALLENGE_INTEL_ENTRY_ID,
    MAX_STANCE_ARTIFACTS,
    deal_unconfirmed_artifacts,
    generate_offline_intel_artifacts,
    retrieve_dossier_data,
)
from mlops_serious_game.application.services.auth_service import PLAYER_COOKIE_NAME, _create_player_token
from mlops_serious_game.config import settings
from mlops_serious_game.domain.offline_intel_artifact import OfflineIntelArtifact
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.domain.requirement import IntelTag, StakeholderIntelItem, StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

CONFLICT_TARGET = "data.validation"


def _stance(req_id: str, stakeholder_id: str = "tess_tester", target: str | None = None) -> StakeholderRequirement:
    payload = {"suggested": {"target": target, "axis": "automation", "level": 3}} if target else {}
    return StakeholderRequirement(
        id=req_id, challenge_id=7, stakeholder_id=stakeholder_id, type="driver",
        description=f"{stakeholder_id} cares about {req_id}", **payload,
    )


def _fact(req_id: str, target: str = "data.ingestion") -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id, challenge_id=7, stakeholder_id=None, type="fact", description=f"How {target} is",
        asserts={"target": target, "level": 2},
    )


def _artifact(req: StakeholderRequirement, narrator_id=None) -> OfflineIntelArtifact:
    return OfflineIntelArtifact(
        id=f"art_{req.id}", requirement_id=req.id, challenge_id=7, stakeholder_id=req.stakeholder_id,
        narrator_id=narrator_id, artifact_type="email", content="...", is_known=False,
    )


def _challenge():
    challenge = MagicMock()
    challenge.id = 7
    challenge.phase_id = 0
    challenge.conflict = MagicMock(target=CONFLICT_TARGET, positions=[])
    challenge.focus_stage_ids = ["data"]
    return challenge


def _deal(reqs, artifacts):
    by_id = {r.id: r for r in reqs}
    with patch.object(RequirementFactory, "get_requirement", side_effect=by_id.get):
        return [a.requirement_id for a in deal_unconfirmed_artifacts(_challenge(), artifacts)]


def test_deck_deals_only_stances_and_never_a_fact_to_tag():
    stances = [_stance(f"s{i}") for i in range(4)]
    facts = [_fact(f"f{i}", CONFLICT_TARGET) for i in range(3)]
    dealt = _deal(stances + facts, [_artifact(r) for r in stances] + [_artifact(r, "tess_tester") for r in facts])

    assert dealt == ["s0", "s1", "s2"]
    assert MAX_STANCE_ARTIFACTS == 3


def test_a_deck_of_only_facts_deals_nothing():
    facts = [_fact("elsewhere"), _fact("on_conflict", CONFLICT_TARGET)]
    assert _deal(facts, [_artifact(r, "tess_tester") for r in facts]) == []


def test_a_voiced_fact_is_named_after_its_narrator():
    StakeholderFactory.register_stakeholder(_tess())
    art = _artifact(_fact("voiced"), narrator_id="tess_tester")

    rendered = OfflineIntelArtifactFactory._personalized(art)
    assert art.speaker_id == "tess_tester"
    assert rendered.stakeholder_name == "Tess"


def _tess() -> Stakeholder:
    return Stakeholder(
        id="tess_tester", name="Tess", responsibilities="Test suites", priorities="Coverage",
        requirements="A CI runner", role_description="QA Engineer", metric_id="data",
        convincer_archetype="Technical Excellence", avatar={},
    )


@pytest.mark.anyio
async def test_a_known_fact_shows_up_under_challenge_intel_and_stances_stay_on_their_page():
    StakeholderFactory.register_stakeholder(_tess())
    stance, known = _stance("held_stance"), _fact("known_fact")
    stance_item = StakeholderIntelItem.from_requirement(stance, categorized_type=IntelTag.DRIVER)
    fact_item = StakeholderIntelItem.from_requirement(known, categorized_type=IntelTag.FACT)
    for item in (stance_item, fact_item):
        item.discovered_phase_id = 0

    from conftest import ensure_test_user

    ws = AsyncMock()
    username = f"test_offline_intel_deck_{uuid.uuid4()}"
    ensure_test_user(username)
    ws.cookies = {PLAYER_COOKIE_NAME: _create_player_token(username)}
    artifacts = {
        stance.id: _artifact(stance),
        known.id: _artifact(known, "tess_tester").model_copy(update={"is_known": True}),
    }
    other_fact = _fact("unreachable_fact")
    artifacts[other_fact.id] = _artifact(other_fact, "tess_tester")

    with patch.object(RequirementFactory, "requirements", [stance, known, other_fact]),          patch.dict(OfflineIntelArtifactFactory.artifacts_by_requirement, artifacts),          patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve,          patch("mlops_serious_game.application.intel_handler._archived_items", return_value=[]),          patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()),          patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ),          patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve.return_value = [stance_item, fact_item]
        dossier = await retrieve_dossier_data(_challenge(), ws)

    tess = next(e for e in dossier if e["stakeholder_id"] == "tess_tester")
    challenge_intel = next(e for e in dossier if e["stakeholder_id"] == CHALLENGE_INTEL_ENTRY_ID)
    assert [i["id"] for i in tess["intel_items"]] == ["held_stance"]
    assert [i["id"] for i in challenge_intel["intel_items"]] == ["known_fact"]
    # Facts never count towards a stakeholder page; only known Facts count on Challenge-Intel.
    assert tess["intel_total"] == 1
    assert challenge_intel["intel_total"] == 1


@pytest.mark.anyio
@pytest.mark.parametrize("debug_enabled", [False, True])
async def test_the_deck_carries_the_answer_key_only_in_debug(debug_enabled):
    StakeholderFactory.register_stakeholder(_tess())
    stance, fact = _stance("deck_stance"), _fact("deck_fact")
    artifacts = {
        stance.id: _artifact(stance),
        fact.id: _artifact(fact, "tess_tester").model_copy(update={"is_known": True}),
    }
    by_id = {r.id: r for r in (stance, fact)}

    with patch.object(settings, "ENABLE_DOSSIER_DEBUG", debug_enabled), \
         patch.dict(OfflineIntelArtifactFactory.artifacts_by_requirement, artifacts), \
         patch.object(RequirementFactory, "get_requirement", side_effect=by_id.get), \
         patch.object(StakeholderFactory, "get_active_stakeholders", return_value=[]), \
         patch("mlops_serious_game.application.intel_handler.PhaseFactory.get_phases", return_value=[]):
        deck = await generate_offline_intel_artifacts(_challenge())

    by_req = {card["requirement_id"]: card for card in deck}
    assert set(by_req) == {"deck_stance", "deck_fact"}
    if debug_enabled:
        assert by_req["deck_fact"]["debug"]["correct_tag"] == "fact"
        assert by_req["deck_stance"]["debug"]["correct_tag"] == "driver"
    else:
        assert all("debug" not in card for card in deck)


@pytest.mark.anyio
async def test_the_on_record_fact_leads_the_deck():
    StakeholderFactory.register_stakeholder(_tess())
    stance, fact = _stance("record_stance"), _fact("record_fact", CONFLICT_TARGET)
    # Config order puts the stance first; the challenge itself still has to lead.
    artifacts = {
        stance.id: _artifact(stance).model_copy(update={"is_known": True}),
        fact.id: _artifact(fact, "tess_tester").model_copy(update={"is_known": True}),
    }
    by_id = {r.id: r for r in (stance, fact)}

    with patch.dict(OfflineIntelArtifactFactory.artifacts_by_requirement, artifacts), \
         patch.object(RequirementFactory, "get_requirement", side_effect=by_id.get), \
         patch.object(StakeholderFactory, "get_active_stakeholders", return_value=[]), \
         patch("mlops_serious_game.application.intel_handler.PhaseFactory.get_phases", return_value=[]):
        deck = await generate_offline_intel_artifacts(_challenge())

    assert [(c["requirement_id"], c["categorized_type"]) for c in deck] == [
        ("record_fact", "fact"), ("record_stance", "driver"),
    ]


def test_the_challenge_goes_on_record_as_both_conflicting_stances_and_the_voiced_fact():
    from content_gen.assemble import on_record_ids

    reqs = [
        ("ch_x", _stance("x_emma_driver", "emma", CONFLICT_TARGET)),
        ("ch_x", _stance("x_emma_driver_again", "emma", CONFLICT_TARGET)),
        ("ch_x", _stance("x_dave_boundary", "dave", CONFLICT_TARGET)),
        ("ch_x", _stance("x_bystander", "bystander", CONFLICT_TARGET)),
        ("ch_x", _stance("x_emma_elsewhere", "emma", "data.ingestion")),
        ("ch_x", _fact("x_elsewhere")),
        ("ch_x", _fact("x_silent", CONFLICT_TARGET)),
        ("ch_x", _fact("x_conflict", CONFLICT_TARGET)),
        ("ch_x", _fact("x_conflict_again", CONFLICT_TARGET)),
    ]
    artifacts = {
        req.id: {"inputs": {} if req.id == "x_silent" else {"narrator": {"id": "tess_tester"}}}
        for _, req in reqs
    }

    known = on_record_ids(
        reqs, artifacts,
        {"ch_x": CONFLICT_TARGET},
        {"ch_x": {"emma", "dave"}},
    )
    assert known == {"x_emma_driver", "x_dave_boundary", "x_conflict"}


def test_a_trade_off_stance_counts_by_its_branch_target_not_just_asserts_or_suggested():
    from content_gen.assemble import on_record_ids

    # A Trade-off carries its target on branch_x/branch_y, not on any field item_target reads
    # directly - this is the losing side of a "hard"/"soft" conflict, e.g. ch_shadow_deployment_contract.
    trade_off = StakeholderRequirement(
        id="x_dave_tradeoff", challenge_id=7, stakeholder_id="dave", type="trade_off",
        description="Dave would accept less if pushed",
        branch_x={"target": CONFLICT_TARGET, "axis": "governance", "level": 3},
        branch_y={"target": CONFLICT_TARGET, "axis": "automation", "level": 2},
    )
    reqs = [
        ("ch_x", _stance("x_emma_driver", "emma", CONFLICT_TARGET)),
        ("ch_x", trade_off),
    ]
    artifacts = {req.id: {"inputs": {"narrator": {"id": "tess_tester"}}} for _, req in reqs}

    known = on_record_ids(
        reqs, artifacts,
        {"ch_x": CONFLICT_TARGET},
        {"ch_x": {"emma", "dave"}},
    )
    assert known == {"x_emma_driver", "x_dave_tradeoff"}


def test_a_conflict_stakeholder_with_no_target_matched_stance_still_goes_on_record():
    from content_gen.assemble import on_record_ids

    # Some authored Trade-offs only concede a metric (concedes.metric_id/loss), with no
    # concedes.target and no ops at all - nothing structural ties them to the conflict target,
    # even though they are that stakeholder's only stance in the challenge (ch_shadow_deployment_contract).
    untargeted = StakeholderRequirement(
        id="x_dave_untargeted", challenge_id=7, stakeholder_id="dave", type="trade_off",
        description="Dave would give up automation for this", concedes={"metric_id": "automation", "loss": 3},
    )
    reqs = [
        ("ch_x", _stance("x_emma_driver", "emma", CONFLICT_TARGET)),
        ("ch_x", untargeted),
    ]
    artifacts = {req.id: {"inputs": {"narrator": {"id": "tess_tester"}}} for _, req in reqs}

    known = on_record_ids(
        reqs, artifacts,
        {"ch_x": CONFLICT_TARGET},
        {"ch_x": {"emma", "dave"}},
    )
    assert known == {"x_emma_driver", "x_dave_untargeted"}


# ---- content generation: who voices a Fact, and how ----

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from content_gen.ledger import WorkItem  # noqa: E402
from content_gen.stages.artifacts import ARTIFACT_TYPES, ArtifactsStage, artifact_type, narrator_for  # noqa: E402

ROOM = [
    {"stakeholder_id": "data_dave", "name": "Dave", "role": "Data Engineer"},
    {"stakeholder_id": "reliability_ruth", "name": "Ruth", "role": "SRE"},
]


def _graph(owner):
    return SimpleNamespace(is_target=lambda t: True, owner_of=lambda t: owner)


def test_the_owner_of_what_a_fact_describes_narrates_it():
    assert narrator_for(_fact("owned"), ROOM, _graph("reliability_ruth"))["id"] == "reliability_ruth"


def test_a_fact_whose_owner_is_not_in_the_room_gets_a_stable_voice_from_the_room():
    first = narrator_for(_fact("unowned"), ROOM, _graph("model_monica"))
    assert first["id"] in {"data_dave", "reliability_ruth"}
    assert narrator_for(_fact("unowned"), ROOM, _graph("model_monica")) == first


def test_facts_come_in_the_same_formats_as_stances():
    assert ARTIFACT_TYPES == ["email", "slack_message", "meeting_notes", "document"]
    assert artifact_type("gen_any_fact") in ARTIFACT_TYPES


def _fact_output(content: str) -> dict:
    return {"content": content, "reclassified_as": "fact", "reclassify_reason": "states how things are"}


BODY = ("The validation step runs by hand every morning. Two people open the export, compare row counts "
        "against yesterday and mark the batch as checked in the tracker. Last week three batches went "
        "through without a check because the tracker was down. The export itself finishes at six and the "
        "check usually starts around nine, after the standup.")


@pytest.mark.parametrize("opening, flagged", [
    ("I am logging the current state of validation for the record. ", True),
    ("Quick status update on validation. ", True),
    ("This is how the registry functions right now. ", True),
    ("I am noting that the export runs late. ", True),
    ("Just wanted to flag something from the logs. ", True),
    ("He did not suggest any changes, just described the current reality. ", True),
    ("This is the observed state of the data flow right now. ", True),
    ("", False),
])
def test_a_fact_that_announces_itself_as_a_report_is_rejected(opening, flagged):
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "email"})
    errors = ArtifactsStage().check(_fact_output(opening + BODY), item, SimpleNamespace(stakeholders={}))
    assert any("announces a report" in e for e in errors) is flagged


def test_a_fact_that_judges_the_work_is_rejected():
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "email"})
    ctx = SimpleNamespace(stakeholders={})
    assert any("judgement" in e for e in ArtifactsStage().check(
        _fact_output(BODY + " It is tedious and prone to copy errors."), item, ctx))
    assert not any("judgement" in e for e in ArtifactsStage().check(_fact_output(BODY), item, ctx))


# Envelope lines the assembled content was full of: IntelArtifactViewer already draws the channel,
# the sender and the date, so a header inside the body shows the player the same chrome twice.
@pytest.mark.parametrize("opening", [
    "Slack from Dave:\n",
    "Email from Monica:\n",
    "Email from Dave to Team:\n",
    "Meeting Notes - QA Standup:\n",
    "Document - Budget Allocation memo:\n",
    "Subject: data validation\n",
    "Internal memo\n",
])
def test_an_artifact_that_labels_its_own_channel_is_rejected(opening):
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "email"})
    errors = ArtifactsStage().check(_fact_output(opening + BODY), item, SimpleNamespace(stakeholders={}))
    assert any("header line" in e or "write the body only" in e for e in errors)


def test_a_body_that_is_one_paragraph_of_prose_is_accepted():
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "email"})
    errors = ArtifactsStage().check(_fact_output(BODY), item, SimpleNamespace(stakeholders={}))
    assert not any("write the body only" in e or "header line" in e or "quotation marks" in e for e in errors)


def test_a_transcript_prefix_and_a_quoted_body_are_rejected():
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "meeting_notes"})
    ctx = SimpleNamespace(stakeholders={})
    spoken = ArtifactsStage().check(_fact_output("Ruth: " + BODY), item, ctx)
    assert any("prefixes the body with a speaker" in e for e in spoken)
    quoted = ArtifactsStage().check(_fact_output("'" + BODY + "'"), item, ctx)
    assert any("quotation marks" in e for e in quoted)


# GAME_RULES hands every stage the level scale; only this stage used to repeat it to the player.
@pytest.mark.parametrize("line, flagged", [
    ("Ingestion must remain stable at or above level 2.", True),
    ("The KPI definitions sit at level 0 today.", True),
    ("We keep risk assessment at manual level 2.", True),
    ("Nobody has taken it past level one.", True),
    # Ordinary English in a paragraph of prose, which the shared gate would have rejected.
    ("If monitoring does not reach that level of maturity, I will not sign off.", False),
    ("There is no rejection mechanism active at the gateway level right now.", False),
    ("Models are assisting with pre-labeling at this stage.", False),
])
def test_an_artifact_that_names_a_maturity_level_is_rejected(line, flagged):
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "email"})
    errors = ArtifactsStage().check(_fact_output(BODY + " " + line), item, SimpleNamespace(stakeholders={}))
    assert any("level scale" in e for e in errors) is flagged


def test_an_artifact_never_talks_about_the_game_graph():
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "email"})
    text = BODY + " The registry is absent from the infrastructure graph."
    errors = ArtifactsStage().check(_fact_output(text), item, SimpleNamespace(stakeholders={}))
    assert any("game model" in e for e in errors)


# Lines that slipped past the checks in the first Deployment facts.
@pytest.mark.parametrize("line, problem", [
    ("This is the current configuration for our CI/CD workflow.", "announces a report"),
    ("This is the existing setup I am working with today.", "announces a report"),
    ("I am just documenting how the link is set up.", "announces a report"),
    ("The two components exist separately.", "game model"),
    ("The edge between them is not present.", "game model"),
    ("I observe the gap in the topology map.", "game model"),
    ("This is the current operational reality for that link.", "announces a report"),
    ("The endpoint remains in this state within the live environment.", "announces a report"),
    ("The system operates in a state where output is unverified.", "announces a report"),
    ("The governance link is set up that way in the current system.", "announces a report"),
    ("I am walking through the workflow to document the actual steps.", "announces a report"),
    ("I have no further observations to add at this time.", "announces a report"),
    ("That is the specific edge in our pipeline.", "game model"),
])
def test_report_closers_and_graph_words_from_deployment_facts_are_rejected(line, problem):
    item = WorkItem("artifacts", "artifacts:gen_x", {"requirement": {"type": "fact"}, "artifact_type": "email"})
    errors = ArtifactsStage().check(_fact_output(BODY + " " + line), item, SimpleNamespace(stakeholders={}))
    assert any(problem in e for e in errors)


@pytest.mark.parametrize("artifact_type_, flagged", [("slack_message", True), ("meeting_notes", False)])
def test_a_narrator_never_names_themselves_except_in_meeting_notes(artifact_type_, flagged):
    item = WorkItem("artifacts", "artifacts:gen_x", {
        "requirement": {"type": "fact"},
        "artifact_type": artifact_type_,
        "narrator": {"id": "data_dave", "name": "Dave", "role": "Data Engineer"},
    })
    ctx = SimpleNamespace(stakeholders={})
    errors = ArtifactsStage().check(_fact_output(BODY + " {data_dave} counted them."), item, ctx)
    assert any("refer to them as I" in e for e in errors) is flagged
