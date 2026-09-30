"""The content harness end to end with a fake model: ledger, runner, stage checks, assembly, gates."""

import asyncio
import json
import re
import shutil
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from content_gen.context import Context  # noqa: E402
from content_gen.ledger import Ledger, WorkItem  # noqa: E402
from content_gen.llm import FakeLLM  # noqa: E402
from content_gen.runner import RunOptions, Stop, run_stage  # noqa: E402
from content_gen.stages import STAGES  # noqa: E402

SCOPE = {
    "phases": [2],
    "templates_per_phase": 1,
    "conflict_types": ["soft"],
    "facts_per_template": [3, 6],
    "orphans_block": False,
}

TEMPLATE = {
    "slug": "ingest_outage",
    "name": "The Silent Export",
    "description": "The nightly export died and took the labels with it. #data_dave# wants validation automated "
                   "before anyone trains again, #efficiency_emilia# thinks that is money spent on the wrong problem.",
    "round_introduction": "Overnight the export job failed and the labelling tool stopped with it. Nobody noticed until "
                          "the morning stand up.",
    "preconditions": {"component": "data.validation", "axis": "automation", "op": "lte", "level": 1},
    "priority": 60,
    "on_enter_ops": [
        {"kind": "set_to", "target": "data.ingestion", "axis": "automation", "value": "0", "reason": "the nightly export died"},
        {"kind": "set_to", "target": "data.labeling", "axis": "automation", "value": "0", "reason": "the labelling tool lost its input"},
    ],
    "stalemate_ops": [{"kind": "set_to", "target": "e.validate_version", "axis": "automation", "value": "0", "reason": "nobody owned the hand over"}],
    # emilia's position is on governance, not automation: dave's automation=3 driver (below) targets
    # the same component but a different axis, so it never sits above a compromise ceiling this
    # conflict authors - unlike an automation position below 3 would (data.validation only allows
    # governance 0 or 3, so this also has to be 3, not a lower "compromise" value).
    "conflict": {"target": "data.validation",
                 "positions": [{"stakeholder_id": "data_dave", "axis": "automation", "wants": 3},
                               {"stakeholder_id": "efficiency_emilia", "axis": "governance", "wants": 3}]},
}

