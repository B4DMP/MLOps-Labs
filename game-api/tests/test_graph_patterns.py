"""Patterns and challenge selection (plan 03) on the real graph: pattern coverage and
validation, the scheduler, and the content payload gates (plan 02/04) that keep intel content
honest, including the D42 refinement-chain checks."""

import pytest

from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.graph_service.scheduler import (
    next_challenge,
    reachable_templates,
    select_in_phase,
)
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.graph import GraphOp, GraphState
from mlops_serious_game.domain.graph_factory import GraphConfigError, GraphFactory
from mlops_serious_game.domain.Phase import Phase
from mlops_serious_game.domain.pattern import Pattern, PatternFactory, uncovered_targets, validate_patterns


def _maxed(graph) -> GraphState:
    """Everything at its highest level, every instance property at its best value."""
    ops = [GraphOp(kind="set_to", target=c.id, value=max(c.allowed_levels)) for c in graph.components]
    ops += [GraphOp(kind="set_to", target=e.id, value=max(e.allowed_levels)) for e in graph.edges]
    for inst in graph.initial_instances:
        for prop, spec in graph.instance_kinds[inst.kind].properties.items():
            ops.append(GraphOp(kind="set_instance_prop", target=inst.id, attr=prop, value=spec.values[-1]))
    return apply_ops(graph, GraphState.from_config(graph), ops).state


# ---------- patterns on the real config ----------

def test_patterns_cover_every_component_and_pipeline_edge(real):
    assert uncovered_targets(PatternFactory.patterns, real) == []


def test_starting_graph_has_no_design_patterns_and_is_all_green(real):
    ev = evaluate_graph(real, GraphState.from_config(real))
    assert not [p for p in ev.active_patterns if p.startswith("dp_")]
    assert all(s.status == "healthy" for s in ev.stage_graph.stages)


def test_fully_built_graph_has_every_design_pattern_and_no_antipattern(real):
    ev = evaluate_graph(real, _maxed(real))
    design = {p.id for p in PatternFactory.patterns if p.kind == "design"}
    assert set(ev.active_patterns) == design
    assert all(s.status == "healthy" for s in ev.stage_graph.stages)


def test_silent_failure_fires_and_drags_ops_health(real):
    state = apply_ops(real, _maxed(real), [
        GraphOp(kind="set_to", target="ops.production_drift_monitoring", value=1),
        GraphOp(kind="set_to", target="ops.performance_monitoring", value=2),
    ]).state
    ev = evaluate_graph(real, state)
    assert "ap_silent_failure" in ev.active_patterns
    before = next(s for s in evaluate_graph(real, _maxed(real)).stage_graph.stages if s.id == "ops")
    after = next(s for s in ev.stage_graph.stages if s.id == "ops")
    # The antipattern's -15 comes on top of the design bonuses the missing monitoring loses.
    assert after.pattern_effect <= before.pattern_effect - 15


def test_instance_properties_drive_patterns(real):
    state = apply_ops(real, _maxed(real), [
        GraphOp(kind="set_instance_prop", target="model:demand_forecast_v1.performance", value="fair"),
    ]).state
    active = evaluate_graph(real, state).active_patterns
    assert "ap_underperforming_model_live" in active
    state = apply_ops(real, _maxed(real), [
        GraphOp(kind="set_instance_prop", target="dataset:till_scan_lines.quality", value="poor"),
    ]).state
    assert "dp_trusted_data" not in evaluate_graph(real, state).active_patterns


def test_glue_code_reads_attributes(real):
    ops = [GraphOp(kind="set_attr", target=f"{c}.sourcing", value="custom")
           for c in ("data.feature_store", "model.registry", "deploy.api_gateway")]
    state = apply_ops(real, GraphState.from_config(real), ops).state
    assert "ap_glue_code" in evaluate_graph(real, state).active_patterns


# ---------- pattern validation ----------

