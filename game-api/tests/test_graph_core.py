"""Graph core (plan 01, then docs/plans/graph-governance-automation-rework/00-plan.md) on
synthetic fixtures plus the real config: op application, effective levels and capping,
degradation and debt, predicates, stage health, and story.

Two independent axes, no combined level: every raise_to/set_to op and every component/edge
predicate clause names its axis explicitly."""

import pytest

from mlops_serious_game.application.graph_service.apply import apply_ops, replay, seed_ops
from mlops_serious_game.application.graph_service.effective import compute_effective
from mlops_serious_game.application.graph_service.stage_graph import stage_graph
from mlops_serious_game.application.graph_service.story import missing_specific_fragments, story_for
from mlops_serious_game.domain.graph import GraphOp, GraphState, LoggedOp, TechnicalGraph
from mlops_serious_game.domain.graph_factory import GraphConfigError, GraphFactory, validate_graph
from mlops_serious_game.domain.graph_predicates import (
    PredicateContext,
    PredicateError,
    evaluate,
    validate_predicate,
)
from mlops_serious_game.domain.story_factory import StoryFactory

AUTOMATION_STATES = ["broken", "absent", "manual", "automated"]
GOVERNANCE_LEVELS = ["none", "partial_1", "partial_2", "full"]
TRIGGERS = ["none", "manual_request", "on_alert", "scheduled"]
ALL_AUTO = [0, 1, 2, 3]
ALL_GOV = [0, 1, 2, 3]


def _edge(eid, src, dst, slack=0, automation=3, governance=0, trigger="on_alert", kind="pipeline"):
    return {
        "id": eid, "from": src, "to": dst, "kind": kind, "slack": slack,
        "initial_automation": automation, "initial_governance": governance, "initial_trigger": trigger,
        "allowed_automation": ALL_AUTO, "allowed_governance": ALL_GOV, "allowed_triggers": TRIGGERS,
    }


def _graph(**overrides) -> TechnicalGraph:
    """a.src -> a.mid -> b.sink on hard edges, a.mid -> b.side on a soft edge, b.sink -> a.src feedback.
    Everything starts automated (automation=3) except b.side (manual, automated is not allowed for
    it); governance starts at none (0) everywhere. b.side's governance ladder skips partial_2
    ([0,1,3]) to exercise snap-down-with-gaps."""
    data = {
        "automation_states": AUTOMATION_STATES,
        "governance_levels": GOVERNANCE_LEVELS,
        "triggers": TRIGGERS,
        "instance_kinds": {
            "model": {"properties": {"performance": {"values": ["poor", "fair", "good"], "initial": "good"}}},
            "dataset": {"properties": {}},
        },
        "instance_states": ["active", "deprecated"],
        "stages": [
            {"id": "a", "name": "Stage A", "owner_role": "alice"},
            {"id": "b", "name": "Stage B", "owner_role": "bob"},
        ],
        "components": [
            {"id": "a.src", "stage_id": "a", "name": "Source", "initial_automation": 3, "initial_governance": 0,
             "allowed_automation": ALL_AUTO, "allowed_governance": ALL_GOV},
            {"id": "a.mid", "stage_id": "a", "name": "Middle", "initial_automation": 3, "initial_governance": 0,
             "allowed_automation": ALL_AUTO, "allowed_governance": ALL_GOV,
             "attributes": {"hosting": {"values": ["none", "on_prem", "cloud"], "initial": "on_prem"}}},
            {"id": "b.sink", "stage_id": "b", "name": "Sink", "initial_automation": 3, "initial_governance": 0,
             "allowed_automation": ALL_AUTO, "allowed_governance": ALL_GOV},
            {"id": "b.side", "stage_id": "b", "name": "Side", "initial_automation": 2, "initial_governance": 0,
             "allowed_automation": [0, 1, 2], "allowed_governance": [0, 1, 3]},
        ],
        "edges": [
            _edge("e.src_mid", "a.src", "a.mid"),
            _edge("e.mid_sink", "a.mid", "b.sink"),
            _edge("e.mid_side", "a.mid", "b.side", slack=1),
            _edge("e.sink_src", "b.sink", "a.src", slack=1, automation=1, trigger="none",
                  kind=overrides.get("feedback_kind", "feedback")),
        ],
        "initial_instances": overrides.get("instances", []),
    }
    graph = TechnicalGraph.model_validate(data)
    validate_graph(graph)
    return graph


