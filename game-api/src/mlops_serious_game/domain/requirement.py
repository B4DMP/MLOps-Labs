from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field, model_validator


class IntelTag(str, Enum):
    """What an intel item tells the player (plan 02).

    Driver, Boundary and Trade-off are stakeholder stances: an action on the graph plus how much
    the stakeholder cares about it. Fact is about the environment, not a person.
    """
    DRIVER = "driver"          # wanted, more is better
    BOUNDARY = "boundary"      # must happen, or must never be undone: crossing it means refusal
    TRADE_OFF = "trade_off"    # accepted, even though it costs them
    FACT = "fact"              # true about the system right now


STANCE_TAGS = frozenset({IntelTag.DRIVER, IntelTag.BOUNDARY, IntelTag.TRADE_OFF})


def join_wording(fact: Optional[str], reading: Optional[str]) -> str:
    return " ".join(part.strip() for part in (fact, reading) if part and part.strip())

# How stakeholder prompts describe each tag. One place, so every flow speaks the same language.
TAG_PROMPT_DESCRIPTION: dict[IntelTag, str] = {
    IntelTag.DRIVER: "Driver (something they want improved; more is better, and they can be talked into less)",
    IntelTag.BOUNDARY: "Boundary (a line they will not cross; violating it means they refuse)",
    IntelTag.TRADE_OFF: "Trade-off (something they would give up or accept losing to get what they want)",
    IntelTag.FACT: "Fact (how the system is right now, not anyone's wish)",
}

# The mistake a player most plausibly makes with each tag, used where a flow needs a wrong read.
PLAUSIBLE_WRONG_TAG: dict[IntelTag, IntelTag] = {
    IntelTag.DRIVER: IntelTag.BOUNDARY,
    IntelTag.BOUNDARY: IntelTag.DRIVER,
    IntelTag.TRADE_OFF: IntelTag.DRIVER,
    IntelTag.FACT: IntelTag.DRIVER,
}


def describe_tag(tag) -> str:
    """Prompt text for a tag given as IntelTag or string; unknown values read as Driver."""
    try:
        return TAG_PROMPT_DESCRIPTION[IntelTag(getattr(tag, "value", tag))]
    except ValueError:
        return TAG_PROMPT_DESCRIPTION[IntelTag.DRIVER]


# The short, player-facing name for a tag - what the event log shows for the player's own filed
# guess (safe to say: it is what they just chose, not a reveal of whether it holds up).
TAG_LABEL: dict[IntelTag, str] = {
    IntelTag.DRIVER: "a Driver",
    IntelTag.BOUNDARY: "a Boundary",
    IntelTag.TRADE_OFF: "a Trade-off",
    IntelTag.FACT: "a Fact",
}


def tag_label(tag) -> str:
    try:
        return TAG_LABEL[IntelTag(getattr(tag, "value", tag))]
    except ValueError:
        return TAG_LABEL[IntelTag.DRIVER]


def truncate_detail(text: Optional[str], limit: int = 140) -> str:
    """A log line's one chance to quote an item's own wording - trimmed so one long item can't
    blow out a row. Never a new leak: every caller passes text the player has already been shown
    (the reveal message, the tagging ack), just repeated here for the log's own story."""
    text = (text or "").strip()
    if not text:
        return "something new"
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


class TargetLevel(BaseModel):
    target: str
    axis: str  # "automation" | "governance" - required, see 00-plan.md §10.1
    level: int


class Concession(BaseModel):
    """What a Trade-off costs its stakeholder: a metric loss, or a target allowed to stay low."""
    metric_id: Optional[str] = None
    loss: Optional[int] = None
    target: Optional[str] = None
    axis: Optional[str] = None  # required alongside accepts_max_level
    accepts_max_level: Optional[int] = None


class FactAssertion(BaseModel):
    """What a Fact says about one target of the graph."""
    target: str
    axis: Optional[str] = None  # required alongside `level`; a level-less Fact (e.g. trigger-only) needs none
    level: Optional[int] = None
    trigger: Optional[str] = None

class ConfidenceType(str, Enum):
    UNCONFIRMED = "unconfirmed"
    VERIFIED = "verified"