def _pattern(**kw) -> Pattern:
    base = {"id": "dp_x", "kind": "design", "name": "X", "when": True, "stage_effects": {"data": 5}, "story": "."}
    return Pattern.model_validate({**base, **kw})


def test_pattern_gates(real):
    with pytest.raises(GraphConfigError, match="must start with"):
        validate_patterns([_pattern(id="ap_x")], real)
    with pytest.raises(GraphConfigError, match="subtract health"):
        validate_patterns([_pattern(stage_effects={"data": -5})], real)
    with pytest.raises(GraphConfigError, match="unknown stage"):
        validate_patterns([_pattern(stage_effects={"moon": 5})], real)
    with pytest.raises(GraphConfigError, match="unknown component"):
        validate_patterns([_pattern(when={"component": "data.nope", "level": 2})], real)


def test_patterns_may_depend_on_patterns_but_not_in_a_cycle(real):
    a = _pattern(id="dp_a", when={"pattern": "dp_b"})
    b = _pattern(id="dp_b", when=True)
    assert validate_patterns([a, b], real) == ["dp_b", "dp_a"]
    ev = evaluate_graph(real, GraphState.from_config(real), [a, b], ["dp_b", "dp_a"])
    assert ev.active_patterns == ["dp_b", "dp_a"]
    with pytest.raises(GraphConfigError, match="cycle"):
        validate_patterns([_pattern(id="dp_a", when={"pattern": "dp_b"}),
                           _pattern(id="dp_b", when={"pattern": "dp_a"})], real)


# ---------- scheduler ----------

def _challenge(cid, phase, template, **kw) -> Challenge:
    return Challenge(id=cid, phase_id=phase, name=template, description="", roundIntroduction="",
                     metric_changes={}, template_id=template, **kw)


def _phases() -> list[Phase]:
    data = [
        _challenge(1, 1, "ch_fallback_1", fallback=True),
        _challenge(2, 1, "ch_needs_versioning", priority=50,
                   preconditions={"component": "data.versioning", "op": "lte", "level": 1}),
        _challenge(3, 1, "ch_always", priority=10),
        _challenge(4, 1, "ch_excluded", priority=99, excluded_if=True),
    ]
    later = [_challenge(5, 2, "ch_fallback_2", fallback=True)]
    return [
        Phase(id=1, name="p1", description="", phase_introduction="", challenges=data, challenges_per_phase=2),
        Phase(id=2, name="p2", description="", phase_introduction="", challenges=later),
    ]


def _ctx(real, state=None):
    state = state or GraphState.from_config(real)
    return evaluate_graph(real, state).context(real, state)


def test_highest_priority_eligible_template_wins(real):
    [p1, _] = _phases()
    assert select_in_phase(p1, _ctx(real), set(), "seed").template_id == "ch_needs_versioning"


def test_graph_state_changes_the_pick(real):
    [p1, _] = _phases()
    state = apply_ops(real, GraphState.from_config(real), [GraphOp(kind="set_to", target="data.versioning", value=4)]).state
    assert select_in_phase(p1, _ctx(real, state), set(), "seed").template_id == "ch_always"


def test_fallback_when_nothing_is_eligible(real):
    [p1, _] = _phases()
    played = {"ch_needs_versioning", "ch_always"}
    assert select_in_phase(p1, _ctx(real), played, "seed").template_id == "ch_fallback_1"


def test_retired_fallback_is_never_dealt(real):
    """A retired challenge is kept in config (for its data, and in case it's reinstated later)
    but the scheduler must never deal it, fallback or not: a phase with nothing eligible and
    only a retired fallback deals nothing rather than falling back to retired content."""
    [p1, _] = _phases()
    p1.challenges[0].retired = True
    played = {"ch_needs_versioning", "ch_always"}
    assert select_in_phase(p1, _ctx(real), played, "seed") is None


