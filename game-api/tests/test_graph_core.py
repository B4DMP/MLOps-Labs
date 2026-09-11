from pathlib import Path

import pytest

from mlops_serious_game.application.graph_service.apply import apply_ops, replay, seed_ops
from mlops_serious_game.application.graph_service.effective import compute_effective
from mlops_serious_game.domain.graph_predicates import (
    PredicateContext,
    PredicateError,
    evaluate,
    validate_predicate,
)
from mlops_serious_game.application.graph_service.stage_graph import stage_graph
from mlops_serious_game.application.graph_service.story import missing_specific_fragments, story_for
from mlops_serious_game.domain.graph import GraphOp, GraphState, LoggedOp, TechnicalGraph
from mlops_serious_game.domain.graph_factory import GraphConfigError, GraphFactory, validate_graph
from mlops_serious_game.domain.story_factory import StoryFactory


def _config_dir() -> Path:
    for candidate in (Path(__file__).resolve().parents[2] / "gameConfig", Path("/gameConfig")):
        if (candidate / "MlopsGraph.json").exists():
            return candidate
    pytest.skip("gameConfig not found")


ALL = [0, 1, 2, 3, 4, 5]
TRIGGERS = ["none", "manual_request", "on_alert"]


def _graph(**overrides) -> TechnicalGraph:
    """a.src -> a.mid -> b.sink on hard edges, a.mid -> b.side on a soft edge, b.sink -> a.src feedback."""
    edges = [
        {"id": "e.src_mid", "from": "a.src", "to": "a.mid", "kind": "pipeline", "slack": 0,
         "initial_level": 4, "initial_trigger": "manual_request", "allowed_levels": ALL, "allowed_triggers": TRIGGERS},
        {"id": "e.mid_sink", "from": "a.mid", "to": "b.sink", "kind": "pipeline", "slack": 0,
         "initial_level": 4, "initial_trigger": "manual_request", "allowed_levels": ALL, "allowed_triggers": TRIGGERS},
        {"id": "e.mid_side", "from": "a.mid", "to": "b.side", "kind": "pipeline", "slack": 1,
         "initial_level": 4, "initial_trigger": "manual_request", "allowed_levels": ALL, "allowed_triggers": TRIGGERS},
        {"id": "e.sink_src", "from": "b.sink", "to": "a.src", "kind": overrides.get("feedback_kind", "feedback"),
         "slack": 1, "initial_level": 1, "initial_trigger": "none", "allowed_levels": ALL, "allowed_triggers": TRIGGERS},
    ]
    data = {
        "levels": ["broken", "absent", "manual", "scripted", "automated", "governed"],
        "triggers": TRIGGERS,
        "instance_kinds": ["model", "dataset"],
        "instance_states": ["active", "stale"],
        "briefing_observed": ["a.src"],
        "stages": [
            {"id": "a", "name": "Stage A", "owner_role": "alice"},
            {"id": "b", "name": "Stage B", "owner_role": "bob"},
        ],
        "components": [
            {"id": "a.src", "stage_id": "a", "name": "Source", "initial_level": 4, "allowed_levels": ALL},
            {"id": "a.mid", "stage_id": "a", "name": "Middle", "initial_level": 4, "allowed_levels": ALL,
             "attributes": {"hosting": {"values": ["none", "on_prem", "cloud"], "initial": "on_prem"}}},
            {"id": "b.sink", "stage_id": "b", "name": "Sink", "initial_level": 4, "allowed_levels": ALL},
            {"id": "b.side", "stage_id": "b", "name": "Side", "initial_level": 2, "allowed_levels": [0, 1, 2, 4, 5]},
        ],
        "edges": edges,
    }
    graph = TechnicalGraph.model_validate(data)
    validate_graph(graph)
    return graph


def _apply(graph, *ops, state=None, **kw):
    return apply_ops(graph, state or GraphState.from_config(graph), list(ops), **kw)


def _ctx(graph, state, patterns=()):
    return PredicateContext(graph, state, compute_effective(graph, state), frozenset(patterns))


# ---------- config ----------

def test_real_config_loads_and_is_a_dag():
    config = _config_dir()
    graph = GraphFactory.load_graph(config / "MlopsGraph.json")
    assert len(graph.components) == 34
    assert len(graph.edges) == 40
    assert sorted(GraphFactory.topo_order) == sorted(c.id for c in graph.components)
    assert {s.id for s in graph.stages} == {"req", "data", "model", "deploy", "ops", "gov"}
    StoryFactory.load(config / "MlopsStoryFragments.json", graph)


