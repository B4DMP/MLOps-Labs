"""Completability guarantee (docs/plans/graph-governance-automation-rework/00-plan.md sec 12):
every authored challenge must have at least one <=3-slot combination of its own driver/trade-off
items that keeps every high-power stakeholder in its phase out of VETO, starting from the
freshly-seeded graph with the challenge's own `on_enter_ops` applied (the practical "worst case"
approximation from sec 12.2 - no prior play has built anything up yet, but the challenge's own
world event, e.g. "the pipeline just crashed", has already fired, since that is the state the
player actually resolves from).

This is a content-coverage check, not a graph-mechanic test: a failure here means a challenge was
authored without a way to satisfy its own high-power stakeholder(s), not that the engine is wrong.
"""

import sys
from pathlib import Path

import pytest

from mlops_serious_game.application.graph_service.apply import apply_ops, replay, seed_ops
from mlops_serious_game.domain.graph import GraphOp, LoggedOp
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from content_gen.solvability import find_veto_free_card  # noqa: E402


def _has_safe_branch(graph, challenge, phase, all_intel) -> bool:
    """Whether some <=3-change card built from what this challenge's own intel names avoids a VETO
    from any high-power stakeholder in its phase, starting from the fresh-seeded graph with this
    challenge's own `on_enter_ops` applied.

    Shares `find_veto_free_card` with the content harness's gate, so the test and the generator agree
    on what "passable" means: it offers Boundary ops and every step of a composite Driver, and
    lets one card combine them."""
    room = [(ps.stakeholder_id, ps.power, ps.interest) for ps in phase.stakeholders]
    if not any(power == "high" for _, power, _ in room):
        return True  # nothing to veto with - vacuously safe
    seeded = replay(graph, [LoggedOp(seq=i, op=op) for i, op in enumerate(seed_ops(graph))]).state
    on_enter = [GraphOp.model_validate(o) for o in challenge.on_enter_ops or []]
    state = apply_ops(graph, seeded, on_enter).state
    stances = [i for i in all_intel if getattr(getattr(i, "type", None), "value", getattr(i, "type", None)) != "fact"]
    return find_veto_free_card(graph, state, stances, room) is not None


@pytest.fixture(scope="module")
def loaded_config(real):
    """Phases and requirements loaded against the same `real` graph/patterns `conftest.py`
    already provides, without going through the full `gameConfigLoader` (which also spins up
    stakeholders/personas/emotion config this test doesn't need)."""
    import json

    from mlops_serious_game.domain.metric_factory import MetricFactory
    from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

    config_dir = None
    from pathlib import Path
    for candidate in (
        Path(__file__).resolve().parent.parent.parent / "gameConfig",
        Path(__file__).resolve().parent.parent / "gameConfig",
        Path("/gameConfig"),
    ):
        if (candidate / "MlopsGraph.json").exists():
            config_dir = candidate
            break
    if config_dir is None:
        pytest.skip("gameConfig not found")

    StakeholderFactory.load_stakeholders(config_dir / "GameStakeholders.json")
    MetricFactory.load_metrics(config_dir / "GameMetrics.json")
    PhaseFactory.load_phases(config_dir / "GameProgression.json")
    RequirementFactory.load_requirements(config_dir / "RequirementObjects.json")
    return real


def test_every_challenge_has_a_safe_branch_for_its_high_power_stakeholders(loaded_config):
    real = loaded_config
    missing: list[str] = []
    for phase in PhaseFactory.get_phases():
        for challenge in phase.challenges:
            if challenge.retired:
                continue
            intel = RequirementFactory.get_requirements_for_challenge(challenge.id)
            if not _has_safe_branch(real, challenge, phase, intel):
                missing.append(f"{challenge.template_id} (challenge {challenge.id}, phase {phase.id})")
    assert missing == [], (
        "these challenges have no <=3-slot combination of their own intel that avoids a veto "
        f"from a high-power stakeholder, starting from the fresh-seeded graph: {missing}"
    )


def test_no_driver_forecloses_its_own_trade_off(loaded_config):
    """No Driver may ask for a (target, axis) level above a compromise ceiling authored elsewhere
    in its own challenge - another item's Trade-off concession/branch, or a conflict position -
    or the compromise that ceiling represents is silently ruled out for the player (see
    `foreclosed_compromises`)."""
    from mlops_serious_game.domain.requirement import foreclosed_compromises

    violations: list[str] = []
    for phase in PhaseFactory.get_phases():
        for challenge in phase.challenges:
            if challenge.retired:
                continue
            intel = RequirementFactory.get_requirements_for_challenge(challenge.id)
            for msg in foreclosed_compromises(intel, challenge.conflict):
                violations.append(f"{challenge.template_id} (challenge {challenge.id}): {msg}")
    assert violations == [], "\n".join(violations)
