"""The intro is a demo that plays in the data stage, then the run restarts from an empty graph.

Covers the pieces that make that work: the `reset` op, which stage a phase plays in, what the
graph payload and pitch targets say for phase 0, and the reset that fires once the demo is done.
"""

import json

import pytest
from sqlalchemy import select
from test_run_scope import _add_challenge, _seed_user, _start_run, migrated_db  # noqa: F401

from mlops_serious_game.application.graph_service import store as graph_store
from mlops_serious_game.application.graph_service.apply import apply_ops, replay, seed_ops
from mlops_serious_game.application.graph_service.graph_state_view import build_graph_state
from mlops_serious_game.application.graph_service.phase_stage import stage_for_phase
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.domain.graph import GraphOp, GraphState, LoggedOp
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory


@pytest.fixture(scope="module")
def phases(config_dir, real):
    from mlops_serious_game.domain.metric_factory import MetricFactory
    from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

    StakeholderFactory.load_stakeholders(config_dir / "GameStakeholders.json")
    MetricFactory.load_metrics(config_dir / "GameMetrics.json")
    PhaseFactory.load_phases(config_dir / "GameProgression.json")
    RequirementFactory.load_requirements(config_dir / "RequirementObjects.json")
    return PhaseFactory.get_phases()


def _log(ops):
    return [LoggedOp(seq=i, op=op) for i, op in enumerate(ops)]


def test_reset_op_clears_levels_and_debt(real):
    """A degraded raise leaves debt behind; `set_to` seeding alone would not clear it."""
    fresh = GraphState.from_config(real)
    played = apply_ops(
        real,
        fresh,
        [GraphOp(kind="raise_to", target="data.ingestion", axis="automation", value=3, intended=3, source_kind="action_card")],
    ).state
    degraded = apply_ops(
        real,
        played,
        [GraphOp(kind="raise_to", target="data.validation", axis="automation", value=2, source_kind="action_card", intended=3)],
        owner_buyin={real.owner_of("data.validation"): 0.0},
    ).state
    assert degraded.debt, "fixture should have produced debt"
    assert degraded.component_automation["data.ingestion"] == 3

    after = replay(real, _log([GraphOp(kind="reset", target="graph")])).state
    assert after == fresh
    reset_after_play = apply_ops(real, degraded, [GraphOp(kind="reset", target="graph")]).state
    assert reset_after_play == fresh


def test_phase_zero_plays_in_the_data_stage(real, phases):
    assert stage_for_phase(real, 0).id == "data"
    assert stage_for_phase(real, 1).id == "req"
    assert stage_for_phase(real, 2).id == "data"
    assert stage_for_phase(real, None) is None


def test_unconfigured_phase_zero_falls_back_to_the_first_stage(real, monkeypatch):
    monkeypatch.setattr(PhaseFactory, "phases", [])
    assert stage_for_phase(real, 0).id == "req"


def test_graph_payload_reaches_the_demo_stage_only_up_to_it(real, phases):
    state = GraphState.from_config(real)
    ev = evaluate_graph(real, state, [], [])
    view = build_graph_state(real, state, ev.effective, ev.stage_graph, [], [], current_phase_id=0)
    locked = {s["id"]: s["locked"] for s in view["stages"]}
    assert view["active_stage_id"] == "data"
    assert locked["data"] is False
    assert locked["model"] is True


def test_pitch_targets_in_the_demo_are_the_data_components(real, phases):
    from mlops_serious_game.infrastructure.websocket.handlers.pitch_handler import get_allowed_targets

    demo = next(c for p in phases if p.id == 0 for c in p.challenges)
    intel = RequirementFactory.get_requirements_for_challenge(demo.id)
    allowed = get_allowed_targets(real, 0, demo.id, list(intel))
    assert "data.ingestion" in allowed and "data.validation" in allowed
    assert not any(t.startswith("req.") for t in allowed)