READINESS_CONFIDENCE = frozenset({ConfidenceType.VERIFIED})


def counts_toward_readiness(intel_type) -> bool:
    """Whether an item's confidence counts toward the pitch readiness threshold (Q36/D53)."""
    value = str(getattr(intel_type, "value", intel_type)).lower()
    return value in {c.value for c in READINESS_CONFIDENCE}

class IntelSource(str, Enum):
    """How an intel item found its way into the player's dossier.

    The stamp says how sure the player can be; this says where it came from. Two items can
    both be verified and still have arrived by very different routes.
    """
    PUBLIC_RECORD = "public_record"
    OFFLINE_ARTIFACT = "offline_artifact"
    INTERVIEW = "interview"
    DEBATE = "debate"

class ArtifactType(str, Enum):
    EMAIL = "email"
    SLACK_MESSAGE="slack_message"
    MEETING_NOTES = "meeting_notes"
    DOCUMENT="document"
    # Technical artifacts carry Facts: they may be written by a stakeholder but state no stance.
    RUNBOOK = "runbook"
    DASHBOARD_SNAPSHOT = "dashboard_snapshot"
    INCIDENT_TICKET = "incident_ticket"
    CI_LOG = "ci_log"
    ARCHITECTURE_NOTE = "architecture_note"

class TradeOffBranch(BaseModel):
    """One branch option of a Trade-Off requirement with its own description and graph changes."""
    name: Optional[str] = None
    description: str = ""
    target: Optional[str] = None
    axis: Optional[str] = None  # required alongside `level`
    level: Optional[int] = None
    ops: list[dict] = Field(default_factory=list)
    atoms: list[str] = Field(default_factory=list)

class StakeholderRequirement(BaseModel):
    """One piece of intel in a challenge: a stakeholder stance or a fact about the environment.

    Payload fields are optional so legacy content without graph links stays loadable; the
    config gate checks that whatever payload is present fits the tag and the graph.
    """
    id: str = Field(description="Unique identifier for the requirement")
    challenge_id: int = Field(description="The ID of the challenge this requirement belongs to")
    stakeholder_id: Optional[str] = Field(default=None, description="The stakeholder, or None for a Fact")
    type: IntelTag = Field(description="The true tag of this intel item")
    description: str = Field(default="", description="The whole sentence: fact and reading joined, or legacy free text")
    # Split wording (intel-description-split): the fact holds still whatever the player tags it,
    # only the reading changes with the tag. Legacy content has neither and uses description.
    fact: Optional[str] = Field(default=None, description="What the stakeholder wants or did, never why")
    reading: Optional[str] = Field(default=None, description="How much they care: the part the tag is about")

    # Driver: a metric the stakeholder wants moved, and the change that would do it.
    metric_id: Optional[str] = None
    suggested: Optional[TargetLevel] = None
    # Boundary: must hold on the graph after the card. Boundary and Trade-off: the ops they bring.
    holds: Any = None
    ops: list[dict] = Field(default_factory=list)
    # Trade-off: what the stakeholder gives up.
    concedes: Optional[Concession] = None
    branch_x: Optional[TradeOffBranch] = None
    branch_y: Optional[TradeOffBranch] = None
    branch_x_atoms: list[str] = Field(default_factory=list)
    branch_y_atoms: list[str] = Field(default_factory=list)
    atoms: list[str] = Field(default_factory=list)
    # Fact: what is true about the graph.
    asserts: Optional[FactAssertion] = None
    # Refinement chains (plan 05) are authored: a later item on the same target and stakeholder
    # points back at the earlier one, and the dossier shows the whole chain as one growing card.
    refines_id: Optional[str] = Field(
        default=None,
        description="Id of the earlier item this one refines (same target and stakeholder, earlier phase)",
    )
    # Gists (D52, plan 11): what a Generic Question turn tells the player. Authored by the
    # `gists` content stage on stance items only; a Fact or an ungenerated item carries none.
    gist: Optional[str] = Field(
        default=None,
        description="8 to 25 words, third person, names the topic without saying how much they care",
    )

    @model_validator(mode="after")
    def _join_split_wording(self):
        if self.fact and not self.description:
            self.description = join_wording(self.fact, self.reading)
        return self


