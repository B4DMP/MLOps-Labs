"""Endgame epilogue config: what became of Lindenmarkt, keyed on the grade (D5/D12).

Deterministic lookup, in the same shape as `story_factory`: authored prose, no LLM, so a
screenshot of the results screen says the same thing every time and the text can be reviewed like
the rest of the content.

Two parts, doing different jobs:

- `verdict` is the chain's outcome per grade band, told in the four business terms the briefing
  already promised the player they would be judged on (availability, waste, residual stock,
  override rate). It says *what became of the company*.
- `beats` are conditional fragments keyed off the computed results. They say *which of the
  player's choices got it there*. The top few by priority are shown.

The failure register is deliberately mundane: missed order windows, climbing override rates,
pallets of unsold promotion stock. No disaster. A serious game about a forecasting platform loses
its credibility the moment the supermarket burns down.
"""

import json
from pathlib import Path
from typing import Any, Optional


class EpilogueConfigError(ValueError):
    pass


# Every comparison a beat's `when` clause can make, as {suffix: test(threshold, value)}.
# Keeping them declarative means a new beat is a config change, never a code change.
_PREDICATES = {
    "_at_least": lambda threshold, value: value is not None and value >= threshold,
    "_at_most": lambda threshold, value: value is not None and value <= threshold,
    "_below": lambda threshold, value: value is not None and value < threshold,
}


class EpilogueFactory:
    verdicts: dict[str, dict[str, Any]] = {}
    beats: list[dict[str, Any]] = []

    @classmethod
    def load(cls, path: Path) -> None:
        with path.open("r", encoding="utf-8") as f:
            cls.load_dict(json.load(f))

    @classmethod
    def load_dict(cls, data: dict) -> None:
        verdicts = data.get("verdict", {})
        if not verdicts:
            raise EpilogueConfigError("epilogue config has no verdict bands")
        for band, entry in verdicts.items():
            if "closing" not in entry:
                raise EpilogueConfigError(f"verdict band '{band}' has no closing line")
            if "scoreboard" not in entry:
                raise EpilogueConfigError(f"verdict band '{band}' has no scoreboard")

        beats = sorted(data.get("beats", []), key=lambda b: -b.get("priority", 0))
        if not any(b.get("when") == {} for b in beats):
            raise EpilogueConfigError("epilogue config has no unconditional fallback beat")

        cls.verdicts = verdicts
        cls.beats = beats

    @classmethod
    def verdict_for(cls, grade: str, *, spiral: bool = False) -> dict[str, Any]:
        """The closing passage and scoreboard for a grade.

        A spiral run gets the alternate phrasing: the player is about to be offered another cycle
        on the same system, so the verdict must not claim the project ended.
        """
        entry = cls.verdicts.get(grade)
        if entry is None:
            # An unknown band is a config problem, not a reason to show the player nothing.
            entry = cls.verdicts.get("C") or next(iter(cls.verdicts.values()))
        closing = entry.get("spiral_closing") if spiral else entry.get("closing")
        return {
            "closing": closing or entry.get("closing", ""),
            "scoreboard": entry.get("scoreboard", {}),
        }

    @classmethod
    def _matches(cls, when: dict[str, Any], facts: dict[str, Any]) -> bool:
        """Whether every condition in a beat's `when` holds.

        A condition names a fact plus a comparison suffix, e.g. `intel_accuracy_below: 0.4`. A
        fact the caller did not supply fails the condition rather than passing it: a beat should
        never fire on something the run has no reading for.
        """
        for key, threshold in when.items():
            for suffix, test in _PREDICATES.items():
                if key.endswith(suffix):
                    if not test(threshold, facts.get(key[: -len(suffix)])):
                        return False
                    break
            else:
                # A bare key is a truthiness check, e.g. `broken_stage: true`.
                if bool(facts.get(key)) != bool(threshold):
                    return False
        return True

    @classmethod
    def beats_for(cls, facts: dict[str, Any], limit: int = 3) -> list[dict[str, Any]]:
        """The highest-priority beats whose conditions the run meets.

        The unconditional fallback is only used when nothing else matched, so a quiet run still
        gets a closing line rather than an empty panel.
        """
        matched = [b for b in cls.beats if b.get("when") and cls._matches(b["when"], facts)]
        if not matched:
            fallback = next((b for b in cls.beats if b.get("when") == {}), None)
            return [fallback] if fallback else []
        return matched[:limit]


def epilogue_for(
    grade: str,
    facts: dict[str, Any],
    *,
    spiral: bool = False,
    limit: int = 3,
) -> dict[str, Any]:
    """The whole epilogue for one run: the verdict, its scoreboard, and the beats behind it."""
    verdict = EpilogueFactory.verdict_for(grade, spiral=spiral)
    return {
        "closing": verdict["closing"],
        "scoreboard": verdict["scoreboard"],
        "beats": [
            {"id": b.get("id"), "text": b.get("text", "")}
            for b in EpilogueFactory.beats_for(facts, limit)
        ],
    }
