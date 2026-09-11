from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ConflictPosition(BaseModel):
    stakeholder_id: str
    wants: int


class ChallengeConflict(BaseModel):
    """The two-sided disagreement that frames a challenge. `soft`: the losing side holds a
    Trade-off on the target. `hard`: it holds a Boundary."""

    type: Literal["soft", "hard"]
    target: str
    positions: list[ConflictPosition] = Field(min_length=2, max_length=2)


class Challenge(BaseModel):
    """A class representing a game Challenge"""

    id: int = Field(description="order of the challenge in the corresponding phase")
    phase_id: int = Field(description="index of the phase, that the challenge belongs to")
    name: str = Field(description="Title of the challenge")
    description: str = Field(description="Description of the challenge")
    roundIntroduction: str = Field(description="introduction text of the challenge")
    metric_changes: dict[str, int] = Field(description="changes in game metrics when the challenge is started")
    attention_tokens: int = Field(default=8, description="Number of attention tokens granted for this challenge")

    # Template fields: the graph state picks which challenge runs next (plan 03).
    template_id: str = Field(default="", description="Stable content key; defaults to ch_<id>")
    priority: int = Field(default=0, description="Higher wins among eligible templates")
    preconditions: Any = Field(default=True, description="Predicate over the graph that makes this challenge eligible")
    excluded_if: Any = Field(default=False, description="Predicate that rules this challenge out")
    fallback: bool = Field(default=False, description="Picked when nothing else in the phase is eligible")
    repeatable: bool = False
    on_enter_ops: list[dict] = Field(default_factory=list, description="World event ops fired when the challenge starts")
    stalemate_ops: list[dict] = Field(default_factory=list, description="World event ops fired when the pitch ends in stalemate")
    conflict: Optional["ChallengeConflict"] = None
    focus_stage_ids: list[str] = Field(default_factory=list)

    def model_post_init(self, __context: Any) -> None:
        if not self.template_id:
            self.template_id = f"ch_{self.id}"

    def __str__(self) -> str:
        return self.name


Challenge.model_rebuild()