def item_target_and_level(item: "StakeholderRequirement") -> tuple[Optional[str], Optional[int], Optional[str]]:
    """The graph target a payload is about, the level it asks for, and which axis - whichever
    fields carry them.

    The single source of truth for this lookup: `session.py`, `objections.py`, `intel_handler.py`
    and `requirement_factory.py` each grew their own version of this with a different priority
    order and field coverage (a code-review finding, C/G passes). Checked in this order - asserts
    (Fact), suggested (Driver), concedes (Trade-off), ops (raw GraphOps, chiefly Boundary/Trade-off)
    - matching the order the D42 chain-matching gate already relied on. In practice an authored
    item carries exactly one of these per its `type` tag, so the order only matters for the rare
    item that carries more than one; `concedes` has no level of its own (`Concession` only tracks
    `loss`/`accepts_max_level`), so it returns `None` for level/axis.
    """
    asserts = getattr(item, "asserts", None)
    if asserts is not None and getattr(asserts, "target", None):
        return asserts.target, getattr(asserts, "level", None), getattr(asserts, "axis", None)

    holds = getattr(item, "holds", None)
    if holds is not None:
        if isinstance(holds, dict) and holds.get("component"):
            return holds["component"], holds.get("level"), holds.get("axis")
        elif hasattr(holds, "component") and getattr(holds, "component", None):
            return holds.component, getattr(holds, "level", None), getattr(holds, "axis", None)

    suggested = getattr(item, "suggested", None)
    if suggested is not None and getattr(suggested, "target", None):
        return suggested.target, getattr(suggested, "level", None), getattr(suggested, "axis", None)

    concedes = getattr(item, "concedes", None)
    if concedes is not None and getattr(concedes, "target", None):
        return concedes.target, None, None

    for raw in getattr(item, "ops", None) or []:
        if isinstance(raw, dict) and raw.get("target"):
            return raw["target"], raw.get("value") if isinstance(raw.get("value"), int) else None, raw.get("axis")

    return None, None, None


def foreclosed_compromises(reqs: list["StakeholderRequirement"], conflict: Optional[Any] = None) -> list[str]:
    """Every Driver in `reqs` that forces a (target, axis) level past a compromise ceiling
    authored elsewhere in the same challenge - a Trade-off's `concedes`/`branch_x`/`branch_y`, or a
    *soft* `ChallengeConflict`'s position (duck-typed: any object with `.type`, `.target` and
    `.positions`, each position carrying `.axis`/`.wants`) - silently ruling out the resolution
    that ceiling represents, no matter which stakeholder authored either item. A *hard* conflict's
    losing position is a Boundary, not a negotiable compromise (Challenge.py's own docstring: "hard:
    it holds a Boundary"), so it is excluded here - crossing it is already the boundary-violation
    mechanic's job, not this one's.

    The ceiling for a (target, axis) is the lowest level anything in the challenge treats as an
    acceptable resolution there; a Driver asking for more than that removes the option of settling
    for the cheaper resolution, even if the Driver's own stakeholder would still be technically
    "satisfied" by overshooting it. Returns one message per violation, empty when nothing forecloses
    anything.
    """
    ceilings: dict[tuple[str, str], int] = {}

    def _note(target: Optional[str], axis: Optional[str], level: Optional[int]) -> None:
        if target is None or axis is None or level is None:
            return
        key = (target, axis)
        if key not in ceilings or level < ceilings[key]:
            ceilings[key] = level

    for r in reqs:
        if r.type != IntelTag.TRADE_OFF:
            continue
        if r.concedes is not None and r.concedes.accepts_max_level is not None:
            _note(r.concedes.target, r.concedes.axis, r.concedes.accepts_max_level)
        for branch in (r.branch_x, r.branch_y):
            if branch is not None:
                _note(branch.target, branch.axis, branch.level)

    conflict_type = getattr(conflict, "type", None)
    if conflict is not None and getattr(conflict_type, "value", conflict_type) == "soft":
        for pos in getattr(conflict, "positions", None) or []:
            _note(getattr(conflict, "target", None), getattr(pos, "axis", None), getattr(pos, "wants", None))

    violations: list[str] = []
    for r in reqs:
        if r.type != IntelTag.DRIVER or r.suggested is None:
            continue
        # A composite Driver's extra ops ask for levels too.
        asks = [(r.suggested.target, r.suggested.axis, r.suggested.level)] + _raise_atoms(r.ops)
        for target, axis, level in asks:
            ceiling = ceilings.get((target, axis))
            if ceiling is not None and level is not None and level > ceiling:
                violations.append(
                    f"driver '{r.id}' asks for {target} {axis} level "
                    f"{level}, above the compromise ceiling {ceiling} authored on the same "
                    "target/axis elsewhere in the challenge - it forecloses that compromise"
                )
    return violations


