"""MLOps environment graph: config models and runtime state.

The technical graph (components and the edges between them) is authored in
gameConfig/MlopsGraph.json. Player state is never stored as a snapshot: it is the fold of
an append-only op log, see application/graph_service.
"""

from enum import IntEnum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Level(IntEnum):
    """Maturity of a component or edge. `broken` sits below `absent` on purpose: a failing
    check nobody trusts is worse than no check."""

    BROKEN = 0
    ABSENT = 1
    MANUAL = 2
    SCRIPTED = 3
    AUTOMATED = 4
    GOVERNED = 5


MAX_LEVEL = int(Level.GOVERNED)


def parse_level(value: Any) -> int:
    """Accepts 4, "4" or "automated"."""
    if isinstance(value, str):
        if value.isdigit():
            value = int(value)
        else:
            try:
                return int(Level[value.upper()])
            except KeyError:
                raise ValueError(f"unknown level '{value}'") from None
    level = int(value)
    if not Level.BROKEN <= level <= MAX_LEVEL:
        raise ValueError(f"level {level} out of range")
    return level

EdgeKind = Literal["pipeline", "feedback", "governs"]
OpKind = Literal["raise_to", "set_to", "set_trigger", "set_attr", "instance_upsert", "observe"]
SourceKind = Literal["intel", "action_card", "world_event", "challenge_seed", "admin"]
KnowledgeState = Literal["unknown", "current", "stale"]


class AttributeDef(BaseModel):
    """Story-only property of a component. Never read by health."""

    values: list[str]
    initial: str

    @model_validator(mode="after")
    def _initial_in_values(self):
        if self.initial not in self.values:
            raise ValueError(f"initial '{self.initial}' not in {self.values}")
        return self


class Stage(BaseModel):
    id: str
    name: str
    phase_id: Optional[int] = None
    weight: float = 1.0
    owner_role: Optional[str] = None
    band: bool = Field(default=False, description="Cross-cutting band drawn under the pipeline, not a step in it")


class Component(BaseModel):
    id: str
    stage_id: str
    name: str
    owner_role: Optional[str] = Field(default=None, description="None means the stage owner")
    weight: float = 1.0
    initial_level: int
    allowed_levels: list[int]
    attributes: dict[str, AttributeDef] = Field(default_factory=dict)


class Edge(BaseModel):
    """A workflow between two components. Pipeline edges cap what flows downstream."""

    id: str
    from_id: str = Field(alias="from")
    to_id: str = Field(alias="to")
    kind: EdgeKind
    slack: int = Field(default=0, ge=0, le=1, description="0 hard dependency, 1 soft")
    initial_level: int
    initial_trigger: str = "none"
    allowed_levels: list[int]
    allowed_triggers: list[str]

    model_config = {"populate_by_name": True}


class GraphThresholds(BaseModel):
    healthy: int = 75
    degraded: int = 45
    health_base: float = 20
    maturity_weight: float = 40
    debt_penalty_per_entry: float = 6
    debt_buyin_threshold: float = 0.4


class TechnicalGraph(BaseModel):
    levels: list[str]
    triggers: list[str]
    instance_kinds: list[str]
    instance_states: list[str]
    thresholds: GraphThresholds = Field(default_factory=GraphThresholds)
    briefing_observed: list[str] = Field(default_factory=list)
    stages: list[Stage]
    components: list[Component]
    edges: list[Edge]

    # Lookup maps, filled after validation.
    _stages: dict[str, Stage] = {}
    _components: dict[str, Component] = {}
    _edges: dict[str, Edge] = {}

    def model_post_init(self, __context: Any) -> None:
        self._stages = {s.id: s for s in self.stages}
        self._components = {c.id: c for c in self.components}
        self._edges = {e.id: e for e in self.edges}

    def stage(self, stage_id: str) -> Stage:
        return self._stages[stage_id]

    def component(self, component_id: str) -> Component:
        return self._components[component_id]

    def edge(self, edge_id: str) -> Edge:
        return self._edges[edge_id]

    def is_component(self, target_id: str) -> bool:
        return target_id in self._components

    def is_edge(self, target_id: str) -> bool:
        return target_id in self._edges

    def is_target(self, target_id: str) -> bool:
        return self.is_component(target_id) or self.is_edge(target_id)

    def allowed_levels(self, target_id: str) -> list[int]:
        if self.is_component(target_id):
            return self._components[target_id].allowed_levels
        return self._edges[target_id].allowed_levels

    def owner_of(self, target_id: str) -> Optional[str]:
        """Component owner, falling back to its stage owner. Edges belong to the owner of the
        component they feed."""
        if self.is_edge(target_id):
            target_id = self._edges[target_id].to_id
        comp = self._components[target_id]
        return comp.owner_role or self._stages[comp.stage_id].owner_role

    def stage_of(self, target_id: str) -> str:
        if self.is_edge(target_id):
            target_id = self._edges[target_id].to_id
        return self._components[target_id].stage_id

    def pipeline_edges(self) -> list[Edge]:
        return [e for e in self.edges if e.kind == "pipeline"]


