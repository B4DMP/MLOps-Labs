"""What the challenge's opening event broke is always on the record, and never held back as edge intel.

The player has to be able to read what happened (the Challenge-Intel page), including when the world
event broke a hand-off and the conflict is about the component beside it. No database.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from mlops_serious_game.application.intel_handler import is_edge_requirement
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement import StakeholderRequirement
from mlops_serious_game.domain.requirement_factory import RequirementFactory

ROOMS = [c for p in PhaseFactory.get_phases() if not p.demo for c in p.challenges if not c.retired]


def _fact(req_id: str, target: str) -> StakeholderRequirement:
    return StakeholderRequirement(
        id=req_id, challenge_id=7, type="fact", description="A fact",
        asserts={"target": target, "axis": "automation", "level": 0},
    )


def test_the_broken_target_goes_on_record_even_when_the_conflict_is_about_something_else():
    from content_gen.assemble import on_record_ids

    reqs = [
        ("ch_x", _fact("x_conflict_target", "ops.performance_monitoring")),
        ("ch_x", _fact("x_broken_edge", "e.perf_alert")),
        ("ch_x", _fact("x_broken_edge_again", "e.perf_alert")),
        ("ch_x", _fact("x_elsewhere", "data.ingestion")),
    ]
    artifacts = {req.id: {"inputs": {"narrator": {"id": "tess_tester"}}} for _, req in reqs}

    known = on_record_ids(
        reqs, artifacts, {"ch_x": "ops.performance_monitoring"}, {"ch_x": set()},
        {"ch_x": {"e.perf_alert"}},
    )
    assert known == {"x_conflict_target", "x_broken_edge"}


def test_a_hand_set_par_survives_re_assembly():
    from content_gen.assemble import carry_tuning

    generated = [{"template_id": "ch_a"}, {"template_id": "ch_b", "par_outcome": "PASS"}, {"template_id": "ch_new"}]
    previous = [
        {"template_id": "ch_a", "par_outcome": "SOFT_PASS"},
        {"template_id": "ch_b", "par_outcome": "SOFT_PASS"},
    ]
    carry_tuning(generated, previous)
    assert generated == [
        {"template_id": "ch_a", "par_outcome": "SOFT_PASS"},
        {"template_id": "ch_b", "par_outcome": "PASS"},
        {"template_id": "ch_new"},
    ]


def test_an_incident_fact_on_an_edge_is_not_held_back_as_edge_intel():
    incident = RequirementFactory.get_requirement("gen_silent_forecast_failure_fact_perf_broken")
    assert incident.asserts.target == "e.perf_alert"
    assert not is_edge_requirement(incident)


def test_other_edge_intel_is_still_held_back():
    stance = RequirementFactory.get_requirement("gen_silent_forecast_failure_ruth_pipeline_driver")
    assert is_edge_requirement(stance)
    other_fact = RequirementFactory.get_requirement("gen_silent_forecast_failure_fact_alerting_none")
    assert not is_edge_requirement(other_fact)  # a component fact: never an edge anyway


@pytest.mark.parametrize("challenge", ROOMS, ids=lambda c: c.template_id)
def test_every_room_has_what_its_opening_event_broke_on_record(challenge):
    broken = {op["target"] for op in challenge.on_enter_ops}
    on_record = [
        r for r in RequirementFactory.get_requirements_for_challenge(challenge.id)
        if r.type == "fact" and r.asserts is not None and r.asserts.target in broken
        and (OfflineIntelArtifactFactory.get_artifact_for_requirement(r.id) or None) is not None
        and OfflineIntelArtifactFactory.get_artifact_for_requirement(r.id).is_known
    ]
    assert on_record, f"{challenge.template_id}: nothing about {sorted(broken)} is on record at the start"
