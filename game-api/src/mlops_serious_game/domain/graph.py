"""MLOps environment graph: config models and runtime state.

The technical graph (components and the edges between them) is authored in
gameConfig/MlopsGraph.json. Player state is never stored as a snapshot: it is the fold of
an append-only op log, see application/graph_service.

Two independent maturity axes (docs/plans/graph-governance-automation-rework/00-plan.md):
`AutomationState` (is the work done by a person or by tooling) and `GovernanceLevel` (how
strictly a target's content/hand-off is reviewed). There is no combined "level" mechanic -
every op, predicate clause and debt entry names the axis it operates on explicitly.
"""

from enum import IntEnum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class AutomationState(IntEnum):
    """Is the work on a target done by a person or by tooling. `broken` sits below `absent` on
    purpose: a failing check nobody trusts is worse than no check. Decoupled from
    `GovernanceLevel` - a target can be manual-but-strictly-reviewed or automated-but-
    unsupervised. Never player-settable to `broken`: only world events/challenges/admin may."""

    BROKEN = 0
    ABSENT = 1
    MANUAL = 2
    AUTOMATED = 3


MAX_AUTOMATION = int(AutomationState.AUTOMATED)


class GovernanceLevel(IntEnum):
    """How strictly a target's content (component) or hand-off (edge) is reviewed. Independent
    of `AutomationState` - governance never caps `EffectiveView`, it only affects
    metrics/requirements/patterns."""

    NONE = 0
    PARTIAL_1 = 1
    PARTIAL_2 = 2
    FULL = 3


MAX_GOVERNANCE = int(GovernanceLevel.FULL)

Axis = Literal["automation", "governance"]


def parse_automation(value: Any) -> int:
    """Accepts 3, "3" or "automated"."""
    if isinstance(value, str):
        if value.isdigit():
            value = int(value)
        else:
            try:
                return int(AutomationState[value.upper()])
            except KeyError:
                raise ValueError(f"unknown automation state '{value}'") from None
    level = int(value)
    if not AutomationState.BROKEN <= level <= MAX_AUTOMATION:
        raise ValueError(f"automation level {level} out of range")
    return level


def parse_governance(value: Any) -> int:
    """Accepts 3, "3" or "full"."""
    if isinstance(value, str):
        if value.isdigit():
            value = int(value)
        else:
            try:
                return int(GovernanceLevel[value.upper()])
            except KeyError:
                raise ValueError(f"unknown governance level '{value}'") from None
    level = int(value)
    if not GovernanceLevel.NONE <= level <= MAX_GOVERNANCE:
        raise ValueError(f"governance level {level} out of range")
    return level


def parse_axis_level(axis: Axis, value: Any) -> int:
    return parse_governance(value) if axis == "governance" else parse_automation(value)


NARRATIVE_TIER_NAMES = ("broken", "absent", "manual", "automated", "governed")
NARRATIVE_TIERS = len(NARRATIVE_TIER_NAMES)  # see narrative_tier()


def narrative_tier(automation: int, governance: int) -> int:
    """A single 0-4 storytelling tier for authored flavor text (MlopsStoryFragments.json) only -
    never used for gameplay logic (predicates, requirements, capping and scoring all read the two
    real axes directly, see graph_predicates.py and application/graph_service). Broken/absent
    automation gates governance out of the tier entirely: nothing exists yet (or it's failing) to
    have been reviewed, so a target can't narrate as "governed" while its automation sits at
    broken or absent, however far its governance axis independently is."""
    if automation <= AutomationState.ABSENT:
        return int(automation)
    if governance >= GovernanceLevel.FULL:
        return 4  # narrated as "governed"
    if automation >= AutomationState.AUTOMATED:
        return 3  # narrated as "automated"
    return int(automation)


# Triggers that mean nobody or a person starts the work. Every other trigger is automatic.
NON_AUTOMATIC_TRIGGERS = frozenset({"none", "manual_request"})

EdgeKind = Literal["pipeline", "feedback"]
OpKind = Literal[
    "raise_to", "set_to", "set_trigger", "set_attr", "instance_upsert", "set_instance_prop", "observe"
]
SourceKind = Literal["intel", "action_card", "world_event", "challenge_seed", "admin"]
KnowledgeState = Literal["unknown", "current", "stale"]


