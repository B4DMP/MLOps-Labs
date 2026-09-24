"""Everything a stage needs to know about the game, loaded once from a gameConfig directory."""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

HERE = Path(__file__).resolve().parent
DEFAULT_WORK = HERE / "work"


def default_config_dir() -> Path:
    for candidate in (HERE.parents[2] / "gameConfig", Path("/gameConfig")):
        if (candidate / "MlopsGraph.json").exists():
            return candidate
    raise SystemExit("gameConfig directory not found, pass --config")


def load_scope(name: str) -> dict:
    scopes = json.loads((HERE / "scopes.json").read_text(encoding="utf-8"))
    if name not in scopes:
        raise SystemExit(f"unknown scope '{name}', known: {sorted(scopes)}")
    return scopes[name]


@dataclass
class Context:
    config_dir: Path
    work_dir: Path
    scope_name: str
    scope: dict
    graph: Any = None
    patterns: list = field(default_factory=list)
    pattern_order: list = field(default_factory=list)
    phases: list = field(default_factory=list)
    stakeholders: dict = field(default_factory=dict)
    metric_ids: set = field(default_factory=set)
    setting_block: str = ""
    setting_digest: str = "none"

    @classmethod
    def load(cls, config_dir: Optional[Path] = None, work_dir: Optional[Path] = None, scope: str = "tier0",
             scope_data: Optional[dict] = None) -> "Context":
        from mlops_serious_game.domain.gameConfigLoader import GameConfigLoader
        from mlops_serious_game.domain.graph_factory import GraphFactory
        from mlops_serious_game.domain.metric_factory import MetricFactory
        from mlops_serious_game.domain.pattern import PatternFactory
        from mlops_serious_game.domain.phase_factory import PhaseFactory
        from mlops_serious_game.domain.setting_factory import SettingFactory
        from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

        config_dir = config_dir or default_config_dir()
        GameConfigLoader.initialize(config_dir)
        ctx = cls(config_dir=config_dir, work_dir=work_dir or DEFAULT_WORK, scope_name=scope,
                  scope=scope_data if scope_data is not None else load_scope(scope))
        ctx.graph = GraphFactory.get_graph()
        ctx.patterns = list(PatternFactory.patterns)
        ctx.pattern_order = list(PatternFactory.order)
        ctx.phases = list(PhaseFactory.get_phases())
        ctx.stakeholders = {s.id: s for s in StakeholderFactory.stakeholders}
        ctx.metric_ids = set(MetricFactory.get_available_metrics())
        ctx.setting_block = SettingFactory.full_block()
        ctx.setting_digest = SettingFactory.digest()
        return ctx

    def stage_version(self, stage) -> str:
        """What a stage's output depends on besides its inputs: the prompt and the world it is set in.

        Editing Setting.json therefore marks generated content stale, the same way editing a prompt
        does, instead of leaving half the game in the old world."""
        return f"{stage.prompt_version}+{self.setting_digest}"

    # ---- paths ----

    @property
    def ledger_path(self) -> Path:
        return self.work_dir / "ledger.sqlite"

    def out_path(self, stage: str, item_id: str) -> Path:
        return self.work_dir / "out" / stage / f"{item_id.replace(':', '__')}.json"

    def approved(self, stage: str) -> list[dict]:
        """Records of approved outputs of a stage, in item order."""
        from content_gen.ledger import Ledger

        ledger = Ledger(self.ledger_path)
        try:
            rows = [r for r in ledger.rows(stage) if r.status == "approved"]
        finally:
            ledger.close()
        # Paths are relative to the work dir so a ledger written in the container works on the host.
        return [json.loads((self.work_dir / r.output_path).read_text(encoding="utf-8")) for r in rows]

    # ---- game lookups ----

    def phase(self, phase_id: int):
        return next(p for p in self.phases if p.id == phase_id)

    def stage_for_phase(self, phase_id: int) -> str:
        """The graph stage a phase's challenges live in.

        The introduction phase has no stage of its own. The game already treats it as the first
        lifecycle stage (see the websocket pitch handler), and content generation follows: its
        challenge argues about the same requirements the project is starting from."""
        stage = next((s.id for s in self.graph.stages if s.phase_id == phase_id), None)
        if stage is None:
            first = min((s.phase_id for s in self.graph.stages if s.phase_id is not None), default=None)
            stage = next((s.id for s in self.graph.stages if s.phase_id == first), None)
        if stage is None:
            raise SystemExit(f"no graph stage for phase {phase_id}, and no lifecycle stage to fall back to")
        return stage

    def templates_for_phase(self, phase_id: int) -> int:
        """How many challenges this phase gets. The introduction gets one, everything else the
        scope's usual number."""
        if phase_id == self.scope.get("intro_phase"):
            return 1
        return self.scope["templates_per_phase"]

    def roster(self, phase_id: int) -> list[dict]:
        """Stakeholders in the room for a phase, with what the model needs to write for them."""
        out = []
        for ps in self.phase(phase_id).stakeholders:
            st = self.stakeholders[ps.stakeholder_id]
            out.append({
                "stakeholder_id": st.id,
                "name": st.name,
                "role": st.role_description,
                "priorities": st.priorities,
                "metric_id": st.metric_id,
                "power": ps.power,
                "interest": ps.interest,
            })
        return out

    def graph_slice(self, stage_id: str) -> dict:
        """Components and edges of one stage, as the model should see them: start value and allowed
        values per axis (automation and governance are independent, 00-plan.md §2.1)."""
        g = self.graph
        comps = [
            {
                "id": c.id,
                "name": c.name,
                "start_automation": c.initial_automation,
                "start_governance": c.initial_governance,
                "allowed_automation": c.allowed_automation,
                "allowed_governance": c.allowed_governance,
                "owner": g.owner_of(c.id),
                "attributes": {k: a.values for k, a in c.attributes.items()},
            }
            for c in g.components
            if c.stage_id == stage_id
        ]
        ids = {c["id"] for c in comps}
        edges = [
            {
                "id": e.id,
                "from": e.from_id,
                "to": e.to_id,
                "kind": e.kind,
                "start_automation": e.initial_automation,
                "start_governance": e.initial_governance,
                "start_trigger": e.initial_trigger,
                "allowed_automation": e.allowed_automation,
                "allowed_governance": e.allowed_governance,
                "allowed_triggers": e.allowed_triggers,
            }
            for e in g.edges
            if e.from_id in ids or e.to_id in ids
        ]
        instances = [
            {"id": i.id, "kind": i.kind, "on": i.component_id, "props": g.with_default_props(i).props,
             "property_values": {k: p.values for k, p in g.instance_kinds[i.kind].properties.items()}}
            for i in g.initial_instances
            if i.component_id in ids
        ]
        return {"stage": stage_id, "components": comps, "edges": edges, "instances": instances}

    def patterns_touching(self, stage_id: str) -> list[dict]:
        from mlops_serious_game.domain.pattern import predicate_targets

        out = []
        for p in self.patterns:
            if any(self.graph.is_target(t) and self.graph.stage_of(t) == stage_id for t in predicate_targets(p.when)):
                out.append({"id": p.id, "kind": p.kind, "name": p.name, "description": p.description})
        return out

    def start_state(self):
        from mlops_serious_game.domain.graph import GraphState

        return GraphState.from_config(self.graph)

    def evaluate(self, state):
        from mlops_serious_game.application.graph_service.view import evaluate_graph

        return evaluate_graph(self.graph, state, self.patterns, self.pattern_order)

    def stage_health(self, state, stage_id: str) -> float:
        return next(s.health for s in self.evaluate(state).stage_graph.stages if s.id == stage_id)
