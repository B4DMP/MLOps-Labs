"""What the case board remembers for one player and challenge (docs/plans/case-board.md, D4/D7)."""

from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel, Field


class BoardState(BaseModel):
    found: list[str] = Field(default_factory=list)  # relation ids the player has connected
    hints: list[list[str]] = Field(default_factory=list)  # stakeholder pairs, kind never stored
    attempts_left: int
    penciled: list[str] = Field(default_factory=list)  # note ids the player ticked as covered by their pitch


@dataclass(frozen=True)
class BoardKey:
    user_id: int
    run_index: int
    phase_index: int
    challenge_index: int


class BoardStore(Protocol):
    def load(self, key: BoardKey) -> BoardState | None: ...

    def save(self, key: BoardKey, state: BoardState) -> None: ...