def test_phase_quota_moves_play_to_the_next_phase_and_none_ends_the_game(real):
    phases = _phases()
    ctx = _ctx(real)
    assert next_challenge(phases, 1, {"ch_needs_versioning"}, ctx, "s").template_id == "ch_always"
    assert next_challenge(phases, 1, {"ch_needs_versioning", "ch_always"}, ctx, "s").template_id == "ch_fallback_2"
    assert next_challenge(phases, 1, {"ch_needs_versioning", "ch_always", "ch_fallback_2"}, ctx, "s") is None


def test_ties_break_deterministically_by_seed(real):
    tied = [_challenge(10 + i, 1, f"ch_tie_{i}", priority=5) for i in range(4)]
    phase = Phase(id=1, name="p", description="", phase_introduction="",
                  challenges=tied + [_challenge(99, 1, "ch_fb", fallback=True)])
    ctx = _ctx(real)
    picks = {select_in_phase(phase, ctx, set(), seed).template_id for seed in ("alice", "bob", "carol", "dave", "erin")}
    assert len(picks) > 1
    assert select_in_phase(phase, ctx, set(), "alice").template_id == select_in_phase(phase, ctx, set(), "alice").template_id


def test_reachable_templates_samples_graph_states(real):
    [p1, _] = _phases()
    fresh = GraphState.from_config(real)
    versioned = apply_ops(real, fresh, [GraphOp(kind="set_to", target="data.versioning", value=4)]).state
    contexts = [_ctx(real, fresh), _ctx(real, versioned)]
    assert reachable_templates(p1, contexts, ["a", "b"]) == {"ch_needs_versioning", "ch_always"}


# ---------- real progression ----------

def test_real_progression_deals_every_phase_in_order(real):
    import mlops_serious_game.domain.gameConfigLoader  # noqa: F401  loads every factory
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

    graph = GraphFactory.get_graph()
    PhaseFactory.validate_templates(graph, PatternFactory.ids(), set(StakeholderFactory.get_available_stakeholders()))
    ctx = _ctx(graph)
    phases = PhaseFactory.get_phases()
    played: set[str] = set()
    dealt: list = []
    current_phase = phases[0].id
    while (pick := next_challenge(phases, current_phase, played, ctx, "player")) is not None:
        dealt.append(pick)
        played.add(pick.template_id)
        current_phase = pick.phase_id
    assert [c.phase_id for c in dealt] == sorted(c.phase_id for c in dealt)
    for phase in phases:
        in_phase = [c for c in dealt if c.phase_id == phase.id]
        assert len(in_phase) == min(phase.challenge_quota, len(phase.challenges))
        generated = [c for c in phase.challenges if not c.fallback]
        if generated and len(generated) >= phase.challenge_quota:
            # With enough eligible generated challenges, the fallback is not needed.
            assert all(not c.fallback for c in in_phase)



# ---------- intel payloads ----------

def test_legacy_content_retagged_and_payload_gate_passes(real):
    import mlops_serious_game.domain.gameConfigLoader  # noqa: F401
    from mlops_serious_game.domain.metric_factory import MetricFactory
    from mlops_serious_game.domain.requirement import IntelTag
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

    tags = {r.type for r in RequirementFactory.requirements}
    assert tags <= set(IntelTag)
    RequirementFactory.validate_payloads(
        GraphFactory.get_graph(), set(MetricFactory.get_available_metrics()),
        set(StakeholderFactory.get_available_stakeholders()),
    )


def test_payload_gate_rejects_mismatched_payloads(real):
    from mlops_serious_game.domain.requirement import StakeholderRequirement
    from mlops_serious_game.domain.requirement_factory import RequirementFactory

    saved = RequirementFactory.requirements
    try:
        RequirementFactory.requirements = [
            StakeholderRequirement(id="f1", challenge_id=0, type="fact", description="."),  # no asserts
            StakeholderRequirement(id="d1", challenge_id=0, stakeholder_id="data_dave", type="driver",
                                   description=".", holds={"component": "data.validation", "level": 3}),
            StakeholderRequirement(id="b1", challenge_id=0, stakeholder_id="data_dave", type="boundary",
                                   description=".", suggested={"target": "data.nope", "level": 3}),
        ]
        with pytest.raises(GraphConfigError) as e:
            RequirementFactory.validate_payloads(real, {"data"}, {"data_dave"})
        msg = str(e.value)
        assert "needs 'asserts'" in msg and "only Boundaries carry 'holds'" in msg and "unknown target" in msg
    finally:
        RequirementFactory.requirements = saved


