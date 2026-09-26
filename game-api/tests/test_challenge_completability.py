"""Completability guarantee (docs/plans/graph-governance-automation-rework/00-plan.md sec 12):
every authored challenge must have at least one <=3-slot combination of its own driver/trade-off
items that keeps every high-power stakeholder in its phase out of VETO, starting from the
freshly-seeded graph (the practical "worst case" approximation from sec 12.2 - no prior play has
built anything up yet).

This is a content-coverage check, not a graph-mechanic test: a failure here means a challenge was
authored without a way to satisfy its own high-power stakeholder(s), not that the engine is wrong.
"""

import itertools

import pytest

from mlops_serious_game.application.graph_service.apply import replay, seed_ops
from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.graph import LoggedOp
from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory

MAX_SLOTS = 3


def _candidate_changes(item) -> list[pitch.AtomicChange]:
    """The distinct single-slot changes this item could contribute: a Driver's own suggestion (plus
    one candidate per extra composite op it carries), or a Trade-off's two branches (plus each
    branch's own extra composite ops) as mutually exclusive alternatives.

    A composite item's ops are tried one at a time here, never combined into one slot - this
    under-counts what a real card could cover in one go (several ops from the same item, still
    within the card's own MAX_ATOMIC_CHANGES budget), so it can only make this search too
    conservative, never wrongly claim a challenge is safe when it isn't."""
    out: list[pitch.AtomicChange] = []

    def _raise_to_ops(ops: list[dict]) -> list[pitch.AtomicChange]:
        return [
            pitch.AtomicChange(target=op.get("target"), axis=op.get("axis"), value=op.get("value"), kind="raise_to")
            for op in (ops or [])
            if op.get("kind") == "raise_to" and op.get("target") and op.get("axis") is not None
        ]

    r_type = getattr(item, "type", None)
    r_type = getattr(r_type, "value", r_type)
    if r_type == "driver":
        if item.suggested is not None and item.suggested.axis is not None:
            out.append(pitch.AtomicChange(
                target=item.suggested.target, axis=item.suggested.axis, value=item.suggested.level, kind="raise_to",
            ))
        out.extend(_raise_to_ops(item.ops))
    elif r_type == "trade_off":
        for branch in (item.branch_x, item.branch_y):
            if branch is not None and branch.target and branch.axis is not None and branch.level is not None:
                out.append(pitch.AtomicChange(
                    target=branch.target, axis=branch.axis, value=branch.level, kind="raise_to",
                ))
            if branch is not None:
                out.extend(_raise_to_ops(branch.ops))
    return out


def _has_safe_branch(graph, challenge, phase, all_intel) -> bool:
    """Whether some <=3-slot combination of this challenge's own driver/trade-off items avoids a
    VETO from any high-power stakeholder in its phase, starting from the fresh-seeded graph."""
    room = [(ps.stakeholder_id, ps.power, ps.interest) for ps in phase.stakeholders]
    if not any(power == "high" for _, power, _ in room):
        return True  # nothing to veto with - vacuously safe
    emotions = {sid: EmotionFactory.create_default_emotion_values() for sid, _, _ in room}

    state = replay(graph, [LoggedOp(seq=i, op=op) for i, op in enumerate(seed_ops(graph))]).state

    actionable = [i for i in all_intel if getattr(i, "type", None) in ("driver", "trade_off")
                  or getattr(getattr(i, "type", None), "value", None) in ("driver", "trade_off")]
    # Each actionable item contributes 1 (Driver) or 2 mutually-exclusive (Trade-off branches)
    # candidate changes; a combination picks at most one candidate per item.
    per_item_candidates = [c for c in (_candidate_changes(item) for item in actionable) if c]
    if not per_item_candidates:
        return False  # nothing the player could even slot - definitely not completable

    for r in range(0, min(MAX_SLOTS, len(per_item_candidates)) + 1):
        for item_combo in itertools.combinations(per_item_candidates, r):
            # A Trade-off contributing 2 candidates: try each branch on its own in this slot,
            # never both at once (they're alternatives, not two separate asks).
            for changes in itertools.product(*item_combo):
                view = pitch.card_view(
                    graph=graph, state=state, all_intel=all_intel, changes=list(changes),
                    room=room, emotion_values=emotions,
                )
                if view.outcome != "VETO":
                    return True
    return False


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