_NEGATED_OP = {"gte": "lt", "gt": "lte", "lte": "gt", "lt": "gte", "eq": "ne", "ne": "eq"}


def _leaf_bounds(pred: Any, negated: bool = False) -> list[tuple[str, str, Optional[int], Optional[int]]]:
    """(target, axis, floor, ceiling) per level clause a predicate certainly requires.

    `any` is skipped (nothing certain), as is `ne` on a level."""
    if not isinstance(pred, dict):
        return []
    if "all" in pred:
        return [] if negated else [b for p in pred["all"] for b in _leaf_bounds(p)]
    if "any" in pred:
        return [b for p in pred["any"] for b in _leaf_bounds(p, True)] if negated else []
    if "not" in pred:
        return _leaf_bounds(pred["not"], not negated)
    target = pred.get("component") or pred.get("edge")
    axis = pred.get("axis")
    if not target or axis not in ("automation", "governance") or "level" not in pred:
        return []
    try:
        from mlops_serious_game.domain.graph import parse_axis_level

        level = parse_axis_level(axis, pred["level"])
    except Exception:
        return []
    op = pred.get("op", "gte")
    op = _NEGATED_OP.get(op, op) if negated else op
    if op == "gte":
        return [(target, axis, level, None)]
    if op == "gt":
        return [(target, axis, level + 1, None)]
    if op == "lte":
        return [(target, axis, None, level)]
    if op == "lt":
        return [(target, axis, None, level - 1)]
    if op == "eq":
        return [(target, axis, level, level)]
    return []


def _value_clauses(pred: Any, negated: bool = False) -> list[tuple[str, str, bool]]:
    """(key, value, must_equal) per attribute or trigger clause a predicate certainly requires."""
    if not isinstance(pred, dict):
        return []
    if "all" in pred:
        return [] if negated else [c for p in pred["all"] for c in _value_clauses(p)]
    if "any" in pred:
        return [c for p in pred["any"] for c in _value_clauses(p, True)] if negated else []
    if "not" in pred:
        return _value_clauses(pred["not"], not negated)
    if "attr" in pred and "value" in pred:
        key, op = pred["attr"], pred.get("op", "eq")
    elif "edge" in pred and "trigger" in pred and "value" in pred:
        key, op = f"{pred['edge']}.trigger", pred["trigger"]
    else:
        return []
    if op not in ("eq", "ne"):
        return []
    return [(key, str(pred["value"]), (op == "eq") != negated)]


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _raise_atoms(ops: Any) -> list[tuple[str, str, int]]:
    out = []
    for op in ops or []:
        if isinstance(op, dict) and op.get("kind") == "raise_to" and op.get("target") and op.get("axis") in ("automation", "governance"):
            level = _as_int(op.get("value"))
            if level is not None:
                out.append((op["target"], op["axis"], level))
    return out


def _set_values(item: "StakeholderRequirement") -> list[tuple[str, str]]:
    """(attribute or trigger key, value) every set_attr and set_trigger op of an item writes."""
    ops = list(item.ops or [])
    for branch in (item.branch_x, item.branch_y):
        ops += list(branch.ops) if branch is not None else []
    out = []
    for op in ops:
        if not isinstance(op, dict) or op.get("value") is None:
            continue
        if op.get("kind") == "set_attr" and op.get("attr"):
            out.append((f"{op['target']}.{op['attr']}", str(op["value"])))
        elif op.get("kind") == "set_trigger":
            out.append((f"{op['target']}.trigger", str(op["value"])))
    return out