def _apply(graph, *ops, state=None, **kw):
    return apply_ops(graph, state or GraphState.from_config(graph), list(ops), **kw)


def _ctx(graph, state, patterns=()):
    return PredicateContext(graph, state, compute_effective(graph, state), frozenset(patterns))


# ---------- config ----------

def test_real_config_loads_and_is_a_dag(config_dir):
    graph = GraphFactory.load_graph(config_dir / "MlopsGraph.json")
    assert len(graph.components) == 28
    assert len(graph.edges) == 31
    assert sorted(GraphFactory.topo_order) == sorted(c.id for c in graph.components)
    assert {s.id for s in graph.stages} == {"req", "data", "model", "deploy", "ops"}
    assert graph.automation_states == AUTOMATION_STATES
    assert graph.governance_levels == GOVERNANCE_LEVELS
    StoryFactory.load(config_dir / "MlopsStoryFragments.json", graph)


def test_real_config_every_component_has_an_owner_and_instances_are_seeded(config_dir):
    graph = GraphFactory.load_graph(config_dir / "MlopsGraph.json")
    assert all(graph.owner_of(c.id) for c in graph.components)
    state = GraphState.from_config(graph)
    assert state.instances["model:demand_forecast_v1"].props["performance"] == "fair"


def test_cycle_in_pipeline_edges_is_rejected():
    with pytest.raises(GraphConfigError, match="cycle"):
        _graph(feedback_kind="pipeline")


def test_feedback_edges_do_not_count_for_the_dag():
    _graph()  # b.sink -> a.src is feedback, so no cycle


def test_edge_level_and_trigger_must_agree_in_config():
    data = _graph().model_dump(by_alias=True)
    data["edges"][0]["initial_trigger"] = "manual_request"  # automation 3 needs an automatic trigger
    with pytest.raises(GraphConfigError, match="expected 'on_alert'"):
        validate_graph(TechnicalGraph.model_validate(data))


def test_invalid_initial_instance_is_rejected():
    with pytest.raises(GraphConfigError, match="unknown value"):
        _graph(instances=[{"id": "model:m", "kind": "model", "component_id": "a.mid", "name": "m",
                           "state": "active", "props": {"performance": "legendary"}}])


# ---------- apply ----------

def test_raise_to_never_downgrades_but_set_to_does():
    g = _graph()
    assert _apply(g, GraphOp(kind="raise_to", target="a.mid", axis="automation", value=2)).state.value("a.mid", "automation") == 3
    assert _apply(g, GraphOp(kind="set_to", target="a.mid", axis="automation", value=2)).state.value("a.mid", "automation") == 2


def test_levels_accept_names_and_snap_down_to_allowed():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="b.side", axis="automation", value="absent")).state
    assert state.value("b.side", "automation") == 1
    state = _apply(g, GraphOp(kind="raise_to", target="b.side", axis="automation", value="automated"), state=state).state
    assert state.value("b.side", "automation") == 2  # 3 is not allowed, snaps down to 2
    with pytest.raises(ValueError):
        GraphOp(kind="set_to", target="b.side", axis="automation", value="scripted")


def test_invalid_trigger_and_attribute_are_rejected():
    g = _graph()
    result = _apply(
        g,
        GraphOp(kind="set_trigger", target="e.src_mid", value="on_commit"),
        GraphOp(kind="set_attr", target="a.mid.hosting", value="moon"),
        GraphOp(kind="raise_to", target="a.nope", axis="automation", value=3),
    )
    assert len(result.rejected) == 3


