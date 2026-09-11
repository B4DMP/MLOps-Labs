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
    VERIFIED = "verified"

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
    # Fact: what is true about the graph.
    asserts: Optional[FactAssertion] = None

    @model_validator(mode="after")
    def _join_split_wording(self):
        if self.fact and not self.description:
            self.description = join_wording(self.fact, self.reading)
        return self

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
    # Plan 05: persistent dossier fields.
    refines_id: Optional[str] = Field(
        default=None,
        description="Id of the earlier StakeholderIntelItem this one refines (same target + stakeholder, later phase).",
    )
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
    
    