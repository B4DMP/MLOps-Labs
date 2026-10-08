"""How well a playtest tool plays (docs/plans/shorter-playthrough-and-grade-spread.md).

The tools used to play one way: every note found and tagged right, a card the room passes. That can
only ever show the top of the grade scale, so a profile says how far from that to drift.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

Prefer = Literal["flawless", "best", "pass", "soft", "veto"]


@dataclass(frozen=True)
class PlayProfile:
    name: str
    #: Share of a challenge's notes that end up in the dossier at all.
    intel_coverage: float = 1.0
    #: Share of the notes found that are tagged correctly (and so verified).
    intel_accuracy: float = 1.0
    #: What the card search aims for. "flawless" maximises the final grade, "best" the room's
    #: acceptance, "veto" is pushed through with an Escalation Point.
    prefer: Prefer = "best"

    @property
    def is_perfect(self) -> bool:
        return self.intel_coverage >= 1.0 and self.intel_accuracy >= 1.0


FLAWLESS = PlayProfile("flawless", prefer="flawless")
PERFECT = PlayProfile("perfect", prefer="best")
MEDIUM = PlayProfile("medium", intel_coverage=0.8, intel_accuracy=0.75, prefer="soft")
BAD = PlayProfile("bad", intel_coverage=0.5, intel_accuracy=0.45, prefer="veto")

PROFILES = {p.name: p for p in (FLAWLESS, PERFECT, MEDIUM, BAD)}


def profile_named(name: Optional[str]) -> PlayProfile:
    """An unknown or missing name plays perfectly, which is what the tools always did."""
    return PROFILES.get(name or "", PERFECT)
