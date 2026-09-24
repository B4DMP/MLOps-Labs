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
    level: int


class Concession(BaseModel):
    """What a Trade-off costs its stakeholder: a metric loss, or a target allowed to stay low."""
    metric_id: Optional[str] = None
    loss: Optional[int] = None
    target: Optional[str] = None
    accepts_max_level: Optional[int] = None


class FactAssertion(BaseModel):
    """What a Fact says about one target of the graph."""
    target: str
    level: Optional[int] = None
    trigger: Optional[str] = None

class ConfidenceType(str, Enum):
    UNCONFIRMED = "unconfirmed"
    # Gather's "Test a hypothesis" turn (D49, plan 11): the player's own tag held up under
    # questioning. Not a public confirmation like Verified, but tested - it counts toward pitch
    # readiness (Q36/D53) and is shown with its own stamp in the dossier.
    INFERRED = "inferred"
    # The same turn, but the player's tag was wrong: a trust hit, a free re-tag, the conversation
    # goes on. Never shows the true tag - Refuted only says the guess was wrong.
    REFUTED = "refuted"
    VERIFIED = "verified"


# Q36/D53: an Inferred note has been tested against the stakeholder, so it counts toward pitch
# readiness the same as a Verified one - only Unconfirmed and Refuted do not.
READINESS_CONFIDENCE = frozenset({ConfidenceType.VERIFIED, ConfidenceType.INFERRED})


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


def item_target_and_level(item: "StakeholderRequirement") -> tuple[Optional[str], Optional[int]]:
    """The graph target a payload is about, and the level it asks for, whichever field carries it.

    The single source of truth for this lookup: `session.py`, `objections.py`, `intel_handler.py`
    and `requirement_factory.py` each grew their own version of this with a different priority
    order and field coverage (a code-review finding, C/G passes). Checked in this order - asserts
    (Fact), suggested (Driver), concedes (Trade-off), ops (raw GraphOps, chiefly Boundary/Trade-off)
    - matching the order the D42 chain-matching gate already relied on. In practice an authored
    item carries exactly one of these per its `type` tag, so the order only matters for the rare
    item that carries more than one; `concedes` has no level of its own (`Concession` only tracks
    `loss`/`accepts_max_level`), so it returns `None` for level.
    """
    asserts = getattr(item, "asserts", None)
    if asserts is not None and getattr(asserts, "target", None):
        return asserts.target, getattr(asserts, "level", None)

    holds = getattr(item, "holds", None)
    if holds is not None:
        if isinstance(holds, dict) and holds.get("component"):
            return holds["component"], holds.get("level")
        elif hasattr(holds, "component") and getattr(holds, "component", None):
            return holds.component, getattr(holds, "level", None)

    suggested = getattr(item, "suggested", None)
    if suggested is not None and getattr(suggested, "target", None):
        return suggested.target, getattr(suggested, "level", None)

    concedes = getattr(item, "concedes", None)
    if concedes is not None and getattr(concedes, "target", None):
        return concedes.target, None

    for raw in getattr(item, "ops", None) or []:
        if isinstance(raw, dict) and raw.get("target"):
            from mlops_serious_game.domain.graph import GraphOp
            op = GraphOp.model_validate({**raw, "source_kind": "action_card"})
            return op.target, op.value if isinstance(op.value, int) else None

    return None, None


def gist_or_fallback(item: "StakeholderRequirement", stakeholder_name: str, metric_label: Optional[str]) -> str:
    """What a Generic Question turn tells the player (D52): the authored gist when there is one,
    a template from the metric name otherwise - the game runs before the content does."""
    if item.gist:
        return item.gist
    label = metric_label or "their part of the project"
    return f"{stakeholder_name} keeps bringing up {label}."


def item_target(item: "StakeholderRequirement") -> Optional[str]:
    """`item_target_and_level(item)[0]` - the target only, for callers that don't need the level."""
    target, _ = item_target_and_level(item)
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
    
    