def test_set_attr_accepts_dotted_target():
    g = _graph()
    op = GraphOp(kind="set_attr", target="a.mid.hosting", value="cloud")
    assert (op.target, op.attr) == ("a.mid", "hosting")
    assert _apply(g, op).state.attrs["a.mid"]["hosting"] == "cloud"


# ---------- edge automation and trigger ----------

def test_lowering_an_edge_resets_its_trigger():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="e.src_mid", axis="automation", value="manual")).state
    assert state.edge_triggers["e.src_mid"] == "manual_request"
    state = _apply(g, GraphOp(kind="set_to", target="e.src_mid", axis="automation", value="absent"), state=state).state
    assert state.edge_triggers["e.src_mid"] == "none"


def test_raising_an_edge_picks_its_default_automatic_trigger():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="e.sink_src", axis="automation", value="automated")).state
    assert state.edge_triggers["e.sink_src"] == "on_alert"


def test_naming_an_automatic_trigger_automates_the_edge():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="e.src_mid", axis="automation", value="manual")).state
    state = _apply(g, GraphOp(kind="set_trigger", target="e.src_mid", value="scheduled"), state=state).state
    assert (state.value("e.src_mid", "automation"), state.edge_triggers["e.src_mid"]) == (3, "scheduled")


def test_manual_trigger_on_an_automated_edge_is_rejected():
    g = _graph()
    result = _apply(g, GraphOp(kind="set_trigger", target="e.src_mid", value="manual_request"))
    assert len(result.rejected) == 1
    assert result.state.edge_triggers["e.src_mid"] == "on_alert"


# ---------- instances ----------

def test_instance_upsert_fills_default_props_and_set_prop_changes_them():
    g = _graph()
    inst = {"id": "model:m1", "kind": "model", "component_id": "a.mid", "name": "m1", "state": "active"}
    state = _apply(g, GraphOp(kind="instance_upsert", target="model:m1", value=inst)).state
    assert state.instances["model:m1"].props == {"performance": "good"}
    state = _apply(g, GraphOp(kind="set_instance_prop", target="model:m1.performance", value="poor"), state=state).state
    assert state.instances["model:m1"].props["performance"] == "poor"


def test_invalid_instance_property_is_rejected():
    g = _graph(instances=[{"id": "model:m", "kind": "model", "component_id": "a.mid", "name": "m", "state": "active"}])
    result = _apply(g, GraphOp(kind="set_instance_prop", target="model:m", attr="performance", value="legendary"))
    assert len(result.rejected) == 1


# ---------- effective (automation only, per 00-plan.md decision 1) ----------

def test_hard_edge_caps_downstream_and_names_the_edge():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="e.mid_sink", axis="automation", value=2)).state
    eff = compute_effective(g, state)
    assert eff.automation["b.sink"] == 2
    assert eff.capped_by["b.sink"] == "e.mid_sink"


def test_weak_upstream_caps_downstream_and_names_the_component():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.mid", axis="automation", value=2)).state
    eff = compute_effective(g, state)
    assert eff.automation["b.sink"] == 2
    assert eff.capped_by["b.sink"] == "a.mid"


def test_break_propagates_fully_on_hard_edges_and_fades_on_soft_ones():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.src", axis="automation", value="broken")).state
    eff = compute_effective(g, state)
    assert eff.automation["a.mid"] == 0
    assert eff.automation["b.sink"] == 0
    assert eff.automation["b.side"] == 1  # soft edge: one level of slack


def test_absent_component_is_not_broken_by_its_upstream():
    g = _graph()
    state = _apply(
        g,
        GraphOp(kind="set_to", target="a.src", axis="automation", value=0),
        GraphOp(kind="set_to", target="b.sink", axis="automation", value=1),
    ).state
    assert compute_effective(g, state).automation["b.sink"] == 1


