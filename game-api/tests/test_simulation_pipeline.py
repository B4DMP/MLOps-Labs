"""Simulation phase on the real graph (plan 07): apply, capping, world events, grudges, metrics."""

from types import SimpleNamespace

from mlops_serious_game.application.graph_service.apply import apply_ops
from mlops_serious_game.application.graph_service.pipeline import (
    PASS,
    SOFT_PASS,
    STALEMATE,
    VETO_BROKEN,
    owner_buyin_from_reads,
    run_simulation,
    simulate,
)
from mlops_serious_game.domain.graph import GraphOp, GraphState
from mlops_serious_game.domain.grudge import Grudge


def _item(item_id: str, *ops):
    """A slotted stance item, as far as the pipeline is concerned: an id and its ops."""
    return SimpleNamespace(id=item_id, ops=[dict(op) for op in ops], suggested=None)


def _raise(target: str, value: int) -> dict:
    return {"kind": "raise_to", "target": target, "value": value}


def _read(stakeholder_id: str, power: str = "high", buy_in: float = 0.9, boundary_violated: bool = False):
    return SimpleNamespace(
        stakeholder_id=stakeholder_id, power=power, buy_in=buy_in, boundary_violated=boundary_violated
    )


def _challenge(template_id: str = "ch_test", phase_id: int = 2, **kw):
    return SimpleNamespace(
        template_id=template_id,
        phase_id=phase_id,
        on_exit_ops=kw.get("on_exit_ops", []),
        stalemate_ops=kw.get("stalemate_ops", []),
    )


def _start(graph) -> GraphState:
    return GraphState.from_config(graph)


def _with(graph, state, *ops) -> GraphState:
    return apply_ops(graph, state, [GraphOp.model_validate(dict(op, source_kind="admin")) for op in ops]).state


def _target(report, target_id):
    return next(t for t in report.targets if t.id == target_id)


# ---------- capping ----------

def test_capped_raise_names_what_capped_it(real):
    """The feature store hand-off is manual, so a governed training pipeline still delivers less."""
    result = simulate(
        real,
        _start(real),
        outcome=PASS,
        card_items=[_item("i1", _raise("model.training_pipeline", 4))],
        reads=[_read("model_monica")],
        challenge=_challenge(),
    )
    delta = _target(result.report, "model.training_pipeline")
    assert delta.nominal.after == 4
    assert delta.effective.after < delta.nominal.after
    assert delta.capped_by is not None and delta.capped_by["id"]
    assert delta.capped_by["level"] <= delta.effective.after


# ---------- propagation ----------

def test_a_break_propagates_to_what_it_feeds(real):
    """Ingestion dies as the challenge ends; validation was never touched and still falls."""
    built = _with(
        real,
        _start(real),
        _raise("data.ingestion", 3),
        _raise("e.ingest_validate", 3),
        _raise("data.validation", 3),
    )
    result = simulate(
        real,
        built,
        outcome=PASS,
        card_items=[_item("i1", _raise("data.versioning", 3))],
        reads=[_read("data_dave")],
        challenge=_challenge(on_exit_ops=[
            {"kind": "set_to", "target": "data.ingestion", "value": 0, "reason": "nightly job died"}
        ]),
    )
    assert [e for e in result.report.world_events if e.target == "data.ingestion" and e.after == 0]
    propagated = {p.target: p for p in result.report.propagated}
    assert "data.validation" in propagated
    assert propagated["data.validation"].effective.after < propagated["data.validation"].effective.before


# ---------- owner degradation and debt ----------

def test_an_unhappy_owner_makes_the_raise_land_lower(real):
    result = simulate(
        real,
        _start(real),
        outcome=SOFT_PASS,
        card_items=[_item("i1", _raise("data.validation", 4))],
        reads=[_read("data_dave", power="low", buy_in=0.1)],
        challenge=_challenge(),
    )
    assert result.report.debt_created
    entry = result.report.debt_created[0]
    assert entry.target_id == "data.validation" and entry.intended_level == 4 and entry.applied_level < 4
    assert _target(result.report, "data.validation").degraded_by == "data_dave"
    assert result.report.grudges.created, "a neglected low power stakeholder writes a grudge"