def test_demo_challenge_only_targets_its_own_stage(real, phases):
    demo = next(c for p in phases if p.id == 0 for c in p.challenges)
    assert demo.focus_stage_ids == ["data"]
    for item in RequirementFactory.get_requirements_for_challenge(demo.id):
        raw = json.loads(item.model_dump_json())
        for key in ("suggested", "holds", "asserts", "concedes", "branch_x", "branch_y"):
            target = (raw.get(key) or {}).get("target") or (raw.get(key) or {}).get("component")
            if target:
                assert target.startswith("data."), (item.id, key, target)


def test_demo_finished_only_after_its_last_challenge(phases):
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import _demo_finished

    demo = next(c for p in phases if p.id == 0 for c in p.challenges)
    phase_one = next(c for p in phases if p.id == 1 for c in p.challenges)
    assert _demo_finished(demo, {demo.template_id})
    assert not _demo_finished(demo, set())
    assert not _demo_finished(phase_one, {phase_one.template_id})
    assert not _demo_finished(None, set())


def test_reset_graph_logs_reset_then_seed_once(real, monkeypatch):
    logged: list[dict] = []
    monkeypatch.setattr(graph_store, "has_batch", lambda username, source_id: any(b["source_id"] == source_id for b in logged))
    monkeypatch.setattr(graph_store, "append_ops", lambda username, ops, **kw: logged.append({"ops": ops, **kw}))

    assert graph_store.reset_graph("p", phase_index=0, challenge_template="ch_x") is True
    assert graph_store.reset_graph("p", phase_index=0, challenge_template="ch_x") is False

    assert len(logged) == 1
    ops = logged[0]["ops"]
    assert ops[0].kind == "reset" and len(ops) == 1 + len(seed_ops(real))
    assert logged[0]["source_id"] == "reset:ch_x"
    played = apply_ops(real, GraphState.from_config(real), [GraphOp(kind="raise_to", target="data.ingestion", axis="automation", value=3)]).state
    assert replay(real, _log(ops)).state == GraphState.from_config(real)
    assert apply_ops(real, played, ops).state == GraphState.from_config(real)


# ---------- what the demo leaves behind ----------


def _demo_and_next(phases):
    demo = next(c for p in phases if p.id == 0 for c in p.challenges)
    nxt = next(c for p in phases if p.id == 1 for c in p.challenges)
    return demo, nxt


def test_only_the_demo_cast_is_demo_only(phases):
    assert PhaseFactory.demo_only_stakeholder_ids() == {"bear_bruce", "mohawk_mark"}


@pytest.mark.anyio
async def test_leaving_the_demo_starts_the_next_challenge_with_a_neutral_room(migrated_db, phases):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import (
        _neutral_room,
        store_or_update_challenge,
    )

    demo, nxt = _demo_and_next(phases)
    user_id = _seed_user()
    _start_run(user_id, 1, None)
    warm = {"bear_bruce": {"trust": 0.9}}
    _add_challenge(user_id, 1, 0, demo.id, [7, 0], warm)

    async def store(fresh):
        await store_or_update_challenge(
            challenge=nxt, challenge_loop_id=0, action_card={}, metric_values=[1, 1],
            messages=[], username="alice", attention_tokens=20, fresh_room=fresh,
        )
        with get_session() as session:
            return session.scalars(
                select(GameChallenge).where(GameChallenge.challenge_index == nxt.id)
            ).first().emotion_values

    assert await store(True) == _neutral_room()
    assert "bear_bruce" in _neutral_room() and _neutral_room() != warm


@pytest.mark.anyio
async def test_without_the_flag_the_room_is_carried(migrated_db, phases):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameChallenge
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import store_or_update_challenge

    demo, nxt = _demo_and_next(phases)
    user_id = _seed_user()
    _start_run(user_id, 1, None)
    warm = {"bear_bruce": {"trust": 0.9}}
    _add_challenge(user_id, 1, 0, demo.id, [7, 0], warm)
    await store_or_update_challenge(
        challenge=nxt, challenge_loop_id=0, action_card={}, metric_values=[1, 1],
        messages=[], username="alice", attention_tokens=20,
    )
    with get_session() as session:
        row = session.scalars(select(GameChallenge).where(GameChallenge.challenge_index == nxt.id)).first()
        assert row.emotion_values == warm