def test_missing_step_passes_its_input_through():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.mid", axis="automation", value="absent")).state
    eff = compute_effective(g, state)
    assert eff.automation["a.mid"] == 1
    assert eff.automation["b.sink"] == 3  # skipped, not starved


def test_missing_source_constrains_nothing():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.src", axis="automation", value="absent")).state
    assert compute_effective(g, state).automation["a.mid"] == 3


def test_cap_through_a_missing_step_names_the_root_cause():
    g = _graph()
    state = _apply(
        g,
        GraphOp(kind="set_to", target="a.src", axis="automation", value=2),
        GraphOp(kind="set_to", target="a.mid", axis="automation", value="absent"),
    ).state
    eff = compute_effective(g, state)
    assert eff.automation["b.sink"] == 2
    assert eff.capped_by["b.sink"] == "a.src"


def test_edge_cannot_outrun_its_source():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.src", axis="automation", value=0)).state
    assert compute_effective(g, state).automation["e.src_mid"] == 1


# ---------- governance requires an implemented target ----------

def test_governance_is_rejected_on_a_target_not_yet_implemented():
    """e.sink_src starts at automation=absent(1) - nothing to review until a player raises it to
    manual or above (00-plan.md decision 5's follow-up)."""
    g = _graph()
    op = GraphOp(kind="raise_to", target="e.sink_src", axis="governance", value=1, source_kind="action_card")
    result = _apply(g, op)
    assert result.state.value("e.sink_src", "governance") == 0
    assert len(result.rejected) == 1
    assert result.rejected[0].reason == "players cannot govern a target that is not implemented"


def test_governance_lands_once_the_same_batch_implements_it_first():
    """Automation and governance for the same target can land in one action card, as long as the
    automation raise is ordered before the governance one - the composer only ever offers the
    governance step once its automation step is already slotted (graphOptions.ts's isImplemented)."""
    g = _graph()
    result = _apply(
        g,
        GraphOp(kind="raise_to", target="e.sink_src", axis="automation", value=2, source_kind="action_card"),
        GraphOp(kind="raise_to", target="e.sink_src", axis="governance", value=1, source_kind="action_card"),
    )
    assert result.state.value("e.sink_src", "automation") == 2
    assert result.state.value("e.sink_src", "governance") == 1
    assert result.rejected == []


def test_governance_before_its_automation_in_the_same_batch_is_rejected():
    """apply_ops itself stays strictly sequential, with no lookahead across the batch - the same
    ops get replayed later with no batch boundaries to look ahead within, so apply_ops and replay
    must always agree. Ordering automation before governance for the same target is instead the
    job of whoever builds the ops list (atomic_changes_to_ops/card_ops's
    `_automation_before_governance`, tested in test_pitch_session.py)."""
    g = _graph()
    result = _apply(
        g,
        GraphOp(kind="raise_to", target="e.sink_src", axis="governance", value=1, source_kind="action_card"),
        GraphOp(kind="raise_to", target="e.sink_src", axis="automation", value=2, source_kind="action_card"),
    )
    assert result.state.value("e.sink_src", "automation") == 2
    assert result.state.value("e.sink_src", "governance") == 0
    assert len(result.rejected) == 1


# ---------- degradation and debt ----------

def test_unhappy_owner_degrades_an_action_card_raise_and_records_debt():
    g = _graph()
    op = GraphOp(kind="raise_to", target="b.sink", axis="governance", value=1, source_kind="action_card", source_id="ac1")
    result = _apply(g, op, owner_buyin={"bob": 0.1})
    assert result.state.value("b.sink", "governance") == 0
    assert result.resolved_ops[0].intended == 1
    [debt] = result.state.debt
    assert (debt.intended_level, debt.applied_level, debt.owner_id, debt.axis) == (1, 0, "bob", "governance")


