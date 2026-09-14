"""Facts in the offline intel deck: voiced by a stakeholder, capped, and filed by the player's tag."""

import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mlops_serious_game.application.intel_handler import (
    ENVIRONMENT_ENTRY_ID,
    MAX_FACT_ARTIFACTS,
    MAX_STANCE_ARTIFACTS,
    deal_unconfirmed_artifacts,
    generate_offline_intel_artifacts,
    retrieve_dossier_data,
)
from mlops_serious_game.config import settings
from mlops_serious_game.domain.offline_intel_artifact import OfflineIntelArtifact
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.domain.requirement import IntelTag, StakeholderIntelItem, StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

CONFLICT_TARGET = "data.validation"


def _stance(req_id: str) -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id, challenge_id=7, stakeholder_id="tess_tester", type="driver", description=f"Tess cares about {req_id}"
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


def test_deck_deals_facts_next_to_the_stances_instead_of_cutting_them():
    stances = [_stance(f"s{i}") for i in range(4)]
    facts = [_fact(f"f{i}") for i in range(3)]
    dealt = _deal(stances + facts, [_artifact(r) for r in stances] + [_artifact(r, "tess_tester") for r in facts])

    assert dealt == ["s0", "s1", "s2", "f0", "f1"]
    assert MAX_STANCE_ARTIFACTS == 3 and MAX_FACT_ARTIFACTS == 2


def test_facts_about_the_conflict_target_are_dealt_first():
    facts = [_fact("elsewhere"), _fact("on_conflict", CONFLICT_TARGET), _fact("also_elsewhere")]
    dealt = _deal(facts, [_artifact(r, "tess_tester") for r in facts])

    assert dealt == ["on_conflict", "elsewhere"]


def test_a_fact_nobody_voices_is_not_dealt():
    fact = _fact("silent")
    assert _deal([fact], [_artifact(fact)]) == []


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
async def test_a_fact_filed_as_a_stance_sits_on_its_narrators_page_not_the_system_page():
    StakeholderFactory.register_stakeholder(_tess())
    mistaken, spotted = _fact("mistaken"), _fact("spotted")
    filed_as_driver = StakeholderIntelItem.from_requirement(mistaken, categorized_type=IntelTag.DRIVER)
    filed_as_fact = StakeholderIntelItem.from_requirement(spotted, categorized_type=IntelTag.FACT)
    for item in (filed_as_driver, filed_as_fact):
        item.discovered_phase_id = 0

    ws = AsyncMock()
    ws.query_params = {"username": f"test_offline_intel_deck_{uuid.uuid4()}"}
    artifacts = {r.id: _artifact(r, "tess_tester") for r in (mistaken, spotted)}

    with patch.object(RequirementFactory, "requirements", [mistaken, spotted]), \
         patch.dict(OfflineIntelArtifactFactory.artifacts_by_requirement, artifacts), \
         patch("mlops_serious_game.application.intel_handler.retrieve_intel_items", new_callable=AsyncMock) as mock_retrieve, \
         patch("mlops_serious_game.application.intel_handler._archived_items", return_value=[]), \
         patch("mlops_serious_game.application.intel_handler.get_session", MagicMock()), \
         patch(
             "mlops_serious_game.infrastructure.websocket.handlers.game_handler.get_or_create_game_session",
             return_value=MagicMock(stakeholder_archetypes={}),
         ), \
         patch("mlops_serious_game.domain.stakeholder_factory.StakeholderFactory.get_active_stakeholders", return_value=["tess_tester"]):
        mock_retrieve.return_value = [filed_as_driver, filed_as_fact]
        dossier = await retrieve_dossier_data(_challenge(), ws)

    tess = next(e for e in dossier if e["stakeholder_id"] == "tess_tester")
    environment = next(e for e in dossier if e["stakeholder_id"] == ENVIRONMENT_ENTRY_ID)
    assert [i["id"] for i in tess["intel_items"]] == ["mistaken"]
    assert [i["id"] for i in environment["intel_items"]] == ["spotted"]