def test_debt_is_repaid_by_a_later_card_with_a_happy_owner(real):
    unhappy = simulate(
        real,
        _start(real),
        outcome=SOFT_PASS,
        card_items=[_item("i1", _raise("data.validation", 4))],
        reads=[_read("data_dave", power="low", buy_in=0.1)],
        challenge=_challenge(),
    )
    assert unhappy.state.debt

    repaid = simulate(
        real,
        unhappy.state,
        outcome=PASS,
        card_items=[_item("i1", _raise("data.validation", 4))],
        reads=[_read("data_dave", buy_in=0.9)],
        challenge=_challenge("ch_test_2"),
    )
    assert [d.target_id for d in repaid.report.debt_cleared] == ["data.validation"]
    assert not repaid.state.debt


# ---------- patterns and health ----------

def test_a_design_pattern_gained_lifts_stage_health(real):
    result = simulate(
        real,
        _start(real),
        outcome=PASS,
        card_items=[_item(
            "i1",
            _raise("req.data_contracts", 3),
            _raise("e.contracts_ingest", 3),
            _raise("data.ingestion", 3),
            _raise("e.ingest_validate", 3),
            _raise("data.validation", 3),
        )],
        reads=[_read("requirements_reuben"), _read("data_dave")],
        challenge=_challenge(),
    )
    assert "dp_data_contracts" in result.report.patterns.gained
    data = result.report.stage_health["data"]
    assert data.after > data.before
    assert result.report.system_health.after > result.report.system_health.before


# ---------- metrics ----------

def test_metric_delta_is_the_weighted_sum_of_effective_changes(real):
    metrics = [
        SimpleNamespace(id="data", component_weights={"data.validation": 1.0}),
        SimpleNamespace(id="model", component_weights={"model.hpo": 0.5}),
    ]
    result = simulate(
        real,
        _start(real),
        outcome=PASS,
        card_items=[_item("i1", _raise("data.ingestion", 3), _raise("e.ingest_validate", 3),
                          _raise("data.validation", 3))],
        reads=[_read("data_dave")],
        challenge=_challenge(),
        metrics=metrics,
    )
    delta = _target(result.report, "data.validation")
    assert result.report.metric_deltas["data"] == delta.effective.after - delta.effective.before
    assert "model" not in result.report.metric_deltas, "untouched weights move nothing"


# ---------- grudges ----------

def test_grudges_fire_deterministically(real):
    grudges = [Grudge(stakeholder_id="data_dave"), Grudge(stakeholder_id="model_monica")]
    runs = [
        simulate(
            real,
            _start(real),
            outcome=PASS,
            card_items=[_item("i1", _raise("data.versioning", 3))],
            reads=[_read("data_dave")],
            challenge=_challenge(),
            grudges=grudges,
            seed="player_one",
        )
        for _ in range(2)
    ]
    first, second = (r.report.grudges.fired for r in runs)
    assert [(f.stakeholder_id, f.effect, f.target) for f in first] == [
        (f.stakeholder_id, f.effect, f.target) for f in second
    ]
    assert len(first) == 2
    # Every grudge does something: an op, or an objection waiting for the next pitch.
    assert runs[0].report.world_events or runs[0].pending_objections


def test_a_spent_grudge_stops_firing(real):
    old = [Grudge(stakeholder_id="data_dave", age=1)]
    result = simulate(
        real, _start(real), outcome=PASS, reads=[_read("data_dave")], challenge=_challenge(), grudges=old
    )
    assert result.report.grudges.fired, "it fires one last time"
    assert result.grudges == [], "and is then spent"


# ---------- outcome branches ----------

def test_stalemate_skips_the_card_and_fires_the_authored_hit(real):
    result = simulate(
        real,
        _start(real),
        outcome=STALEMATE,
        card_items=[_item("i1", _raise("data.validation", 4))],
        reads=[_read("data_dave"), _read("reliability_ruth", power="low")],
        challenge=_challenge(stalemate_ops=[
            {"kind": "set_to", "target": "data.validation", "value": 0, "reason": "nobody owned it"}
        ]),
    )
    assert result.report.targets == []
    assert result.state.component_levels["data.validation"] == 0
    assert {g.stakeholder_id for g in result.report.grudges.created} == {"data_dave", "reliability_ruth"}