def test_reset_run_session_restores_escalation_points_and_drops_grudges(migrated_db):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameSession
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import _reset_run_session

    user_id = _seed_user()
    _start_run(user_id, 1, None)
    with get_session() as session:
        session.add(GameSession(
            player="alice", user_id=user_id, run_index=1, stakeholder_personas={"data_dave": "a"},
            escalation_points=0, grudges=[{"stakeholder_id": "bear_bruce", "weight": 1}],
        ))
    _reset_run_session("alice")
    with get_session() as session:
        rec = session.scalars(select(GameSession).where(GameSession.user_id == user_id)).first()
        assert rec.escalation_points == 3 and rec.grudges == []


def test_demo_intel_leaves_the_dossier_but_stays_on_record(migrated_db, phases):
    from mlops_serious_game.application.intel_handler import load_known_intel_items
    from mlops_serious_game.domain.requirement import IntelSource, StakeholderIntelItem
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import IntelItem

    demo, nxt = _demo_and_next(phases)
    user_id = _seed_user()
    _start_run(user_id, 1, None)
    rows = []
    for req, phase_id in (
        (RequirementFactory.get_requirements_for_challenge(demo.id)[0], 0),
        (RequirementFactory.get_requirements_for_challenge(nxt.id)[0], 1),
    ):
        item = StakeholderIntelItem.from_requirement(req, source=IntelSource.PUBLIC_RECORD)
        item.discovered_phase_id = phase_id
        rows.append(item)
    with get_session() as session:
        for item in rows:
            session.add(IntelItem(
                user_name="alice", user_id=user_id, run_index=1,
                intel_item_data=json.loads(item.model_dump_json()),
            ))

    ids = lambda phase: {i.id for i in load_known_intel_items("alice", up_to_phase=phase)}
    assert ids(0) == {rows[0].id}
    assert ids(1) == {rows[1].id}
    assert ids(None) == {rows[0].id, rows[1].id}
    with get_session() as session:
        assert len(session.scalars(select(IntelItem)).all()) == 2


# ---------- the demo does not count towards the results ----------


def _add_event_for(user_id, challenge_id, cause, seq):
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import GameEventRow

    with get_session() as session:
        session.add(GameEventRow(
            user_name="alice", user_id=user_id, run_index=1, seq=seq, phase_id=0 if challenge_id == 113 else 1,
            challenge_id=challenge_id, step="offline", kind="intel", direction="none", cause=cause,
            params={}, refs={},
        ))


def test_results_leave_out_the_demo_phase(migrated_db, phases):
    from mlops_serious_game.application.results_service.service import build_results
    from mlops_serious_game.domain.requirement import IntelSource, StakeholderIntelItem
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import IntelItem

    demo, nxt = _demo_and_next(phases)
    user_id = _seed_user()
    _start_run(user_id, 1, None)
    _add_challenge(user_id, 1, 0, demo.id, [9, 9], {"bear_bruce": {"trust": 0.9}})
    _add_challenge(user_id, 1, 1, nxt.id, [3, 3], {"requirements_reuben": {"trust": 0.5}})
    _add_event_for(user_id, demo.id, "grudge.fired", 1)
    _add_event_for(user_id, nxt.id, "test.event", 2)
    with get_session() as session:
        for cid in (demo.id, nxt.id):
            item = StakeholderIntelItem.from_requirement(
                RequirementFactory.get_requirements_for_challenge(cid)[0], source=IntelSource.PUBLIC_RECORD
            )
            session.add(IntelItem(
                user_name="alice", user_id=user_id, run_index=1,
                intel_item_data=json.loads(item.model_dump_json()),
            ))

    payload = build_results("alice")

    assert [(c["phase_index"], c["challenge_index"]) for c in payload["challenges"]] == [(1, nxt.id)]
    assert {e["cause"] for e in payload["events"]} == {"test.event"}
    assert "bear_bruce" not in payload["stakeholders"] and "mohawk_mark" not in payload["stakeholders"]
    demo_requirements = {r.id for r in RequirementFactory.get_requirements_for_challenge(demo.id)}
    listed = {row["id"] for row in payload["intel"]["per_stakeholder"]}
    assert not listed & {"bear_bruce", "mohawk_mark"}
    assert demo_requirements  # sanity: the demo has intel that could have leaked