class EnumProperty(BaseModel):
    """Shared shape for a named property with an ordered/allowed set of string values and an
    initial value that must be one of them (code-review finding, A/A2 passes). `AttributeDef`
    and `InstanceProperty` are semantically distinct - which one applies is about *where* the
    property lives (component story attribute, never read by health, vs. instance kind
    property, read by patterns and preconditions per D21/D31) - not about field shape, so they
    stay separate subclasses rather than being collapsed into one name.
    """

    values: list[str]
    initial: str

    @model_validator(mode="after")
    def _initial_in_values(self):
        if self.initial not in self.values:
            raise ValueError(f"initial '{self.initial}' not in {self.values}")
        return self


class AttributeDef(EnumProperty):
    """Story-only property of a component. Never read by health."""


class Stage(BaseModel):
    id: str
    name: str
    phase_id: Optional[int] = None
    weight: float = 1.0
    owner_role: Optional[str] = None


class Option(BaseModel):
    """One player-facing action: moves a target exactly one step up a single axis
    (docs/plans/graph-governance-automation-rework/00-plan.md §2.3/§2.4). `to_level` is the rung
    it lands on; the rung it starts from is whatever the target currently sits at - an option is
    only offered when the target's current value on that axis is the allowed rung immediately
    below `to_level`. Authored individually per component/edge, never a generic reusable type."""

    to_level: int
    trigger: Optional[str] = Field(default=None, description="Automation options on edges only")
    name: str
    description: str


class Component(BaseModel):
    id: str
    stage_id: str
    name: str
    owner_role: Optional[str] = Field(default=None, description="None means the stage owner")
    weight: float = 1.0
    initial_automation: int
    initial_governance: int
    allowed_automation: list[int]
    allowed_governance: list[int]
    attributes: dict[str, AttributeDef] = Field(default_factory=dict)
    automation_options: list[Option] = Field(default_factory=list)
    governance_options: list[Option] = Field(default_factory=list)
    layout: Optional[dict] = Field(default=None, description="SVG layout hint {x, y} for the stage modal")
    icon: Optional[str] = Field(default=None, description="Iconify icon name for this component")


class Edge(BaseModel):
    """A workflow between two components. Pipeline edges cap what flows downstream (automation
    axis only - governance never caps, 00-plan.md decision 1)."""

    id: str
    from_id: str = Field(alias="from")
    to_id: str = Field(alias="to")
    kind: EdgeKind
    slack: int = Field(default=0, ge=0, le=1, description="0 hard dependency, 1 soft")
    stage_flow: bool = Field(
        default=True,
        description=(
            "Whether this edge counts as a hand-off between its two stages. False for a "
            "specification dependency - one component defining the bar another is judged "
            "against - which constrains levels like any pipeline edge but is not a step of "
            "the lifecycle and must not be drawn as one."
        ),
    )
    initial_automation: int
    initial_governance: int
    initial_trigger: str = "none"
    allowed_automation: list[int]
    allowed_governance: list[int]
    allowed_triggers: list[str]
    automation_options: list[Option] = Field(default_factory=list)
    governance_options: list[Option] = Field(default_factory=list)

    model_config = {"populate_by_name": True}

    @property
    def default_automatic_trigger(self) -> Optional[str]:
        """Trigger an edge gets when it is raised to automated without naming one."""
        return next((t for t in self.allowed_triggers if t not in NON_AUTOMATIC_TRIGGERS), None)


def trigger_for_automation(edge: Edge, automation: int, current: Optional[str]) -> Optional[str]:
    """The trigger an edge must carry at automation state `automation`: none when absent or
    broken, manual_request when manual, an automatic one when automated (keeping the current one
    if it fits). Triggers are an automation-axis concept only (00-plan.md §2.2) - governance never
    changes what trigger an edge carries."""
    if automation <= AutomationState.ABSENT:
        return "none"
    if automation == AutomationState.MANUAL:
        return "manual_request"
    if current is not None and current not in NON_AUTOMATIC_TRIGGERS:
        return current
    return edge.default_automatic_trigger


class InstanceProperty(EnumProperty):
    """An ordered property of an instance kind. Comparisons use the order of `values`;
    for quality-like properties it runs from worst to best."""


class InstanceKind(BaseModel):
    properties: dict[str, InstanceProperty] = Field(default_factory=dict)


class GraphThresholds(BaseModel):
    healthy: int = 75
    degraded: int = 45
    broken_penalty_per_target: float = 15
    debt_penalty_per_entry: float = 6
    debt_buyin_threshold: float = 0.4