ITEMS = {"items": [
    {"key": "dave_validation", "tag": "driver", "stakeholder_id": "data_dave",
     "fact": "{data_dave} wants every incoming batch validated automatically.",
     "readings": {"driver": "D: He would take any improvement he can get.", "boundary": "B: He would take any improvement he can get.", "trade_off": "T: He would take any improvement he can get.", "fact": "F: He would take any improvement he can get."},
     "metric_id": "data", "suggested_target": "data.validation", "suggested_axis": "automation", "suggested_level": 3,
     "ops": [{"kind": "raise_to", "target": "e.ingest_validate", "axis": "automation", "value": "3"},
             {"kind": "raise_to", "target": "e.validate_version", "axis": "automation", "value": "3"}]},
    {"key": "dave_versioning", "tag": "trade_off", "stakeholder_id": "data_dave",
     "fact": "{data_dave} brought up versioning for each dataset.",
     "readings": {"driver": "D: More versioning is always better in his book.", "boundary": "B: He will not hand over a dataset that has no version.", "trade_off": "T: He would let versioning wait a sprint if ingestion gets fixed first.", "fact": "F: That is how the datasets are handled today."},
     "concedes_target": "data.versioning", "concedes_axis": "automation", "concedes_max_level": 1},
    {"key": "ruth_ingestion", "tag": "boundary", "stakeholder_id": "reliability_ruth",
     "fact": "{reliability_ruth} wants the ingestion job running again.",
     "readings": {"driver": "D: She will not sign off on anything until it is.", "boundary": "B: She will not sign off on anything until it is.", "trade_off": "T: She will not sign off on anything until it is.", "fact": "F: She will not sign off on anything until it is."},
     "holds": {"component": "data.ingestion", "axis": "automation", "op": "gte", "level": 2},
     "ops": [{"kind": "raise_to", "target": "data.ingestion", "axis": "automation", "value": "2"}]},
    {"key": "ruth_handover", "tag": "driver", "stakeholder_id": "reliability_ruth",
     "fact": "{reliability_ruth} wants the hand over into validation to run on its own.",
     "readings": {"driver": "D: Every step closer to that helps her.", "boundary": "B: Every step closer to that helps her.", "trade_off": "T: Every step closer to that helps her.", "fact": "F: Every step closer to that helps her."},
     "metric_id": "reliability", "suggested_target": "e.ingest_validate", "suggested_axis": "automation", "suggested_level": 3},
    {"key": "emilia_cost", "tag": "trade_off", "stakeholder_id": "efficiency_emilia",
     "fact": "{efficiency_emilia} agreed to discuss automated validation.",
     "readings": {"driver": "D: She can live with paying for it if the outages end.", "boundary": "B: She can live with paying for it if the outages end.", "trade_off": "T: She can live with paying for it if the outages end.", "fact": "F: She can live with paying for it if the outages end."},
     "concedes_target": "data.validation", "concedes_axis": "automation", "concedes_max_level": 3},
    {"key": "reuben_contract", "tag": "trade_off", "stakeholder_id": "requirements_reuben",
     "fact": "{requirements_reuben} brought up the data contract on every ingestion run.",
     "readings": {"driver": "D: The closer the better, as far as he is concerned.", "boundary": "B: No run of his goes ahead without that contract.", "trade_off": "T: He would drop the contract on the smaller feeds to get the outage closed.", "fact": "F: That is what the ingestion setup does today."},
     "concedes_metric": "requirements", "concedes_loss": 2},
    {"key": "fact_ingestion", "tag": "fact",
     "fact": "The ingestion job has produced no new records since last night.",
     "readings": {"driver": "D: That is simply the current state of the pipeline.", "boundary": "B: That is simply the current state of the pipeline.", "trade_off": "T: That is simply the current state of the pipeline.", "fact": "F: That is simply the current state of the pipeline."},
     "asserts_target": "data.ingestion", "asserts_axis": "automation", "asserts_level": 0},
    {"key": "fact_handover", "tag": "fact",
     "fact": "New data is moved into validation by hand, on request.",
     "readings": {"driver": "D: That is how it works today.", "boundary": "B: That is how it works today.", "trade_off": "T: That is how it works today.", "fact": "F: That is how it works today."},
     "asserts_target": "e.ingest_validate", "asserts_axis": "automation", "asserts_level": 2, "asserts_trigger": "manual_request"},
    {"key": "fact_versioning", "tag": "fact",
     "fact": "Datasets are not versioned at all.",
     "readings": {"driver": "D: Nothing more to it than that.", "boundary": "B: Nothing more to it than that.", "trade_off": "T: Nothing more to it than that.", "fact": "F: Nothing more to it than that."},
     "asserts_target": "data.versioning", "asserts_axis": "automation", "asserts_level": 1},
    # Stances 9 to 13 bring every stakeholder up to its quota: dave 2, ruth 4, reuben 3, emilia 2.
    {"key": "ruth_flow", "tag": "driver", "stakeholder_id": "reliability_ruth",
     "fact": "{reliability_ruth} asked for the whole feature path to run on its own, from versioning onward.",
     "readings": {"driver": "D: Every step of that path she does not run by hand helps her.", "boundary": "B: She refuses to sign off on any release until that path runs alone.", "trade_off": "T: She would keep parts of that path manual if the release date is at risk.", "fact": "F: That path is started by hand, one step after another."},
     "metric_id": "reliability", "suggested_target": "data.feature_store", "suggested_axis": "automation", "suggested_level": 3,
     "ops": [{"kind": "raise_to", "target": "e.version_fs", "axis": "automation", "value": 3},
             {"kind": "raise_to", "target": "e.validate_version", "axis": "automation", "value": 3}]},
    {"key": "ruth_labels", "tag": "trade_off", "stakeholder_id": "reliability_ruth",
     "fact": "{reliability_ruth} mentioned the labelling tool as something that can wait.",
     "readings": {"driver": "D: Every improvement to labelling would be welcome to her.", "boundary": "B: She will not sign off while labelling stays untouched.", "trade_off": "T: She would leave labelling alone this round if ingestion comes back first.", "fact": "F: Labelling has been idle since the export stopped."},
     "concedes_target": "data.labeling", "concedes_axis": "automation", "concedes_max_level": 1},
    {"key": "reuben_edge", "tag": "driver", "stakeholder_id": "requirements_reuben",
     "fact": "{requirements_reuben} asked for the data contract check to run on every ingestion hand over.",
     "readings": {"driver": "D: The more hand overs the check covers, the better for him.", "boundary": "B: He will not sign off on any ingestion without that check.", "trade_off": "T: He would drop the check on small feeds to get the outage closed.", "fact": "F: That check is only done by hand today."},
     "metric_id": "requirements", "suggested_target": "e.contracts_ingest", "suggested_axis": "automation", "suggested_level": 2},
    {"key": "reuben_drift", "tag": "trade_off", "stakeholder_id": "requirements_reuben",
     "fact": "{requirements_reuben} brought up the drift check on the training data.",
     "readings": {"driver": "D: Catching drift earlier is always better in his view.", "boundary": "B: He will not release a model without a drift check.", "trade_off": "T: He would let that drift check wait if the contract check is done first.", "fact": "F: That drift check is barely used today."},
     "concedes_target": "data.training_drift_check", "concedes_axis": "automation", "concedes_max_level": 1},
    {"key": "emilia_nightly", "tag": "trade_off", "stakeholder_id": "efficiency_emilia",
     "fact": "{efficiency_emilia} raised the cost of running the checks every night.",
     "readings": {"driver": "D: Cheaper nightly checks are always better for her.", "boundary": "B: She will not approve any spend on nightly checks.", "trade_off": "T: She would pay for nightly checks if they stop the outages.", "fact": "F: Nightly checks run on a rented server today."},
     "concedes_metric": "efficiency", "concedes_loss": 3},
]}