def test_real_config_every_component_has_an_owner():
    graph = GraphFactory.load_graph(_config_dir() / "MlopsGraph.json")
    assert all(graph.owner_of(c.id) for c in graph.components)


def test_cycle_in_pipeline_edges_is_rejected():
    with pytest.raises(GraphConfigError, match="cycle"):
        _graph(feedback_kind="pipeline")


def test_feedback_edges_do_not_count_for_the_dag():
    _graph()  # b.sink -> a.src is feedback, so no cycle


# ---------- apply ----------

def test_raise_to_never_downgrades_but_set_to_does():
    g = _graph()
    assert _apply(g, GraphOp(kind="raise_to", target="a.mid", value=2)).state.level("a.mid") == 4
    assert _apply(g, GraphOp(kind="set_to", target="a.mid", value=2)).state.level("a.mid") == 2


def test_levels_accept_names_and_snap_down_to_allowed():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="b.side", value="absent")).state
    assert state.level("b.side") == 1
    state = _apply(g, GraphOp(kind="raise_to", target="b.side", value="scripted"), state=state).state
    assert state.level("b.side") == 2  # 3 is not allowed, snaps down to 2


def test_invalid_trigger_and_attribute_are_rejected():
    g = _graph()
    result = _apply(
        g,
        GraphOp(kind="set_trigger", target="e.src_mid", value="on_commit"),
        GraphOp(kind="set_attr", target="a.mid.hosting", value="moon"),
        GraphOp(kind="raise_to", target="a.nope", value=3),
    )
    assert len(result.rejected) == 3


def test_set_attr_accepts_dotted_target():
    g = _graph()
    op = GraphOp(kind="set_attr", target="a.mid.hosting", value="cloud")
    assert (op.target, op.attr) == ("a.mid", "hosting")
    assert _apply(g, op).state.attrs["a.mid"]["hosting"] == "cloud"


# ---------- effective ----------

def test_hard_edge_caps_downstream_and_names_the_edge():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="e.mid_sink", value=2)).state
    eff = compute_effective(g, state)
    assert eff.components["b.sink"] == 2
    assert eff.capped_by["b.sink"] == "e.mid_sink"


def test_weak_upstream_caps_downstream_and_names_the_component():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.mid", value=2)).state
    eff = compute_effective(g, state)
    assert eff.components["b.sink"] == 2
    assert eff.capped_by["b.sink"] == "a.mid"


def test_break_propagates_fully_on_hard_edges_and_fades_on_soft_ones():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.src", value="broken")).state
    eff = compute_effective(g, state)
    assert eff.components["a.mid"] == 0
    assert eff.components["b.sink"] == 0
    assert eff.components["b.side"] == 1  # soft edge: one level of slack


def test_absent_component_is_not_broken_by_its_upstream():
    g = _graph()
    state = _apply(
        g,
        GraphOp(kind="set_to", target="a.src", value=0),
        GraphOp(kind="set_to", target="b.sink", value=1),
    ).state
    assert compute_effective(g, state).components["b.sink"] == 1


def test_missing_step_passes_its_input_through():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.mid", value="absent")).state
    eff = compute_effective(g, state)
    assert eff.components["a.mid"] == 1
    assert eff.components["b.sink"] == 4  # skipped, not starved


def test_missing_source_constrains_nothing():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.src", value="absent")).state
    assert compute_effective(g, state).components["a.mid"] == 4


def test_cap_through_a_missing_step_names_the_root_cause():
    g = _graph()
    state = _apply(
        g,
        GraphOp(kind="set_to", target="a.src", value=2),
        GraphOp(kind="set_to", target="a.mid", value="absent"),
    ).state
    eff = compute_effective(g, state)
    assert eff.components["b.sink"] == 2
    assert eff.capped_by["b.sink"] == "a.src"


def test_edge_cannot_outrun_its_source():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.src", value=0)).state
    assert compute_effective(g, state).edges["e.src_mid"] == 1


# ---------- degradation and debt ----------

def test_unhappy_owner_degrades_an_action_card_raise_and_records_debt():
    g = _graph()
    op = GraphOp(kind="raise_to", target="b.side", value=5, source_kind="action_card", source_id="ac1")
    result = _apply(g, op, owner_buyin={"bob": 0.1})
    assert result.state.level("b.side") == 4
    assert result.resolved_ops[0].intended == 5
    [debt] = result.state.debt
    assert (debt.intended_level, debt.applied_level, debt.owner_id) == (5, 4, "bob")