class Instance(BaseModel):
    """A concrete named thing in the graph (dataset, model, endpoint...). Story and patterns only."""

    id: str
    kind: str
    component_id: str
    name: str
    state: str
    attrs: dict[str, str] = Field(default_factory=dict)
    links: list[str] = Field(default_factory=list)


class GraphOp(BaseModel):
    kind: OpKind
    target: str
    value: Any = None
    attr: Optional[str] = Field(default=None, description="Attribute name for set_attr")
    intended: Optional[int] = Field(
        default=None, description="Set when an unhappy owner degraded a raise: the level that was asked for"
    )
    source_kind: SourceKind = "admin"
    source_id: Optional[str] = None
    reason: Optional[str] = None

    @model_validator(mode="after")
    def _normalise(self):
        # Content writes set_attr targets as "stage.component.attr"; normalise to target + attr.
        if self.kind == "set_attr" and self.attr is None and self.target.count(".") >= 2:
            self.target, self.attr = self.target.rsplit(".", 1)
        if self.kind in ("raise_to", "set_to"):
            self.value = parse_level(self.value)
        return self


class LoggedOp(BaseModel):
    """An op as it sits in the log, with its global order."""

    seq: int
    op: GraphOp


class DebtEntry(BaseModel):
    target_id: str
    intended_level: int
    applied_level: int
    owner_id: Optional[str] = None
    source_id: Optional[str] = None


class GraphState(BaseModel):
    """Ground truth. Built by folding the op log, never persisted as such."""

    component_levels: dict[str, int] = Field(default_factory=dict)
    edge_levels: dict[str, int] = Field(default_factory=dict)
    edge_triggers: dict[str, str] = Field(default_factory=dict)
    attrs: dict[str, dict[str, str]] = Field(default_factory=dict)
    instances: dict[str, Instance] = Field(default_factory=dict)
    debt: list[DebtEntry] = Field(default_factory=list)
    changed_at: dict[str, int] = Field(
        default_factory=dict, description="Seq of the last op that changed each target, drives knowledge staleness"
    )

    @classmethod
    def from_config(cls, graph: TechnicalGraph) -> "GraphState":
        return cls(
            component_levels={c.id: c.initial_level for c in graph.components},
            edge_levels={e.id: e.initial_level for e in graph.edges},
            edge_triggers={e.id: e.initial_trigger for e in graph.edges},
            attrs={c.id: {name: a.initial for name, a in c.attributes.items()} for c in graph.components},
        )

    def level(self, target_id: str) -> int:
        if target_id in self.component_levels:
            return self.component_levels[target_id]
        return self.edge_levels[target_id]


class SeenEntry(BaseModel):
    """What the player saw of one target, and when."""

    seq: int
    nominal: int
    effective: int
    trigger: Optional[str] = None
    attrs: dict[str, str] = Field(default_factory=dict)


class Knowledge(BaseModel):
    seen: dict[str, SeenEntry] = Field(default_factory=dict)

    def state_of(self, target_id: str, truth: GraphState) -> KnowledgeState:
        entry = self.seen.get(target_id)
        if entry is None:
            return "unknown"
        return "current" if entry.seq >= truth.changed_at.get(target_id, -1) else "stale"