def test_chain_gate_enforces_d42_parent_stakeholder_phase_and_tag_narrowing(real):
    """D42: a `refines_id` item must match its parent's target and stakeholder, sit in a
    strictly later phase, and only narrow tag (same tag, or Driver into Boundary). Added by
    RequirementFactory.payload_errors (batch E); no test exercised the branch itself before this."""
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.domain.requirement import StakeholderRequirement
    from mlops_serious_game.domain.requirement_factory import RequirementFactory

    saved_phases, saved_reqs = PhaseFactory.phases, RequirementFactory.requirements
    try:
        PhaseFactory.phases = [
            Phase(id=1, name="p1", description="", phase_introduction="", challenges=[
                _challenge(1, 1, "ch_parent"), _challenge(2, 1, "ch_sibling"),
            ]),
            Phase(id=2, name="p2", description="", phase_introduction="", challenges=[
                _challenge(3, 2, "ch_child"),
            ]),
        ]
        RequirementFactory.requirements = [
            StakeholderRequirement(id="p1", challenge_id=1, stakeholder_id="data_dave", type="driver",
                                   description=".", suggested={"target": "data.validation", "level": 3}),
            StakeholderRequirement(id="p2", challenge_id=1, stakeholder_id="data_dave", type="boundary",
                                   description=".", suggested={"target": "data.validation", "level": 3},
                                   holds={"component": "data.validation", "op": "gte", "level": 3}),
            # unknown parent
            StakeholderRequirement(id="c_unknown", challenge_id=3, stakeholder_id="data_dave", type="driver",
                                   description=".", refines_id="nope",
                                   suggested={"target": "data.validation", "level": 3}),
            # different stakeholder than its parent
            StakeholderRequirement(id="c_wrong_st", challenge_id=3, stakeholder_id="model_monica", type="driver",
                                   description=".", refines_id="p1",
                                   suggested={"target": "data.validation", "level": 3}),
            # not strictly later: same phase as its parent
            StakeholderRequirement(id="c_same_phase", challenge_id=2, stakeholder_id="data_dave", type="driver",
                                   description=".", refines_id="p1",
                                   suggested={"target": "data.validation", "level": 3}),
            # widening instead of narrowing: Boundary into Driver is not a valid transition
            StakeholderRequirement(id="c_bad_tag", challenge_id=3, stakeholder_id="data_dave", type="driver",
                                   description=".", refines_id="p2",
                                   suggested={"target": "data.validation", "level": 3}),
        ]
        with pytest.raises(GraphConfigError) as e:
            RequirementFactory.validate_payloads(real, {"data"}, {"data_dave", "model_monica"})
        msg = str(e.value)
        assert "refines unknown item 'nope'" in msg
        assert "different stakeholder" in msg
        assert "not in a strictly later phase" in msg
        assert "invalid tag transition from 'boundary' to 'driver'" in msg
    finally:
        PhaseFactory.phases, RequirementFactory.requirements = saved_phases, saved_reqs


def test_only_facts_filed_as_facts_lift_the_fog():
    from mlops_serious_game.application.intel_handler import fact_targets_to_observe
    from mlops_serious_game.domain.requirement import StakeholderIntelItem

    def fact(fid, tagged):
        return StakeholderIntelItem(id=fid, challenge_id=0, type="fact", description=".",
                                    asserts={"target": "e.fs_train", "level": 2}, categorized_type=tagged)

    assert fact_targets_to_observe([fact("a", "fact")]) == ["e.fs_train"]
    assert fact_targets_to_observe([fact("b", "driver")]) == []