def test_degradation_follows_allowed_levels():
    """b.side's governance ladder skips partial_2 ([0,1,3]): a degraded ask for `full` from
    `partial_1` must snap down to the nearest allowed rung below it, `partial_1` itself - not to
    an unauthored in-between value."""
    g = _graph()
    raised = _apply(
        g, GraphOp(kind="raise_to", target="b.side", axis="governance", value=1, source_kind="action_card"),
        owner_buyin={"bob": 0.9},
    ).state
    op = GraphOp(kind="raise_to", target="b.side", axis="governance", value=3, source_kind="action_card")
    result = _apply(g, op, state=raised, owner_buyin={"bob": 0.1})
    assert result.state.value("b.side", "governance") == 1  # the level below 3 that b.side allows
    assert result.state.debt[0].intended_level == 3


def test_happy_owner_gets_the_full_raise():
    g = _graph()
    op = GraphOp(kind="raise_to", target="b.sink", axis="governance", value=1, source_kind="action_card")
    result = _apply(g, op, owner_buyin={"bob": 0.9})
    assert result.state.value("b.sink", "governance") == 1
    assert result.state.debt == []


def test_degraded_repair_of_a_broken_component_stays_broken():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="b.sink", axis="automation", value=0)).state
    op = GraphOp(kind="raise_to", target="b.sink", axis="automation", value=1, source_kind="action_card")
    result = _apply(g, op, state=state, owner_buyin={"bob": 0.0})
    assert result.state.value("b.sink", "automation") == 0
    assert result.state.debt[0].intended_level == 1


def test_clean_raise_with_happy_owner_repays_debt():
    g = _graph()
    degraded = _apply(
        g, GraphOp(kind="raise_to", target="b.sink", axis="governance", value=1, source_kind="action_card"),
        owner_buyin={"bob": 0.1},
    )
    repaid = _apply(
        g,
        GraphOp(kind="raise_to", target="b.sink", axis="governance", value=1, source_kind="action_card"),
        state=degraded.state,
        owner_buyin={"bob": 0.9},
    )
    assert repaid.state.debt == []
    assert len(repaid.debt_cleared) == 1


def test_replaying_resolved_ops_reproduces_degradation_without_buyin():
    g = _graph()
    op = GraphOp(kind="raise_to", target="b.sink", axis="governance", value=1, source_kind="action_card")
    live = _apply(g, op, owner_buyin={"bob": 0.1})
    log = [LoggedOp(seq=i, op=o) for i, o in enumerate(live.resolved_ops)]
    replayed = replay(g, log).state
    assert replayed.value("b.sink", "governance") == live.state.value("b.sink", "governance")
    assert replayed.debt == live.state.debt


def test_replay_equals_live_fold():
    g = _graph()
    ops = [
        GraphOp(kind="set_to", target="a.src", axis="automation", value=2),
        GraphOp(kind="raise_to", target="b.side", axis="governance", value=1),
        GraphOp(kind="set_trigger", target="e.src_mid", value="scheduled"),
        GraphOp(kind="set_attr", target="a.mid", attr="hosting", value="cloud"),
    ]
    live = GraphState.from_config(g)
    for op in ops:
        live = _apply(g, op, state=live).state
    replayed = replay(g, [LoggedOp(seq=i, op=o) for i, o in enumerate(ops)]).state
    assert replayed.component_automation == live.component_automation
    assert replayed.component_governance == live.component_governance
    assert replayed.edge_triggers == live.edge_triggers
    assert replayed.attrs == live.attrs


# ---------- graph state payload ----------

def test_seed_replays_to_the_configured_start_state():
    g = _graph()
    r = replay(g, [LoggedOp(seq=i, op=o) for i, o in enumerate(seed_ops(g))])
    assert r.state.component_automation == GraphState.from_config(g).component_automation
    assert r.state.component_governance == GraphState.from_config(g).component_governance
    assert not hasattr(r, "knowledge")


def test_observe_is_no_longer_an_op_kind():
    with pytest.raises(ValueError):
        GraphOp(kind="observe", target="a.src")