FILLER = ("This note sums up where things stand with the data pipeline this week and what it means for the "
          "coming sprint. ") * 4


def respond(schema, system, user):
    name = schema.__name__
    if name == "TemplateOut":
        return TEMPLATE
    if name == "ItemsOut":
        return ITEMS
    if name == "ArtifactOut":
        tag = re.search(r"Intel item \((\w+)\)", user).group(1)
        return {"content": f"[{tag}] {FILLER}"}
    if name == "Classification":
        return {"tag": re.match(r"\[(\w+)\]", user).group(1), "reason": "it says so"}
    if name == "StanceObjection":
        return {"objection": "That does not go far enough for what I need here.",
                "correction": "That is not what I said, let me be clear about it."}
    if name == "TechnicalObjection":
        return {"line": "Improving {target} will not help while {cause} upstream is still this weak."}
    if name == "FragmentsOut":
        states = ["broken", "absent", "manual", "automated", "governed"]
        return {f"level_{lv}": f"This part of the pipeline is {states[lv]} today." for lv in range(5)}
    raise AssertionError(name)


def test_objections_and_fragments_keep_levels_and_graph_words_out():
    from types import SimpleNamespace

    ctx = SimpleNamespace(stakeholders={})
    technical = SimpleNamespace(inputs={"kind": "technical"})
    line = "I cannot sign off on {target} while {cause} in the upstream stage is still at level 2."
    errors = STAGES["objections"].check({"line": line}, technical, ctx)
    assert any("line says 'level 2'" in e for e in errors)
    assert any("line says 'stage'" in e for e in errors)

    stance = SimpleNamespace(inputs={"kind": "stance"})
    fine = "That does not go far enough for what I need here."
    errors = STAGES["objections"].check(
        {"objection": fine, "correction": "I meant the ingestion component, not a wish."}, stance, ctx)
    assert any("correction says 'component'" in e for e in errors)
    assert STAGES["objections"].check({"objection": fine, "correction": fine}, stance, ctx) == []

    fragment = SimpleNamespace(inputs={"levels": [2, 3]})
    errors = STAGES["fragments"].check({
        "level_2": "Someone runs the export by hand every Monday morning.",
        "level_3": "The export component runs on its own at level 3.",
    }, fragment, ctx)
    assert any("level_3 says 'level 3'" in e for e in errors)
    assert any("level_3 says 'component'" in e for e in errors)
    assert not any(e.startswith("level_2") for e in errors)
    # Ordinary English that happens to contain the word: the gate reads the scale, not the word.
    assert STAGES["fragments"].check({
        "level_2": "Someone checks feature level drift by hand every Monday morning.",
        "level_3": "The export runs on its own, with that level of detail kept in the log.",
    }, fragment, ctx) == []


@pytest.fixture
def env(tmp_path, config_dir):
    cfg = tmp_path / "gameConfig"
    shutil.copytree(config_dir, cfg)
    ctx = Context.load(cfg, tmp_path / "work", "test", SCOPE)
    ledger = Ledger(ctx.ledger_path)
    yield ctx, ledger
    ledger.close()
    import mlops_serious_game.domain.gameConfigLoader as loader

    loader.GameConfigLoader.initialize()  # put the real config back for other tests


def run(stage, ctx, ledger, llm, **opts):
    return asyncio.run(run_stage(STAGES[stage], ctx, ledger, llm, RunOptions(retries_on_error=1, **opts)))


# ---------- ledger ----------

def test_ledger_marks_changed_inputs_stale_and_heals_abandoned_runs(tmp_path):
    ledger = Ledger(tmp_path / "l.sqlite")
    item = WorkItem("s", "s:1", {"a": 1})
    ledger.sync([item], "v1", "m")
    assert ledger.todo(["s:1"], 3) == ["s:1"]
    ledger.claim("s:1")
    ledger.finish("s:1", "out.json", 10, 5, "m", 1)
    assert ledger.todo(["s:1"], 3) == []
    ledger.sync([WorkItem("s", "s:1", {"a": 2})], "v1", "m")
    assert ledger.get("s:1").status == "stale"
    ledger.claim("s:1")
    ledger.conn.execute("UPDATE items SET updated_at = 0 WHERE item_id = 's:1'")
    ledger.sync([WorkItem("s", "s:1", {"a": 2})], "v1", "m")
    assert ledger.get("s:1").status == "pending"
    ledger.close()


