"""Grudges: friction a stakeholder schedules for later (plan 07).

A Soft Pass, a broken veto or a stalemate leaves someone unhappy without stopping the card. The
unhappiness has to surface somewhere, otherwise Soft Pass silently becomes Pass. A grudge is the
persisted note that says it will. It is data only: the pipeline picks its effect deterministically
from the owner and the age, so replaying a game reproduces the same friction.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

GrudgeEffect = Literal["degrade", "world_event", "extra_objection"]

# The order is part of the deterministic pick, do not reorder without invalidating saved games.
GRUDGE_EFFECTS: tuple[GrudgeEffect, ...] = ("degrade", "world_event", "extra_objection")

# How many simulations a grudge keeps firing before it is spent.
GRUDGE_LIFETIME = 2


class Grudge(BaseModel):
    stakeholder_id: str
    weight: int = Field(default=1, ge=1, description="2 when the stakeholder was overridden by a Veto Breaker")
    age: int = Field(default=0, description="How many simulations it has already fired in")
    reason: str = ""
    created_in: Optional[str] = Field(default=None, description="Template id of the challenge that created it")


class FiredGrudge(BaseModel):
    """One grudge doing something, as the delta report shows it."""

    stakeholder_id: str
    effect: GrudgeEffect
    weight: int
    age: int
    target: Optional[str] = None
    detail: str = ""


class PendingObjection(BaseModel):
    """An extra objection a grudge bought for the next pitch, at reduced patience."""

    stakeholder_id: str
    patience_malus: int = 1