class TechnicalGraph(BaseModel):
    automation_states: list[str]
    governance_levels: list[str]
    triggers: list[str]
    instance_kinds: dict[str, InstanceKind]
    instance_states: list[str]
    thresholds: GraphThresholds = Field(default_factory=GraphThresholds)
    briefing_observed: list[str] = Field(default_factory=list)
    aliases: dict[str, str] = Field(
        default_factory=dict, description="Renamed ids, old -> new. Written by tools/graph_refactor.py"
    )
    retired: list[str] = Field(default_factory=list, description="Removed ids; logged ops on them are skipped")
    stages: list[Stage]
    components: list[Component]
    edges: list[Edge]
    initial_instances: list["Instance"] = Field(default_factory=list)

    # Lookup maps, filled after validation.
    _stages: dict[str, Stage] = {}
    _components: dict[str, Component] = {}
    _edges: dict[str, Edge] = {}

    def model_post_init(self, __context: Any) -> None:
        self._stages = {s.id: s for s in self.stages}
        self._components = {c.id: c for c in self.components}
        self._edges = {e.id: e for e in self.edges}

    def resolve(self, target_id: str) -> str:
        """Follows renames so ops logged before a graph edit still land on the right target."""
        seen = set()
        while target_id in self.aliases and target_id not in seen:
            seen.add(target_id)
            target_id = self.aliases[target_id]
        return target_id

    def is_retired(self, target_id: str) -> bool:
        return target_id in self.retired

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

    def _target(self, target_id: str):
        return self._components[target_id] if self.is_component(target_id) else self._edges[target_id]

    def allowed_automation(self, target_id: str) -> list[int]:
        return self._target(target_id).allowed_automation

    def allowed_governance(self, target_id: str) -> list[int]:
        return self._target(target_id).allowed_governance

    def allowed_for(self, target_id: str, axis: Axis) -> list[int]:
        return self.allowed_automation(target_id) if axis == "automation" else self.allowed_governance(target_id)

    def options_for(self, target_id: str, axis: Axis) -> list[Option]:
        target = self._target(target_id)
        return target.automation_options if axis == "automation" else target.governance_options

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

    def prop_rank(self, kind: str, prop: str, value: str) -> int:
        return self.instance_kinds[kind].properties[prop].values.index(value)

    def with_default_props(self, inst: "Instance") -> "Instance":
        """Fills unset properties with the kind's initial values."""
        defaults = {name: p.initial for name, p in self.instance_kinds[inst.kind].properties.items()}
        return inst.model_copy(update={"props": {**defaults, **inst.props}})

    def instance_errors(self, inst: "Instance") -> list[str]:
        # Deliberately doesn't check inst.links resolve to real instances, unlike validate_graph's
        # check on authored initial_instances - deferred, see docs/plans/graph-redesign/
        # open-questions-for-decision.md #8. Dormant today: nothing creates a runtime instance yet.
        if inst.kind not in self.instance_kinds:
            return [f"instance '{inst.id}' has unknown kind '{inst.kind}'"]
        errors = []
        if inst.state not in self.instance_states:
            errors.append(f"instance '{inst.id}' has unknown state '{inst.state}'")
        if not self.is_component(inst.component_id):
            errors.append(f"instance '{inst.id}' sits on unknown component '{inst.component_id}'")
        props = self.instance_kinds[inst.kind].properties
        for name, value in inst.props.items():
            if name not in props:
                errors.append(f"instance '{inst.id}' has unknown property '{name}'")
            elif value not in props[name].values:
                errors.append(f"instance '{inst.id}' property '{name}' has unknown value '{value}'")
        return errors


class EffectiveView(BaseModel):
    """Automation is capped by upstream (00-plan.md decision 1); governance always equals its
    nominal value, kept as its own dict here so predicate/UI code can read "effective governance"
    uniformly even though it never actually differs from nominal."""

    automation: dict[str, int] = Field(default_factory=dict)
    governance: dict[str, int] = Field(default_factory=dict)
    capped_by: dict[str, str] = Field(
        default_factory=dict, description="Binding constraint per capped target: an edge id or an upstream component id"
    )

    def value(self, target_id: str, axis: Axis) -> int:
        source = self.automation if axis == "automation" else self.governance
        return source[target_id]

    def narrative(self, target_id: str) -> int:
        return narrative_tier(self.automation[target_id], self.governance[target_id])


class Instance(BaseModel):
    """A concrete named thing in the graph (dataset, model, endpoint...). Its properties are
    read by patterns and challenge preconditions, never directly by coverage."""

    id: str
    kind: str
    component_id: str
    name: str
    state: str
    props: dict[str, str] = Field(default_factory=dict)
    links: list[str] = Field(default_factory=list)