def test_happy_owner_gets_the_full_raise():
    g = _graph()
    op = GraphOp(kind="raise_to", target="b.side", value=5, source_kind="action_card")
    result = _apply(g, op, owner_buyin={"bob": 0.9})
    assert result.state.level("b.side") == 5
    assert result.state.debt == []


def test_degraded_repair_of_a_broken_component_stays_broken():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="b.sink", value=0)).state
    op = GraphOp(kind="raise_to", target="b.sink", value=4, source_kind="action_card")
    result = _apply(g, op, state=state, owner_buyin={"bob": 0.0})
    assert result.state.level("b.sink") == 0
    assert result.state.debt[0].intended_level == 4


def test_clean_raise_with_happy_owner_repays_debt():
    g = _graph()
    degraded = _apply(
        g, GraphOp(kind="raise_to", target="b.side", value=5, source_kind="action_card"), owner_buyin={"bob": 0.1}
    )
    repaid = _apply(
        g,
        GraphOp(kind="raise_to", target="b.side", value=5, source_kind="action_card"),
        state=degraded.state,
        owner_buyin={"bob": 0.9},
    )
    assert repaid.state.debt == []
    assert len(repaid.debt_cleared) == 1


def test_replaying_resolved_ops_reproduces_degradation_without_buyin():
    g = _graph()
    op = GraphOp(kind="raise_to", target="b.side", value=5, source_kind="action_card")
    live = _apply(g, op, owner_buyin={"bob": 0.1})
    log = [LoggedOp(seq=i, op=o) for i, o in enumerate(live.resolved_ops)]
    replayed = replay(g, log).state
    assert replayed.level("b.side") == live.state.level("b.side")
    assert replayed.debt == live.state.debt


def test_replay_equals_live_fold():
    g = _graph()
    ops = [
        GraphOp(kind="set_to", target="a.src", value=2),
        GraphOp(kind="raise_to", target="b.side", value=4),
        GraphOp(kind="set_trigger", target="e.src_mid", value="on_alert"),
        GraphOp(kind="set_attr", target="a.mid", attr="hosting", value="cloud"),
    ]
    live = GraphState.from_config(g)
    for op in ops:
        live = _apply(g, op, state=live).state
    replayed = replay(g, [LoggedOp(seq=i, op=o) for i, o in enumerate(ops)]).state
    assert replayed.component_levels == live.component_levels
    assert replayed.edge_triggers == live.edge_triggers
    assert replayed.attrs == live.attrs


# ---------- knowledge ----------

def test_seed_reveals_only_briefing_targets():
    g = _graph()
    r = replay(g, [LoggedOp(seq=i, op=o) for i, o in enumerate(seed_ops(g))])
    assert r.knowledge.state_of("a.src", r.state) == "current"
    assert r.knowledge.state_of("a.mid", r.state) == "unknown"
    assert r.state.component_levels == GraphState.from_config(g).component_levels


def test_world_event_makes_knowledge_stale_until_observed_again():
    g = _graph()
    log = [LoggedOp(seq=i, op=o) for i, o in enumerate(seed_ops(g))]
    n = len(log)
    log.append(LoggedOp(seq=n, op=GraphOp(kind="set_to", target="a.src", value=0, source_kind="world_event")))
    r = replay(g, log)
    assert r.knowledge.state_of("a.src", r.state) == "stale"
    assert r.knowledge.seen["a.src"].nominal == 4  # the player still sees what they saw

    log.append(LoggedOp(seq=n + 1, op=GraphOp(kind="observe", target="a.src")))
    r = replay(g, log)
    assert r.knowledge.state_of("a.src", r.state) == "current"
    assert r.knowledge.seen["a.src"].nominal == 0


def test_observation_records_effective_level():
    g = _graph()
    log = [
        LoggedOp(seq=0, op=GraphOp(kind="set_to", target="a.mid", value=2)),
        LoggedOp(seq=1, op=GraphOp(kind="observe", target="b.sink")),
    ]
    seen = replay(g, log).knowledge.seen["b.sink"]
    assert (seen.nominal, seen.effective) == (4, 2)


# ---------- predicates ----------

def test_component_clause_defaults_to_effective_level():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="a.mid", value=2)).state
    ctx = _ctx(g, state)
    assert not evaluate({"component": "b.sink", "op": "gte", "level": 4}, ctx).value
    assert evaluate({"component": "b.sink", "op": "gte", "level": "automated", "on": "nominal"}, ctx).value


