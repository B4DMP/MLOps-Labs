"""The content harness end to end with a fake model: ledger, runner, stage checks, assembly, gates."""

import asyncio
import json
import re
import shutil
import sys
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
    "stances_per_template": [6, 10],
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
    "preconditions": {"component": "data.validation", "op": "lte", "level": 1},
    "priority": 60,
    "on_enter_ops": [
        {"kind": "set_to", "target": "data.ingestion", "value": "0", "reason": "the nightly export died"},
        {"kind": "set_to", "target": "data.labeling", "value": "0", "reason": "the labelling tool lost its input"},
    ],
    "stalemate_ops": [{"kind": "set_to", "target": "e.validate_version", "value": "0", "reason": "nobody owned the hand over"}],
    "conflict": {"target": "data.validation",
                 "positions": [{"stakeholder_id": "data_dave", "wants": 3}, {"stakeholder_id": "efficiency_emilia", "wants": 1}]},
}

ITEMS = {"items": [
    {"key": "dave_validation", "tag": "driver", "stakeholder_id": "data_dave",
     "fact": "{data_dave} wants every incoming batch validated automatically.",
     "readings": {"driver": "D: He would take any improvement he can get.", "boundary": "B: He would take any improvement he can get.", "trade_off": "T: He would take any improvement he can get.", "fact": "F: He would take any improvement he can get."},
     "metric_id": "data", "suggested_target": "data.validation", "suggested_level": 3},
    {"key": "dave_versioning", "tag": "driver", "stakeholder_id": "data_dave",
     "fact": "{data_dave} wants each dataset versioned.",
     "readings": {"driver": "D: More versioning is always better in his book.", "boundary": "B: More versioning is always better in his book.", "trade_off": "T: More versioning is always better in his book.", "fact": "F: More versioning is always better in his book."},
     "metric_id": "data", "suggested_target": "data.versioning", "suggested_level": 3},
    {"key": "ruth_ingestion", "tag": "boundary", "stakeholder_id": "reliability_ruth",
     "fact": "{reliability_ruth} wants the ingestion job running again.",
     "readings": {"driver": "D: She will not sign off on anything until it is.", "boundary": "B: She will not sign off on anything until it is.", "trade_off": "T: She will not sign off on anything until it is.", "fact": "F: She will not sign off on anything until it is."},
     "holds": {"component": "data.ingestion", "op": "gte", "level": 2},
     "ops": [{"kind": "raise_to", "target": "data.ingestion", "value": "2"}]},
    {"key": "ruth_handover", "tag": "driver", "stakeholder_id": "reliability_ruth",
     "fact": "{reliability_ruth} wants the hand over into validation to run on its own.",
     "readings": {"driver": "D: Every step closer to that helps her.", "boundary": "B: Every step closer to that helps her.", "trade_off": "T: Every step closer to that helps her.", "fact": "F: Every step closer to that helps her."},
     "metric_id": "reliability", "suggested_target": "e.ingest_validate", "suggested_level": 3},
    {"key": "emilia_cost", "tag": "trade_off", "stakeholder_id": "efficiency_emilia",
     "fact": "{efficiency_emilia} agreed to discuss automated validation.",
     "readings": {"driver": "D: She can live with paying for it if the outages end.", "boundary": "B: She can live with paying for it if the outages end.", "trade_off": "T: She can live with paying for it if the outages end.", "fact": "F: She can live with paying for it if the outages end."},
     "concedes_target": "data.validation", "concedes_max_level": 3},
    {"key": "reuben_contract", "tag": "driver", "stakeholder_id": "requirements_reuben",
     "fact": "{requirements_reuben} wants the data contract applied to every ingestion run.",
     "readings": {"driver": "D: The closer the better, as far as he is concerned.", "boundary": "B: The closer the better, as far as he is concerned.", "trade_off": "T: The closer the better, as far as he is concerned.", "fact": "F: The closer the better, as far as he is concerned."},
     "metric_id": "requirements", "suggested_target": "e.contracts_ingest", "suggested_level": 2},
    {"key": "fact_ingestion", "tag": "fact",
     "fact": "The ingestion job has produced no new records since last night.",
     "readings": {"driver": "D: That is simply the current state of the pipeline.", "boundary": "B: That is simply the current state of the pipeline.", "trade_off": "T: That is simply the current state of the pipeline.", "fact": "F: That is simply the current state of the pipeline."},
     "asserts_target": "data.ingestion", "asserts_level": 0},
    {"key": "fact_handover", "tag": "fact",
     "fact": "New data is moved into validation by hand, on request.",
     "readings": {"driver": "D: That is how it works today.", "boundary": "B: That is how it works today.", "trade_off": "T: That is how it works today.", "fact": "F: That is how it works today."},
     "asserts_target": "e.ingest_validate", "asserts_level": 2, "asserts_trigger": "manual_request"},
    {"key": "fact_versioning", "tag": "fact",
     "fact": "Datasets are not versioned at all.",
     "readings": {"driver": "D: Nothing more to it than that.", "boundary": "B: Nothing more to it than that.", "trade_off": "T: Nothing more to it than that.", "fact": "F: Nothing more to it than that."},
     "asserts_target": "data.versioning", "asserts_level": 1},
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
        return {f"level_{lv}": f"This part of the pipeline sits at level {lv} today." for lv in range(5)}
    raise AssertionError(name)


@pytest.fixture
def env(tmp_path):
    src = Path(__file__).resolve().parents[2] / "gameConfig"
    if not src.exists():
        src = Path("/gameConfig")
    cfg = tmp_path / "gameConfig"
    shutil.copytree(src, cfg)
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
    harmless = dict(TEMPLATE, on_enter_ops=[{"kind": "set_to", "target": "data.validation", "value": "1", "reason": "x"}])
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
    assert summary["requirements"] == 9

    report = run_gates(ctx.config_dir, ctx.work_dir, "test", SCOPE)
    assert report.errors == []

    # Re-assembling keeps the challenge id and does not duplicate content.
    again = assemble(ctx)
    assert again["challenges"] == summary["challenges"]
    reqs = json.loads((ctx.config_dir / "RequirementObjects.json").read_text())["requirements"]
    assert sum(r["id"].startswith("gen_ingest_outage_") for r in reqs) == 9

    # The generated challenge is dealt by the real scheduler in its phase.
    from mlops_serious_game.application.graph_service.scheduler import select_in_phase

    ctx2 = Context.load(ctx.config_dir, ctx.work_dir, "test", SCOPE)
    state = ctx2.start_state()
    pick = select_in_phase(ctx2.phase(2), ctx2.evaluate(state).context(ctx2.graph, state), set(), "player")
    assert pick.template_id == "ch_ingest_outage"


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


def test_name_tokens_never_eat_role_words(env):
    from content_gen.stages.common import tokenize_names

    ctx, _ = env
    text = "Data Dave said the data labeling is slow. Ruth agreed with Dave about the model registry."
    out = tokenize_names(text, ctx.stakeholders)
    assert out == ("{data_dave} said the data labeling is slow. {reliability_ruth.first} agreed with "
                   "{data_dave.first} about the model registry.")
    assert tokenize_names(out, ctx.stakeholders) == out  # idempotent