def _stance_floors_and_ceilings(item: "StakeholderRequirement"):
    """What one stance item needs reached (floors) and what it treats as an acceptable stopping
    point (ceilings), both as (target, axis, level).

    A Trade-off's branches are alternatives, so its floor on a (target, axis) is its lowest branch
    level, and only where every branch raises it; every branch level is also a ceiling for the stakeholder's other items, because a
    branch is only a real option while nothing else of theirs demands more than it delivers."""
    floors: list[tuple[str, str, int]] = []
    ceilings: list[tuple[str, str, int]] = []
    if item.type == IntelTag.DRIVER:
        if item.suggested is not None and item.suggested.axis and item.suggested.level is not None:
            floors.append((item.suggested.target, item.suggested.axis, item.suggested.level))
        floors += _raise_atoms(item.ops)
    elif item.type == IntelTag.BOUNDARY:
        for target, axis, lo, hi in _leaf_bounds(item.holds):
            if lo is not None:
                floors.append((target, axis, lo))
            if hi is not None:
                ceilings.append((target, axis, hi))
        floors += _raise_atoms(item.ops)
    elif item.type == IntelTag.TRADE_OFF:
        floors += _raise_atoms(item.ops)
        if item.concedes is not None and item.concedes.accepts_max_level is not None and item.concedes.axis:
            ceilings.append((item.concedes.target, item.concedes.axis, item.concedes.accepts_max_level))
        branches = [b for b in (item.branch_x, item.branch_y) if b is not None]
        per_key: dict[tuple[str, str], list[int]] = {}
        for branch in branches:
            atoms = _raise_atoms(branch.ops)
            if branch.target and branch.axis and branch.level is not None:
                atoms.append((branch.target, branch.axis, branch.level))
            for target, axis, level in atoms:
                per_key.setdefault((target, axis), []).append(level)
                ceilings.append((target, axis, level))
        # Only a target every branch raises is something the Trade-off cannot avoid asking for.
        floors += [(t, a, min(levels)) for (t, a), levels in per_key.items() if len(levels) == len(branches)]
    return floors, ceilings


def self_contradictions(reqs: list["StakeholderRequirement"]) -> list[str]:
    """Places where one stakeholder's own intel items undo each other, one message per pair.

    A stakeholder's Boundaries and Trade-off branches must stay reachable whatever else that
    stakeholder asks for. Within one stakeholder (and one challenge) it flags:
    - a floor above another item's ceiling on the same (target, axis): a Driver or Boundary that
      demands more than a Trade-off concession or branch, or another Boundary's upper limit, allows
    - two items that write different values to one attribute or trigger, or an item that writes a
      value the stakeholder's own Boundary rules out
    Items of one stakeholder are never compared with themselves, so a Trade-off's own concession
    and branches may sit at different levels."""
    by_stakeholder: dict[str, list["StakeholderRequirement"]] = {}
    for r in reqs:
        if r.type != IntelTag.FACT and r.stakeholder_id:
            by_stakeholder.setdefault(r.stakeholder_id, []).append(r)

    messages: list[str] = []
    for sid, items in by_stakeholder.items():
        shapes = {r.id: _stance_floors_and_ceilings(r) for r in items}
        for a in items:
            for b in items:
                if a.id == b.id:
                    continue
                for target, axis, floor in shapes[a.id][0]:
                    for c_target, c_axis, ceiling in shapes[b.id][1]:
                        if (target, axis) == (c_target, c_axis) and floor > ceiling:
                            messages.append(
                                f"{sid}: '{a.id}' needs {target} {axis} at level {floor}, above the level {ceiling} "
                                f"that '{b.id}' allows for it, so '{b.id}' can never be honoured"
                            )
        writes: dict[str, list[tuple[str, str]]] = {}
        for r in items:
            for key, value in _set_values(r):
                writes.setdefault(key, []).append((r.id, value))
        for key, entries in writes.items():
            values = {v for _, v in entries}
            if len({rid for rid, _ in entries}) > 1 and len(values) > 1:
                messages.append(f"{sid}: {sorted({rid for rid, _ in entries})} write different values to {key}")
        for r in items:
            if r.type != IntelTag.BOUNDARY:
                continue
            for key, value, must_equal in _value_clauses(r.holds):
                for rid, written in writes.get(key, []):
                    if rid != r.id and (written == value) != must_equal:
                        messages.append(f"{sid}: '{rid}' sets {key} to {written}, which '{r.id}' rules out")
    return sorted(set(messages))


