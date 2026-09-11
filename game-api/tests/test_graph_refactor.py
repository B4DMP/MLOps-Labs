import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import graph_refactor  # noqa: E402

from mlops_serious_game.application.graph_service.apply import replay  # noqa: E402
from mlops_serious_game.domain.graph import GraphOp, LoggedOp, TechnicalGraph  # noqa: E402
from mlops_serious_game.domain.graph_factory import validate_graph  # noqa: E402


def _load(path: Path) -> TechnicalGraph:
    """Validates like GraphFactory.load_graph without replacing the process-wide graph."""
    graph = TechnicalGraph.model_validate(json.loads(path.read_text(encoding="utf-8")))
    validate_graph(graph)
    return graph


@pytest.fixture
def config(tmp_path: Path) -> Path:
    try:
        src = graph_refactor.default_config_dir()
    except SystemExit:
        pytest.skip("gameConfig not found")
    dst = tmp_path / "gameConfig"
    dst.mkdir()
    for name in ("MlopsGraph.json", "MlopsStoryFragments.json"):
        shutil.copy(src / name, dst / name)
    # A content file referencing the graph the way patterns and intel items will.
    (dst / "Content.json").write_text(json.dumps({
        "items": [
            {"when": {"component": "data.validation", "op": "gte", "level": 4}},
            {"when": {"attr": "data.validation.tool", "value": "deequ"}},
            {"when": {"edge": "e.ingest_validate", "op": "gte", "level": 3}},
        ]
    }), encoding="utf-8")
    return dst


def test_refs_finds_values_keys_and_attribute_references(config):
    refs = graph_refactor.find_refs(config, "data.validation")
    kinds = {(r.file, r.kind) for r in refs}
    assert ("MlopsStoryFragments.json", "key") in kinds
    assert ("Content.json", "value") in kinds
    assert ("Content.json", "attr") in kinds


def test_check_reports_dangling_references(config):
    assert graph_refactor.check(config) == []
    content = json.loads((config / "Content.json").read_text())
    content["items"].append({"when": {"component": "data.nope", "level": 2}})
    (config / "Content.json").write_text(json.dumps(content))
    assert [r.text for r in graph_refactor.check(config)] == ["data.nope"]


def test_rename_rewrites_everything_and_keeps_old_logs_replaying(config):
    changes = graph_refactor.rename(config, "data.validation", "data.validation_gate")
    assert set(changes) == {"MlopsGraph.json", "MlopsStoryFragments.json", "Content.json"}
    assert graph_refactor.check(config) == []
    text = (config / "Content.json").read_text()
    assert "data.validation_gate.tool" in text and '"data.validation"' not in text

    graph = _load(config / "MlopsGraph.json")
    assert graph.aliases == {"data.validation": "data.validation_gate"}
    old_log = [LoggedOp(seq=0, op=GraphOp(kind="set_to", target="data.validation", value=4))]
    assert replay(graph, old_log).state.level("data.validation_gate") == 4


def test_dry_run_changes_nothing(config):
    before = {p.name: p.read_text() for p in config.glob("*.json")}
    graph_refactor.rename(config, "data.validation", "data.validation_gate", dry_run=True)
    assert before == {p.name: p.read_text() for p in config.glob("*.json")}


def test_retire_component_drops_its_edges_and_reports_leftovers(config):
    removed, leftovers = graph_refactor.retire(config, "data.validation")
    assert removed == ["data.validation", "e.ingest_validate", "e.validate_version"]
    assert {r.file for r in leftovers} == {"MlopsStoryFragments.json", "Content.json"}


def test_ops_on_retired_ids_are_skipped_on_replay(config):
    graph_refactor.retire(config, "e.cicd_shadow")
    graph = _load(config / "MlopsGraph.json")
    log = [LoggedOp(seq=0, op=GraphOp(kind="set_to", target="e.cicd_shadow", value=4))]
    result = replay(graph, log)
    assert result.rejected == []
    assert "e.cicd_shadow" not in result.state.edge_levels


def test_rename_refuses_collisions_and_kind_changes(config):
    with pytest.raises(SystemExit):
        graph_refactor.rename(config, "data.validation", "data.ingestion")
    with pytest.raises(SystemExit):
        graph_refactor.rename(config, "data.validation", "e.validation")