def test_heartbeat_keeps_a_long_running_item_from_going_stale(tmp_path):
    """A slow-but-alive item must never be reclaimed by another sync() just because it takes a
    while - the heartbeat, not the (now short) RUNNING_TIMEOUT_S alone, is what keeps it 'running'."""
    from content_gen.ledger import RUNNING_TIMEOUT_S

    ledger = Ledger(tmp_path / "l.sqlite")
    item = WorkItem("s", "s:1", {"a": 1})
    ledger.sync([item], "v1", "m")
    ledger.claim("s:1")

    # Simulate time passing well beyond RUNNING_TIMEOUT_S without a heartbeat: sync() reclaims it.
    ledger.conn.execute(
        "UPDATE items SET updated_at = ? WHERE item_id = 's:1'", (time.time() - RUNNING_TIMEOUT_S - 1,)
    )
    ledger.sync([item], "v1", "m")
    assert ledger.get("s:1").status == "pending"

    # Now simulate a heartbeat arriving just in time, repeatedly, well past the same window.
    ledger.claim("s:1")
    ledger.conn.execute(
        "UPDATE items SET updated_at = ? WHERE item_id = 's:1'", (time.time() - RUNNING_TIMEOUT_S + 5,)
    )
    ledger.heartbeat("s:1")
    ledger.sync([item], "v1", "m")
    assert ledger.get("s:1").status == "running"
    ledger.close()


def test_with_heartbeat_ticks_the_ledger_while_a_slow_call_is_in_flight(tmp_path):
    from content_gen.runner import _with_heartbeat

    ledger = Ledger(tmp_path / "l.sqlite")
    item = WorkItem("s", "s:1", {"a": 1})
    ledger.sync([item], "v1", "m")
    ledger.claim("s:1")
    first_updated_at = ledger.get("s:1").updated_at

    async def slow_call():
        await asyncio.sleep(0.05)
        return "result"

    result = asyncio.run(_with_heartbeat(slow_call(), "s:1", ledger, interval=0.01))
    assert result == "result"
    assert ledger.get("s:1").updated_at > first_updated_at  # at least one heartbeat landed
    assert ledger.get("s:1").status == "running"  # heartbeat never changes status
    ledger.close()


def test_reject_with_note_queues_regeneration(tmp_path):
    ledger = Ledger(tmp_path / "l.sqlite")
    item = WorkItem("s", "s:1", {"a": 1})
    ledger.sync([item], "v1", "m")
    ledger.claim("s:1")
    ledger.finish("s:1", "out.json", 1, 1, "m", 1)
    ledger.reject("s:1", "too long")
    assert ledger.todo(["s:1"], 3) == ["s:1"]
    ledger.sync([item], "v1", "m")
    assert ledger.get("s:1").input_hash == item.input_hash("v1", "m", "too long")
    ledger.close()


# ---------- runner and stage checks ----------

def test_valid_template_passes_the_game_checks(env):
    ctx, ledger = env
    report = run("templates", ctx, ledger, FakeLLM(respond))
    assert report.done == ["templates:p2:s0"] and not report.failed
    record = json.loads((ctx.work_dir / ledger.get("templates:p2:s0").output_path).read_text())
    assert record["output"]["slug"] == "ingest_outage"


def test_rejected_answer_is_retried_with_the_errors_as_feedback(env):
    ctx, ledger = env
    answers = [dict(TEMPLATE, conflict={**TEMPLATE["conflict"], "target": "model.registry"}), TEMPLATE]
    llm = FakeLLM(lambda schema, system, user: answers.pop(0))
    report = run("templates", ctx, ledger, llm)
    assert report.done == ["templates:p2:s0"]
    assert ledger.get("templates:p2:s0").attempts == 2
    assert "not in the focus stage" in llm.calls[1][1]


def test_template_that_does_no_damage_fails(env):
    ctx, ledger = env
    harmless = dict(TEMPLATE, on_enter_ops=[{"kind": "set_to", "target": "data.validation", "axis": "automation", "value": "1", "reason": "x"}])
    report = run("templates", ctx, ledger, FakeLLM(lambda *a: harmless), max_attempts=2)
    assert "on_enter_ops only moves" in report.failed["templates:p2:s0"]
    assert ledger.get("templates:p2:s0").status == "failed"


def test_budget_stops_new_work_and_leaves_it_pending(env):
    ctx, ledger = env
    scope = dict(SCOPE, templates_per_phase=2, conflict_types=["soft", "hard"])
    ctx.scope = scope
    report = run("templates", ctx, ledger, FakeLLM(respond), budget_tokens=1, concurrency=1, max_attempts=1)
    assert report.stopped == "budget reached"
    assert len(report.skipped) == 1
    assert ledger.get(report.skipped[0]).status == "pending"