def test_graph_state_ships_full_data_for_every_target_from_the_start():
    from mlops_serious_game.application.graph_service.view import evaluate_graph
    from mlops_serious_game.application.graph_service.graph_state_view import build_graph_state

    g = _graph()
    state = GraphState.from_config(g)
    ev = evaluate_graph(g, state, [], [])
    view = build_graph_state(g, state, ev.effective, ev.stage_graph, [], [], current_phase_id=None)

    targets = [t for stage in view["technical"].values() for t in stage["components"] + stage["edges"]]
    assert len(targets) == len(g.components) + len(g.edges)
    for t in targets:
        assert "knowledge" not in t and "seen_at" not in t
        assert "effective_automation" in t and "effective_governance" in t
    for stage in view["stages"]:
        assert "health_band" not in stage


# ---------- predicates ----------

def test_component_clause_defaults_to_effective_level():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.mid", axis="automation", value=2)).state
    ctx = _ctx(g, state)
    assert not evaluate({"component": "b.sink", "axis": "automation", "op": "gte", "level": 3}, ctx).value
    assert evaluate(
        {"component": "b.sink", "axis": "automation", "op": "gte", "level": "automated", "on": "nominal"}, ctx
    ).value


def test_combinators_trigger_attr_pattern_clauses_and_trace():
    g = _graph()
    ctx = _ctx(g, GraphState.from_config(g), patterns={"dp_x"})
    pred = {
        "all": [
            {"edge": "e.src_mid", "trigger": "eq", "value": "on_alert"},
            {"attr": "a.mid.hosting", "op": "ne", "value": "cloud"},
            {"any": [{"pattern": "dp_x"}, {"pattern": "dp_y"}]},
            {"not": {"component": "b.side", "axis": "automation", "op": "gte", "level": 3}},
        ]
    }
    result = evaluate(pred, ctx)
    assert result.value
    assert result.trace["all"][1]["actual"] == "on_prem"
    assert evaluate(True, ctx).value


def test_instance_clauses_compare_property_order():
    g = _graph(instances=[{"id": "model:m1", "kind": "model", "component_id": "a.mid", "name": "m1",
                           "state": "active", "props": {"performance": "fair"}}])
    ctx = _ctx(g, GraphState.from_config(g))
    weak = {"instance": {"kind": "model", "op": "exists", "where": {"performance": {"op": "lte", "value": "fair"}}}}
    strong = {"instance": {"kind": "model", "op": "exists", "where": {"performance": {"op": "gte", "value": "good"}}}}
    assert evaluate(weak, ctx).value
    assert not evaluate(strong, ctx).value
    assert not evaluate({"instance": {"kind": "model", "op": "count", "cmp": "gte", "n": 2}}, ctx).value


def test_unknown_clause_raises_and_validation_reports_bad_references():
    g = _graph()
    with pytest.raises(PredicateError):
        evaluate({"flux": 1}, _ctx(g, GraphState.from_config(g)))
    errors = validate_predicate(
        {"all": [{"component": "a.nope", "axis": "automation", "level": 2}, {"attr": "a.mid.hosting", "value": "moon"},
                 {"pattern": "dp_missing"},
                 {"instance": {"kind": "model", "where": {"performance": {"value": "legendary"}}}}]},
        g,
        pattern_ids={"dp_x"},
    )
    assert len(errors) == 4
    assert validate_predicate({"any": [{"edge": {"id": "e.src_mid"}}, {"instance": "model"}, {"pattern": 3}]}, g)


def test_validate_predicate_rejects_non_equality_ops_on_attr_and_trigger_clauses():
    """evaluate() raises PredicateError at runtime for anything but eq/ne on attr and edge+trigger
    clauses; validate_predicate is the static gate that is supposed to catch this at config-load
    time instead of letting it blow up mid-game. Both clause kinds otherwise reference real,
    valid ids/values so the only thing under test is the op restriction itself."""
    g = _graph()
    errors = validate_predicate(
        {"all": [
            {"attr": "a.mid.hosting", "op": "gte", "value": "cloud"},
            {"edge": "e.src_mid", "trigger": "gte", "value": "on_alert"},
        ]},
        g,
    )
    assert len(errors) == 2
    assert all("only support eq / ne" in e for e in errors)