def test_combinators_trigger_attr_pattern_clauses_and_trace():
    g = _graph()
    ctx = _ctx(g, GraphState.from_config(g), patterns={"dp_x"})
    pred = {
        "all": [
            {"edge": "e.src_mid", "trigger": "eq", "value": "manual_request"},
            {"attr": "a.mid.hosting", "op": "ne", "value": "cloud"},
            {"any": [{"pattern": "dp_x"}, {"pattern": "dp_y"}]},
            {"not": {"component": "b.side", "op": "gte", "level": 4}},
        ]
    }
    result = evaluate(pred, ctx)
    assert result.value
    assert result.trace["all"][1]["actual"] == "on_prem"
    assert evaluate(True, ctx).value


def test_instance_clauses():
    g = _graph()
    inst = {"id": "model:m1", "kind": "model", "component_id": "a.mid", "name": "m1", "state": "stale"}
    state = _apply(g, GraphOp(kind="instance_upsert", target="model:m1", value=inst)).state
    ctx = _ctx(g, state)
    assert evaluate({"instance": {"kind": "model", "state": "stale", "op": "exists"}}, ctx).value
    assert not evaluate({"instance": {"kind": "model", "op": "count", "cmp": "gte", "n": 2}}, ctx).value


def test_unknown_clause_raises_and_validation_reports_bad_references():
    g = _graph()
    with pytest.raises(PredicateError):
        evaluate({"flux": 1}, _ctx(g, GraphState.from_config(g)))
    errors = validate_predicate(
        {"all": [{"component": "a.nope", "level": 2}, {"attr": "a.mid.hosting", "value": "moon"},
                 {"pattern": "dp_missing"}]},
        g,
        pattern_ids={"dp_x"},
    )
    assert len(errors) == 3


# ---------- stage graph ----------

def test_stage_health_from_maturity_and_debt():
    g = _graph()
    state = GraphState.from_config(g)
    view = stage_graph(g, state, compute_effective(g, state))
    a = next(s for s in view.stages if s.id == "a")
    # a.src 4, a.mid 4, e.src_mid 4: maturity 12/15 = 0.8, health 20 + 40 * 0.8 = 52
    assert a.maturity == pytest.approx(0.8)
    assert a.health == pytest.approx(52)

    degraded = _apply(
        g, GraphOp(kind="raise_to", target="b.side", value=5, source_kind="action_card"), owner_buyin={"bob": 0.0}
    ).state
    b_before = next(s for s in view.stages if s.id == "b")
    b_after = next(s for s in stage_graph(g, degraded, compute_effective(g, degraded)).stages if s.id == "b")
    # b.sink 4 + b.side 2 -> 0.6 maturity, 44. Degraded raise lands b.side at 4 -> 52, minus 6 debt.
    assert b_before.health == pytest.approx(44)
    assert (b_after.health, b_after.debt) == (pytest.approx(46), 1)


def test_pattern_effects_move_stage_health():
    g = _graph()
    state = GraphState.from_config(g)
    eff = compute_effective(g, state)
    plain = stage_graph(g, state, eff).stages[0].health
    boosted = stage_graph(g, state, eff, pattern_effects={"a": 12}).stages[0].health
    assert boosted == pytest.approx(plain + 12)


def test_flows_report_weakest_crossing_edge():
    g = _graph()
    state = _apply(g, GraphOp(kind="set_to", target="e.mid_side", value=1)).state
    view = stage_graph(g, state, compute_effective(g, state))
    [flow] = [f for f in view.flows if (f.from_stage, f.to_stage) == ("a", "b")]
    assert (flow.level, flow.weakest_edge_id) == (1, "e.mid_side")


# ---------- story ----------

def test_story_prefers_the_most_specific_fragment():
    config = _config_dir()
    graph = GraphFactory.load_graph(config / "MlopsGraph.json")
    StoryFactory.load(config / "MlopsStoryFragments.json", graph)
    state = GraphState.from_config(graph)
    state = _apply(
        graph,
        GraphOp(kind="set_to", target="data.validation", value=4),
        GraphOp(kind="set_attr", target="data.validation.tool", value="great_expectations"),
        state=state,
    ).state
    assert story_for(graph, state, "data.validation").startswith("Great Expectations validates")
    assert story_for(graph, state, "data.feature_store") == "There is no Feature Store yet."
    assert "by hand" in story_for(graph, state, "e.ingest_validate")
    assert ("data.validation", 4) not in missing_specific_fragments(graph)