def test_stop_flag_skips_everything_not_started(env):
    ctx, ledger = env
    stop = Stop()
    stop.set("interrupted")
    report = asyncio.run(run_stage(STAGES["templates"], ctx, ledger, FakeLLM(respond), RunOptions(), stop))
    assert report.skipped == ["templates:p2:s0"] and not report.done
    assert ledger.get("templates:p2:s0").status == "pending"


def test_items_checks_catch_false_facts_and_missing_conflict_trade_off(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    [item] = STAGES["items"].plan(ctx)
    assert STAGES["items"].check(ITEMS, item, ctx) == []

    bad = json.loads(json.dumps(ITEMS))
    bad["items"][6]["asserts_level"] = 2  # ingestion is broken after the world event, not manual
    bad["items"][4]["concedes_target"] = "data.versioning"
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("is at level 0, not 2" in e for e in errors)
    assert any("soft conflict" in e for e in errors)


def _items_and_plan(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    [item] = STAGES["items"].plan(ctx)
    return ctx, item, json.loads(json.dumps(ITEMS))


def _by_key(items, key):
    return next(i for i in items["items"] if i["key"] == key)


def test_items_plan_sets_a_quota_per_quadrant(env):
    ctx, item, _ = _items_and_plan(env)
    # data_dave low/high, reliability_ruth high/high, requirements_reuben high/low, efficiency_emilia low/low
    assert item.inputs["quotas"] == {"data_dave": 2, "reliability_ruth": 4, "requirements_reuben": 3, "efficiency_emilia": 2}
    assert item.inputs["counts"]["stances"] == [11, 11]


def test_items_check_needs_the_quota_of_every_stakeholder(env):
    ctx, item, bad = _items_and_plan(env)
    bad["items"] = [i for i in bad["items"] if i["key"] != "emilia_nightly"]
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("efficiency_emilia needs exactly 2 stance items, has 1" in e for e in errors)


def test_items_check_wants_hand_overs_and_composite_drivers(env):
    ctx, item, bad = _items_and_plan(env)
    for key in ("dave_validation", "ruth_flow"):
        _by_key(bad, key)["ops"] = []
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("only 0 composite drivers" in e for e in errors)
    assert any("hand-over between components" in e for e in errors)


def test_items_check_allows_one_boundary_per_stakeholder(env):
    ctx, item, bad = _items_and_plan(env)
    labels = _by_key(bad, "ruth_labels")
    labels.update(tag="boundary", holds={"component": "data.labeling", "axis": "automation", "op": "gte", "level": 1},
                  ops=[{"kind": "raise_to", "target": "data.labeling", "axis": "automation", "value": 1}])
    for k in ("concedes_target", "concedes_axis", "concedes_max_level"):
        labels.pop(k)
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("reliability_ruth has 2 boundaries" in e for e in errors)


def test_items_check_rejects_a_stakeholder_who_contradicts_themselves(env):
    ctx, item, bad = _items_and_plan(env)
    # dave asks for validation automated fully and also says he would settle for it at level 1
    _by_key(bad, "dave_versioning").update(concedes_target="data.validation", concedes_max_level=1)
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("data_dave" in e and "can never be honoured" in e for e in errors)


def test_items_check_rejects_a_challenge_that_cannot_be_passed_without_a_veto(env):
    ctx, item, bad = _items_and_plan(env)
    # ruth is high power; a boundary that needs four separate changes cannot fit a card of three
    targets = ["data.ingestion", "data.validation", "data.versioning", "data.feature_store"]
    boundary = _by_key(bad, "ruth_ingestion")
    boundary["holds"] = {"all": [{"component": t, "axis": "automation", "op": "gte", "level": 2} for t in targets]}
    boundary["ops"] = [{"kind": "raise_to", "target": t, "axis": "automation", "value": 2} for t in targets]
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("no card of at most 3 changes gets past a veto" in e for e in errors)


def test_items_checks_need_an_axis_on_every_level(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    [item] = STAGES["items"].plan(ctx)

    bad = json.loads(json.dumps(ITEMS))
    del bad["items"][6]["asserts_axis"]
    del bad["items"][1]["concedes_axis"]
    del bad["items"][2]["ops"][0]["axis"]
    bad["items"][0]["suggested_axis"] = "governance"  # data.validation allows governance 0 or 3 only
    bad["items"][0]["suggested_level"] = 2
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("asserts_level needs asserts_axis" in e for e in errors)
    assert any("concedes_max_level needs concedes_axis" in e for e in errors)
    assert any("raise_to needs an axis" in e for e in errors)
    assert any("governance level 2 is not allowed on 'data.validation'" in e for e in errors)


def test_items_checks_catch_missing_wording_on_a_broken_level(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    [item] = STAGES["items"].plan(ctx)

    bad = json.loads(json.dumps(ITEMS))
    bad["items"][6]["fact"] = "The ingestion job is currently missing."  # level 0 is broken, not absent
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("reads as absent" in e for e in errors)

    bad = json.loads(json.dumps(ITEMS))
    bad["items"][8]["fact"] = "Datasets are broken and not versioned at all."  # level 1 is absent, not broken
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("reads as something that existed and failed" in e for e in errors)


def test_items_checks_keep_game_words_out_of_the_dossier(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    [item] = STAGES["items"].plan(ctx)

    bad = json.loads(json.dumps(ITEMS))
    bad["items"][6]["fact"] = "The ingestion component has produced no new records since last night."
    bad["items"][6]["readings"]["fact"] = "F: That is simply the current state of the data stage."
    errors = STAGES["items"].check(bad, item, ctx)
    assert any("the fact says 'component'" in e for e in errors)
    assert any("reading fact says 'stage'" in e for e in errors)


# ---------- the whole pipeline ----------

def test_pipeline_assembles_into_a_config_the_game_loads_and_the_gates_pass(env):
    from content_gen.assemble import assemble
    from content_gen.gates import run_gates

    ctx, ledger = env
    llm = FakeLLM(respond)
    for stage in ("templates", "items", "artifacts", "objections", "fragments"):
        report = run(stage, ctx, ledger, llm)
        assert not report.failed, report.failed
        ledger.approve([r.item_id for r in ledger.rows(stage)])

    summary = assemble(ctx)
    assert list(summary["challenges"]) == ["ch_ingest_outage"]
    assert summary["requirements"] == 14

    report = run_gates(ctx.config_dir, ctx.work_dir, "test", SCOPE)
    assert report.errors == []

    # Re-assembling keeps the challenge id and does not duplicate content.
    again = assemble(ctx)
    assert again["challenges"] == summary["challenges"]
    reqs = json.loads((ctx.config_dir / "RequirementObjects.json").read_text())["requirements"]
    assert sum(r["id"].startswith("gen_ingest_outage_") for r in reqs) == 14

    # The generated challenge is dealt by the real scheduler in its phase.
    from mlops_serious_game.application.graph_service.scheduler import select_in_phase

    ctx2 = Context.load(ctx.config_dir, ctx.work_dir, "test", SCOPE)
    state = ctx2.start_state()
    pick = select_in_phase(ctx2.phase(2), ctx2.evaluate(state).context(ctx2.graph, state), set(), "player")
    assert pick.template_id == "ch_ingest_outage"


# ---------- gists (D52, plan 11) ----------

def respond_gists(schema, system, user):
    name = schema.__name__
    if name == "GistOut":
        m = re.search(r"Metric this note is filed under: (\S+)", user)
        metric = m.group(1) if m else "data"
        return {"gist": f"People keep raising something related to {metric} whenever this topic comes up."}
    if name == "GistVerdict":
        m = re.search(r"related to (\S+) whenever", user)
        metric = m.group(1) if m else "data"
        return {"metric_id": metric, "reading": "none", "reason": "no direction stated"}
    raise AssertionError(name)


def test_gists_plan_covers_stance_items_only_not_facts(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    run("items", ctx, ledger, FakeLLM(respond))
    ledger.approve(["items:ch_ingest_outage"])

    items = STAGES["gists"].plan(ctx)
    # 11 stances in the ITEMS fixture (one quota per stakeholder: dave 2, ruth 4, reuben 3, emilia 2);
    # the 3 facts are excluded.
    assert len(items) == 11
    assert all(i.item_id.startswith("gists:gen_ingest_outage_") for i in items)
    assert all(i.depends_on == ["items:ch_ingest_outage"] for i in items)


def test_gists_check_is_the_blind_reclassification_gate_reversed(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    run("items", ctx, ledger, FakeLLM(respond))
    ledger.approve(["items:ch_ingest_outage"])
    [item] = [i for i in STAGES["gists"].plan(ctx) if i.item_id.endswith("dave_validation")]
    assert item.inputs["metric_id"] == "data"

    ok = {"gist": "People keep raising something related to data whenever this topic comes up.",
          "verdict_metric_id": "data", "verdict_reading": "none", "verdict_reason": "no direction stated"}
    assert STAGES["gists"].check(ok, item, ctx) == []

    wrong_metric = {**ok, "verdict_metric_id": "reliability"}
    errors = STAGES["gists"].check(wrong_metric, item, ctx)
    assert any("thought this was about 'reliability'" in e for e in errors)

    leaks_direction = {**ok, "verdict_reading": "driver"}
    errors = STAGES["gists"].check(leaks_direction, item, ctx)
    assert any("committed to 'driver'" in e for e in errors)

    cares_how_much = {**ok, "gist": "He insists that data quality checks run on every batch without exception."}
    errors = STAGES["gists"].check(cares_how_much, item, ctx)
    assert any("how much they care" in e for e in errors)

    too_short = {**ok, "gist": "Data quality."}
    errors = STAGES["gists"].check(too_short, item, ctx)
    assert any("too short" in e for e in errors)


def test_gists_assemble_writes_gist_onto_stance_requirements_only(env):
    from content_gen.assemble import assemble

    ctx, ledger = env
    llm = FakeLLM(respond)
    for stage in ("templates", "items", "artifacts", "objections", "fragments"):
        report = run(stage, ctx, ledger, llm)
        assert not report.failed, report.failed
        ledger.approve([r.item_id for r in ledger.rows(stage)])

    report = run("gists", ctx, ledger, FakeLLM(respond_gists))
    assert not report.failed, report.failed
    ledger.approve([r.item_id for r in ledger.rows("gists")])

    assemble(ctx)
    reqs = json.loads((ctx.config_dir / "RequirementObjects.json").read_text())["requirements"]
    gen_reqs = [r for r in reqs if r["id"].startswith("gen_ingest_outage_")]
    stances = [r for r in gen_reqs if r["type"] != "fact"]
    facts = [r for r in gen_reqs if r["type"] == "fact"]
    assert stances and all(r.get("gist") for r in stances)
    assert facts and not any(r.get("gist") for r in facts)


def test_dialogue0_scope_is_registered_and_reuses_tier0s_shape():
    from content_gen.context import load_scope

    scope = load_scope("dialogue0")
    assert scope["phases"] == load_scope("tier0")["phases"]


# ---------- split wording ----------

def test_split_wording_keeps_the_fact_still_across_retags():
    from mlops_serious_game.domain.requirement import StakeholderIntelItem, join_wording

    item = StakeholderIntelItem(id="x", challenge_id=0, stakeholder_id="data_dave", type="driver",
                                fact="Dave wants every batch validated.", reading="He would take any improvement.")
    assert item.description == "Dave wants every batch validated. He would take any improvement."
    for wrong in ("He will not train on anything unchecked.", "He could live without it."):
        item.categorized_type = "boundary"
        item.categorized_description = join_wording(item.fact, wrong)
        assert item.shown_parts() == ("Dave wants every batch validated.", wrong)
    item.intel_type = "verified"
    assert item.shown_parts() == ("Dave wants every batch validated.", "He would take any improvement.")


def test_legacy_items_without_a_split_keep_one_sentence():
    from mlops_serious_game.domain.requirement import StakeholderIntelItem

    item = StakeholderIntelItem(id="x", challenge_id=0, stakeholder_id="data_dave", type="driver",
                                description="Dave wants validation.", categorized_description="Dave hates Emilia.")
    assert item.shown_parts() == (None, "Dave hates Emilia.")


def test_items_check_rejects_a_reason_in_the_fact(env):
    ctx, ledger = env
    run("templates", ctx, ledger, FakeLLM(respond))
    ledger.approve(["templates:p2:s0"])
    [item] = STAGES["items"].plan(ctx)
    bad = json.loads(json.dumps(ITEMS))
    bad["items"][0]["fact"] = "{data_dave} wants batches validated because training broke."
    assert any("never why" in e for e in STAGES["items"].check(bad, item, ctx))


def test_wrong_readings_does_not_confuse_a_key_that_is_a_suffix_of_another():
    from content_gen.stages.items import wrong_readings

    output = {"items": [
        {"key": "cost", "tag": "driver", "readings": {"driver": "D-cost", "boundary": "B-cost", "trade_off": "T-cost", "fact": "F-cost"}},
        {"key": "extra_cost", "tag": "boundary", "readings": {"driver": "D-extra", "boundary": "B-extra", "trade_off": "T-extra", "fact": "F-extra"}},
    ]}
    # "gen_slug_extra_cost" ends with "_cost" too, which an endswith match would mistake for the
    # "cost" item; it must resolve to the "extra_cost" item instead.
    assert wrong_readings(output, "gen_slug_extra_cost", "slug") == {"driver": "D-extra", "trade_off": "T-extra", "fact": "F-extra"}
    assert wrong_readings(output, "gen_slug_cost", "slug") == {"boundary": "B-cost", "trade_off": "T-cost", "fact": "F-cost"}


def test_name_tokens_never_eat_role_words(env):
    from content_gen.stages.common import tokenize_names

    ctx, _ = env
    text = "Data Dave said the data labeling is slow. Ruth agreed with Dave about the model registry."
    out = tokenize_names(text, ctx.stakeholders)
    assert out == ("{data_dave} said the data labeling is slow. {reliability_ruth.first} agreed with "
                   "{data_dave.first} about the model registry.")
    assert tokenize_names(out, ctx.stakeholders) == out  # idempotent
    # Sign-offs with odd whitespace, and a role word left in front of the given-name token.
    assert tokenize_names("Thanks,\nData Dave", ctx.stakeholders) == "Thanks,\n{data_dave}"
    assert tokenize_names("Thanks,\nData {data_dave.first}", ctx.stakeholders) == "Thanks,\n{data_dave}"
    # Dropped apostrophes are repaired; words valid without one are left alone.
    assert tokenize_names("Ive checked, dont worry, thats its state. Were done well.", ctx.stakeholders) == (
        "I've checked, don't worry, that's its state. Were done well.")
    # Lowercase role word before a given name is prose, not the name.
    assert tokenize_names("the data Dave cleaned", ctx.stakeholders) == "the data {data_dave.first} cleaned"


def test_forced_provider_with_no_key_fails_loudly_instead_of_falling_back(monkeypatch):
    """A forced --provider whose key is missing must error, not silently switch models
    (code-review finding: this used to fall through to whichever other provider had a key,
    or Groq, with no warning)."""
    from mlops_serious_game.config import settings

    monkeypatch.setattr(settings, "WESTAI_API_KEY", None)
    monkeypatch.setattr(settings, "MISTRAL_API_KEY", "some-mistral-key")
    from content_gen.llm import LangchainLLM

    with pytest.raises(RuntimeError, match="westai"):
        LangchainLLM(provider="westai")

    monkeypatch.setattr(settings, "WESTAI_API_KEY", "some-westai-key")
    monkeypatch.setattr(settings, "MISTRAL_API_KEY", None)
    with pytest.raises(RuntimeError, match="mistral"):
        LangchainLLM(provider="mistral")


def test_a_bare_stakeholder_id_gets_re_braced_not_left_as_plain_text(env):
    """Code-review finding: the model sometimes writes the raw internal id ("requirements_reuben")
    as plain prose instead of the name or the {id} token - this reached 6 assembled objection
    records before this fix and would have shown up verbatim in the pitch room dialogue."""
    from content_gen.stages.common import tokenize_names

    ctx, _ = env
    out = tokenize_names("requirements_reuben mentioned governed data quality checks.", ctx.stakeholders)
    assert out == "{requirements_reuben} mentioned governed data quality checks."
    # An id that is already correctly braced must not be double-wrapped.
    assert tokenize_names("{requirements_reuben} agreed.", ctx.stakeholders) == "{requirements_reuben} agreed."


def test_artifact_hint_distinguishes_broken_from_absent():
    """Code-review finding: _asserts_absent used `level <= 1`, so a level 0 (broken: it existed and
    stopped working) fact got the same ABSENT_HINT as level 1 (absent: it never existed), telling
    the model to write "does not exist" for something that broke."""
    from content_gen.stages.artifacts import ABSENT_HINT, BROKEN_HINT, _asserts_absent, _asserts_broken
    from mlops_serious_game.domain.requirement import FactAssertion, StakeholderRequirement

    def fact(level):
        return StakeholderRequirement(
            id="x", challenge_id=1, type="fact", description="d",
            asserts=FactAssertion(target="req.x", axis="automation", level=level),
        )

    broken = fact(0)
    absent = fact(1)
    manual = fact(2)

    assert _asserts_broken(broken) and not _asserts_absent(broken)
    assert _asserts_absent(absent) and not _asserts_broken(absent)
    assert not _asserts_broken(manual) and not _asserts_absent(manual)
    assert ABSENT_HINT != BROKEN_HINT


def test_bare_stakeholder_id_errors_flags_a_leak_and_clears_once_fixed():
    from content_gen.stages.common import bare_stakeholder_id_errors

    stakeholders = {"requirements_reuben": None}
    assert bare_stakeholder_id_errors(
        "objection", "requirements_reuben mentioned governed data quality checks.", stakeholders
    )
    assert not bare_stakeholder_id_errors(
        "objection", "{requirements_reuben} mentioned governed data quality checks.", stakeholders
    )
    assert not bare_stakeholder_id_errors("objection", "", stakeholders)


def test_repair_keeps_drivers_under_the_ceilings_of_their_challenge():
    from content_gen.stages.items import repair_foreclosures

    conflict = {"type": "hard", "target": "data.validation", "positions": []}
    current = {"data.versioning": {"automation": 1}, "e.validate_version": {"automation": 2}}
    items = [
        {"tag": "trade_off", "concedes_target": "e.validate_version", "concedes_axis": "automation", "concedes_max_level": 2},
        {"tag": "driver", "suggested_target": "data.versioning", "suggested_axis": "automation", "suggested_level": 3,
         "ops": [{"kind": "raise_to", "target": "e.validate_version", "axis": "automation", "value": 3},
                 {"kind": "raise_to", "target": "data.ingestion", "axis": "automation", "value": 3}]},
        {"tag": "trade_off", "concedes_target": "data.versioning", "concedes_axis": "automation", "concedes_max_level": 2},
    ]
    repair_foreclosures(items, conflict, current)
    driver = items[1]
    assert driver["suggested_level"] == 2  # lowered to the ceiling, still above the current 1
    assert [o["target"] for o in driver["ops"]] == ["data.ingestion"]  # the step past the ceiling is dropped