class GraphOp(BaseModel):
    kind: OpKind
    target: str
    value: Any = None
    attr: Optional[str] = Field(default=None, description="Attribute name for set_attr")
    axis: Optional[Axis] = Field(
        default=None, description="Required for raise_to/set_to: which axis it moves. Unused by other op kinds."
    )
    intended: Optional[int] = Field(
        default=None, description="Set when an unhappy owner degraded a raise: the level that was asked for"
    )
    degraded_by: Optional[str] = Field(
        default=None,
        description=(
            "Who caused the degradation, when it wasn't the target's owner - set by neglect "
            "sabotage (docs/plans/graph-governance-automation-rework/02-neglected-stakeholder-"
            "sabotage.md). None means the usual owner-buyin degradation, attributed to "
            "graph.owner_of(target) as before."
        ),
    )
    source_kind: SourceKind = "admin"
    source_id: Optional[str] = None
    reason: Optional[str] = None

    @model_validator(mode="after")
    def _normalise(self):
        # Content writes set_attr targets as "stage.component.attr"; normalise to target + attr.
        if self.kind == "set_attr" and self.attr is None and self.target.count(".") >= 2:
            self.target, self.attr = self.target.rsplit(".", 1)
        if self.kind == "set_instance_prop" and self.attr is None and "." in self.target:
            self.target, self.attr = self.target.rsplit(".", 1)
        if self.kind in ("raise_to", "set_to"):
            if self.axis is None:
                raise ValueError(f"{self.kind} op on '{self.target}' must name an axis")
            self.value = parse_axis_level(self.axis, self.value)
        return self


class LoggedOp(BaseModel):
    """An op as it sits in the log, with its global order."""

    seq: int
    op: GraphOp


class DebtEntry(BaseModel):
    target_id: str
    intended_level: int
    applied_level: int
    axis: Axis
    owner_id: Optional[str] = None
    source_id: Optional[str] = None


class GraphState(BaseModel):
    """Ground truth. Built by folding the op log, never persisted as such."""

    component_automation: dict[str, int] = Field(default_factory=dict)
    component_governance: dict[str, int] = Field(default_factory=dict)
    edge_automation: dict[str, int] = Field(default_factory=dict)
    edge_governance: dict[str, int] = Field(default_factory=dict)
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
            component_automation={c.id: c.initial_automation for c in graph.components},
            component_governance={c.id: c.initial_governance for c in graph.components},
            edge_automation={e.id: e.initial_automation for e in graph.edges},
            edge_governance={e.id: e.initial_governance for e in graph.edges},
            edge_triggers={e.id: e.initial_trigger for e in graph.edges},
            attrs={c.id: {name: a.initial for name, a in c.attributes.items()} for c in graph.components},
            instances={i.id: graph.with_default_props(i) for i in graph.initial_instances},
        )

    def automation(self, target_id: str) -> int:
        if target_id in self.component_automation:
            return self.component_automation[target_id]
        return self.edge_automation[target_id]

    def governance(self, target_id: str) -> int:
        if target_id in self.component_governance:
            return self.component_governance[target_id]
        return self.edge_governance[target_id]

    def value(self, target_id: str, axis: Axis) -> int:
        return self.automation(target_id) if axis == "automation" else self.governance(target_id)

    def axis_dict(self, target_id: str, axis: Axis) -> dict[str, int]:
        """The single stored dict a target's value for `axis` lives in, for mutating callers
        (`apply.py`)."""
        is_component = target_id in self.component_automation or target_id in self.component_governance
        if axis == "automation":
            return self.component_automation if is_component else self.edge_automation
        return self.component_governance if is_component else self.edge_governance

    def narrative(self, target_id: str) -> int:
        """Discrete 0-4 storytelling tier (`narrative_tier`) for authored flavor text only."""
        return narrative_tier(self.automation(target_id), self.governance(target_id))


class SeenEntry(BaseModel):
    """What the player saw of one target, and when."""

    seq: int
    nominal_automation: int
    nominal_governance: int
    effective_automation: int
    effective_governance: int
    trigger: Optional[str] = None
    attrs: dict[str, str] = Field(default_factory=dict)


class Knowledge(BaseModel):
    seen: dict[str, SeenEntry] = Field(default_factory=dict)

    def state_of(self, target_id: str, truth: GraphState) -> KnowledgeState:
        entry = self.seen.get(target_id)
        if entry is None:
            return "unknown"
        return "current" if entry.seq >= truth.changed_at.get(target_id, -1) else "stale"


TechnicalGraph.model_rebuild()