# ---------- stage graph ----------

def test_stage_health_counts_problems_not_maturity():
    g = _graph()
    state = GraphState.from_config(g)
    view = stage_graph(g, state, compute_effective(g, state))
    a = next(s for s in view.stages if s.id == "a")
    # Nothing is wrong, so health is full. Maturity blends both axes (00-plan.md): a.src, a.mid
    # and e.src_mid all sit at automation=3/3 (fraction 1.0) and governance=0/3 (fraction 0.0),
    # averaging to 0.5 each.
    assert (a.health, a.status) == (100, "healthy")
    assert a.maturity == pytest.approx(0.5)

    broken = _apply(g, GraphOp(kind="set_to", target="a.src", axis="automation", value="broken")).state
    view = stage_graph(g, broken, compute_effective(g, broken))
    a, b = (next(s for s in view.stages if s.id == x) for x in ("a", "b"))
    # Only a.src is broken in itself. a.mid and b.sink run at 0 because of it, which is reported
    # as starved and costs no health of its own (D35), so one break is paid for once.
    assert (a.broken, a.health) == (1, 85)
    assert a.starved_ids == ["a.mid"]
    assert (b.broken, b.starved, b.health) == (0, 1, 100)


def test_debt_costs_health():
    g = _graph()
    degraded = _apply(
        g, GraphOp(kind="raise_to", target="b.sink", axis="governance", value=1, source_kind="action_card"),
        owner_buyin={"bob": 0.0},
    ).state
    b = next(s for s in stage_graph(g, degraded, compute_effective(g, degraded)).stages if s.id == "b")
    assert (b.debt, b.health) == (1, 94)


def test_pattern_effects_move_stage_health_within_bounds():
    g = _graph()
    state = GraphState.from_config(g)
    eff = compute_effective(g, state)
    assert stage_graph(g, state, eff, pattern_effects={"a": -12}).stages[0].health == pytest.approx(88)
    assert stage_graph(g, state, eff, pattern_effects={"a": 12}).stages[0].health == pytest.approx(100)


def test_flows_report_weakest_crossing_edge():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="e.mid_side", axis="automation", value=1)).state
    view = stage_graph(g, state, compute_effective(g, state))
    [flow] = [f for f in view.flows if (f.from_stage, f.to_stage) == ("a", "b")]
    assert (flow.level, flow.weakest_edge_id) == (1, "e.mid_side")


def test_feedback_flows_are_reported_separately_from_pipeline_flows():
    """A `feedback` edge is a real backward loop and must never be drawn as a forward pipeline arrow."""
    fb = _graph(feedback_kind="feedback")
    fb_state = GraphState.from_config(fb)
    feedback = stage_graph(fb, fb_state, compute_effective(fb, fb_state))
    assert [f.weakest_edge_id for f in feedback.feedback_flows] == ["e.sink_src"]
    assert all(f.weakest_edge_id != "e.sink_src" for f in feedback.flows)


# ---------- story ----------

def test_story_prefers_the_most_specific_fragment(config_dir):
    graph = GraphFactory.load_graph(config_dir / "MlopsGraph.json")
    StoryFactory.load(config_dir / "MlopsStoryFragments.json", graph)
    state = GraphState.from_config(graph)
    state = _apply(
        graph,
        GraphOp(kind="set_to", target="data.validation", axis="automation", value="automated"),
        GraphOp(kind="set_attr", target="data.validation.tool", value="great_expectations"),
        state=state,
    ).state
    assert story_for(graph, state, "data.validation").startswith("Great Expectations validates")
    # Targets outside generated content fall back to the generic line.
    assert story_for(graph, state, "e.alert_retrain") == "Nothing moves from Alerting System to Retraining Trigger."
    assert ("data.validation", 3) not in missing_specific_fragments(graph)