def gist_or_fallback(item: "StakeholderRequirement", stakeholder_name: str, metric_label: Optional[str]) -> str:
    """What a Generic Question turn tells the player (D52): the authored gist when there is one,
    a template from the metric name otherwise - the game runs before the content does."""
    if item.gist:
        return item.gist
    label = metric_label or "their part of the project"
    return f"{stakeholder_name} keeps bringing up {label}."


def item_target(item: "StakeholderRequirement") -> Optional[str]:
    """`item_target_and_level(item)[0]` - the target only, for callers that don't need the level."""
    target, _, _ = item_target_and_level(item)
    return target


class StakeholderIntelItem(StakeholderRequirement):
    """A class representing a categorized stakeholder requirement (player's dossier intel item)"""
    intel_type: ConfidenceType = Field(default=ConfidenceType.UNCONFIRMED, description="The type of the intel")
    categorized_type: IntelTag = Field(default=IntelTag.DRIVER, description="The tag the player gave this item")
    categorized_description: str = Field(default="", description="Description of the categorized requirement")
    source: IntelSource = Field(
        default=IntelSource.OFFLINE_ARTIFACT,
        description=(
            "Where the item came from: already on the public record at the start of the "
            "challenge, the player's read of an offline artifact, an interview during online "
            "intel gathering, or something that came out during the pitch."
        ),
    )
    # Plan 05: persistent dossier fields. `refines_id` is inherited: an item keeps the chain link
    # the authored requirement carried.
    discovered_phase_id: Optional[int] = Field(
        default=None,
        description="Phase index when this item entered the player's dossier.",
    )
    discovered_challenge_template: Optional[str] = Field(
        default=None,
        description="Template id of the challenge that produced this item.",
    )
    dossier_source: Optional[str] = Field(
        default=None,
        description="How the item reached the dossier: 'artifact' | 'engagement_card' | 'objection'.",
    )

    @classmethod
    def from_requirement(
        cls,
        req: StakeholderRequirement,
        intel_type: ConfidenceType = ConfidenceType.UNCONFIRMED,
        categorized_type: Optional[IntelTag] = None,
        categorized_description: str = "",
        description: Optional[str] = None,
        source: IntelSource = IntelSource.OFFLINE_ARTIFACT,
    ) -> "StakeholderIntelItem":
        resolved_desc = description if description is not None else req.description
        resolved_cat_desc = categorized_description
        if not resolved_cat_desc and (intel_type == ConfidenceType.VERIFIED or str(intel_type).lower() == "verified"):
            resolved_cat_desc = resolved_desc
        return cls(
            **req.model_dump(exclude={"description"}),
            description=resolved_desc,
            intel_type=intel_type,
            categorized_type=categorized_type or req.type,
            categorized_description=resolved_cat_desc,
            source=source,
        )

    @property
    def correct_description(self) -> str:
        return self.description

    @property
    def correct_intent(self) -> IntelTag:
        return self.type

    def is_correct(self) -> bool:
        return self.categorized_type == self.type

    def shown_parts(self) -> tuple[Optional[str], str]:
        """(fact, reading) as the player currently sees them. The fact is None for legacy items,
        whose whole sentence then comes back as the reading."""
        verified = str(getattr(self.intel_type, "value", self.intel_type)).lower() == "verified"
        shown = self.description if verified else (self.categorized_description or self.description)
        if self.fact and shown.startswith(self.fact):
            return self.fact, shown[len(self.fact):].strip()
        return None, shown

    def is_correct_intel(self) -> bool:
        return self.is_correct()
    
class StakeholderIntelItemArtifact(BaseModel):
    """A class representing a MLOps artifact associated with a stakeholder intel_item"""
    id: str = Field(description="Unique identifier of the artifact")
    intel_item_id: str = Field(description="id of the associated intel_item")
    type: ArtifactType = Field(description="Type of the artifact")
    content: str = Field(description="Content of the artifact")
    
    