def test_veto_broken_degrades_only_what_this_card_touched_that_they_own(real):
    """D-question 2: a Veto Breaker is scoped to this card's own simulation - components and
    edges the overridden stakeholder owns AND this card touched ("hybrid") - never their whole
    area, and never anything up/downstream of what the card actually did."""
    # model.registry is owned by model_monica (stage fallback) and pre-raised, but this card
    # never touches it - it must survive the veto untouched.
    built = _with(real, _start(real), _raise("model.registry", 3))
    result = simulate(
        real,
        built,
        outcome=VETO_BROKEN,
        card_items=[_item("i1", _raise("model.evaluation", 3), _raise("data.versioning", 3))],
        reads=[_read("model_monica", buy_in=0.1), _read("data_dave")],
        overridden_stakeholder_id="model_monica",
        challenge=_challenge(),
    )
    # data.versioning: owned by data_dave, not model_monica - the card still applies in full.
    assert result.state.component_levels["data.versioning"] == 3, "the card still applies"
    # model.evaluation: this card touched it and model_monica owns it - degraded.
    assert result.state.component_levels["model.evaluation"] < 3
    # model.registry: model_monica owns it too, but this card never touched it - untouched.
    assert result.state.component_levels["model.registry"] == 3
    grudge = result.report.grudges.created[0]
    assert grudge.stakeholder_id == "model_monica" and grudge.weight == 2


# ---------- owners ----------

def test_owner_resolution_falls_back_to_the_stage_owner(real):
    assert real.owner_of("data.validation") == "data_dave", "no owner of its own, so the stage owns it"
    assert real.owner_of("gov.cost_monitoring") == "efficiency_emilia", "its own owner wins"
    assert owner_buyin_from_reads([_read("data_dave", buy_in=0.2)]) == {"data_dave": 0.2}


def test_the_card_observes_what_it_touched(real):
    result = simulate(
        real,
        _start(real),
        outcome=PASS,
        card_items=[_item("i1", _raise("data.validation", 3))],
        reads=[_read("data_dave")],
        challenge=_challenge(),
    )
    observed = [op.target for op in result.ops if op.kind == "observe"]
    assert observed == ["data.validation"]


# ---------- run_simulation idempotency (D-question 1) ----------

class _FakeStore:
    """An in-memory stand-in for graph_service.store, just enough for run_simulation: one
    player's op-log rows, keyed by source_id, each optionally carrying a report."""

    def __init__(self, state: GraphState):
        self._state = state
        self.rows: list[dict] = []
        self.append_calls = 0

    def load_state(self, username):
        return SimpleNamespace(state=self._state)

    def has_batch(self, username, source_id):
        return any(r["source_id"] == source_id for r in self.rows)

    def load_report(self, username, source_id):
        matching = [r for r in self.rows if r["source_id"] == source_id]
        return matching[-1]["report"] if matching else None

    def append_ops(self, username, ops, *, phase_index, challenge_template, challenge_loop_index,
                    source_kind, source_id=None, report=None):
        self.append_calls += 1
        self.rows.append({"source_id": source_id, "report": report})
        return len(self.rows)


def test_run_simulation_replay_returns_the_stored_report_without_recomputing(real, monkeypatch):
    """A repeat `simulation:run` for the same challenge/loop-index must return the exact report
    that was actually persisted, not a freshly recomputed one - and must not touch the store's
    append path a second time (code review finding: the old version recomputed on every call,
    which could disagree with what was actually applied)."""
    import mlops_serious_game.application.graph_service.store as store_module

    fake = _FakeStore(_start(real))
    for name in ("load_state", "has_batch", "load_report", "append_ops"):
        monkeypatch.setattr(store_module, name, getattr(fake, name))

    challenge = _challenge()
    card_items = [_item("i1", _raise("data.validation", 3))]
    reads = [_read("data_dave")]

    first = run_simulation(
        "alice", challenge=challenge, outcome=PASS, card_items=card_items, reads=reads,
        challenge_loop_index=3,
    )
    assert fake.append_calls == 1
    assert first.report.targets, "the first call actually simulated something"

    # Simulate the graph having moved on between the two calls (exactly what a real replay sees:
    # the first call's own ops are already folded into `before` by the time a retry arrives). If
    # run_simulation still called `simulate()` on a replay, this would produce a *different*
    # report than the first call's - the bug this test guards against.
    fake._state = _with(real, fake._state, _raise("model.evaluation", 3))

    second = run_simulation(
        "alice", challenge=challenge, outcome=PASS, card_items=card_items, reads=reads,
        challenge_loop_index=3,
    )
    # No second append - the batch already exists.
    assert fake.append_calls == 1
    # The replay's report is byte-for-byte the one that was actually persisted, unaffected by the
    # graph having moved on in the meantime - proof `run_simulation` never re-simulates once a
    # batch for this source_id already exists.
    assert second.report.model_dump(mode="json") == first.report.model_dump(mode="json")
    assert second.ops == []
    assert second.pending_objections == []
