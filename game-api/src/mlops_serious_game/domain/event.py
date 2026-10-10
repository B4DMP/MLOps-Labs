"""The event log domain model (plan 11, D51): one record for everything that happens in a game,
with a cause the player can read.

Pure data. Building one costs nothing: callers construct `GameEvent`s inline and return them next
to whatever they were already computing (`_bump` and friends in `pitch_debate_service.session`,
the pipeline, the gate...). `seq` is assigned once, by `event_log_service.store.append_events` on
persist - most call sites never see the real per-user sequence, so it defaults to 0.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Step = Literal["offline", "gather", "build", "object", "commit", "simulation", "gate"]
EventKind = Literal[
    "emotion", "patience", "intel", "archetype", "tokens", "escalation",
    "card", "objection", "outcome", "grudge", "graph", "metric", "thread",
]
Direction = Literal["up", "down", "none"]
Magnitude = Literal["slight", "clear", "large"]


class GameEvent(BaseModel):
    """One thing that happened, with a true, readable cause.

    `params` carries names for the cause template (stakeholder names, item wording), never
    numbers - the log must never show more than the risk read does (D51). `refs` points at other
    records (`objection_id`, `item_id`, `graph_op_seq`, `turn_id`) instead of copying them, so a
    graph event never leaks the op it names, only where to look it up.
    """

    seq: int = 0
    phase_id: int = 0
    challenge_id: int = 0
    step: Step
    kind: EventKind
    subject_id: Optional[str] = None
    direction: Direction = "none"
    magnitude: Optional[Magnitude] = None
    cause: str
    params: dict = Field(default_factory=dict)
    refs: dict = Field(default_factory=dict)

    def stamped(self, *, phase_id: int, challenge_id: int) -> "GameEvent":
        """Fills in the envelope a pure function cannot know: which phase/challenge this
        happened in. `seq` is still left for the store to assign on persist."""
        return self.model_copy(update={"phase_id": phase_id, "challenge_id": challenge_id})