@pytest.mark.anyio
@pytest.mark.parametrize("debug_enabled", [False, True])
async def test_the_deck_carries_the_answer_key_only_in_debug(debug_enabled):
    StakeholderFactory.register_stakeholder(_tess())
    stance, fact = _stance("deck_stance"), _fact("deck_fact")
    artifacts = {stance.id: _artifact(stance), fact.id: _artifact(fact, "tess_tester")}
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


def test_the_challenge_goes_on_record_as_the_voiced_fact_about_its_conflict_target():
    from content_gen.assemble import on_record_ids

    reqs = [
        ("ch_x", _stance("x_driver")),
        ("ch_x", _stance("x_driver_again")),
        ("ch_x", _fact("x_elsewhere")),
        ("ch_x", _fact("x_silent", CONFLICT_TARGET)),
        ("ch_x", _fact("x_conflict", CONFLICT_TARGET)),
        ("ch_x", _fact("x_conflict_again", CONFLICT_TARGET)),
    ]
    artifacts = {
        req.id: {"inputs": {} if req.id == "x_silent" else {"narrator": {"id": "tess_tester"}}}
        for _, req in reqs
    }

    assert on_record_ids(reqs, artifacts, {"ch_x": CONFLICT_TARGET}) == {"x_driver", "x_conflict"}


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


# ---------- Facts observed on leaving (plan 11, step 10) ----------

def test_observe_tagged_facts_logs_one_event_naming_how_many(monkeypatch):
    """`observe_tagged_facts` writes the graph ops as before, and now also hands back the event
    log's record of it - one event for the batch, not one per fact (plan 11, D51)."""
    from mlops_serious_game.application import intel_handler as app_intel
    from mlops_serious_game.application.graph_service import store as graph_store

    fact_item = StakeholderIntelItem(
        id="f1", challenge_id=7, type=IntelTag.FACT, categorized_type=IntelTag.FACT,
        asserts={"target": "data.ingestion", "level": 2}, description="How data.ingestion is",
    )
    row = SimpleNamespace(intel_item_data=fact_item.model_dump(mode="json"))
    fake_session = MagicMock()
    fake_session.scalars.return_value.all.return_value = [row]
    fake_session_cm = MagicMock()
    fake_session_cm.__enter__.return_value = fake_session
    fake_session_cm.__exit__.return_value = False
    monkeypatch.setattr(app_intel, "get_session", lambda: fake_session_cm)
    monkeypatch.setattr(graph_store, "has_batch", lambda username, source_id: False)
    append_calls = []
    monkeypatch.setattr(graph_store, "append_ops", lambda *a, **kw: append_calls.append((a, kw)))

    challenge = _challenge()
    events = app_intel.observe_tagged_facts(challenge, "alice")

    assert len(append_calls) == 1  # the graph op still gets written
    assert len(events) == 1
    assert events[0].cause == "graph.facts_observed"
    assert events[0].params == {"n": "1"}
    assert events[0].step == "offline"


def test_observe_tagged_facts_logs_nothing_when_there_is_nothing_to_reveal(monkeypatch):
    from mlops_serious_game.application import intel_handler as app_intel
    from mlops_serious_game.application.graph_service import store as graph_store

    fake_session = MagicMock()
    fake_session.scalars.return_value.all.return_value = []
    fake_session_cm = MagicMock()
    fake_session_cm.__enter__.return_value = fake_session
    fake_session_cm.__exit__.return_value = False
    monkeypatch.setattr(app_intel, "get_session", lambda: fake_session_cm)
    monkeypatch.setattr(graph_store, "has_batch", lambda username, source_id: False)
    monkeypatch.setattr(graph_store, "append_ops", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("must not be called")))

    assert app_intel.observe_tagged_facts(_challenge(), "alice") == []
