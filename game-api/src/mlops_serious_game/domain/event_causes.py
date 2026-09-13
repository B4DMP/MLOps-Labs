"""Loads `gameConfig/EventCauses.json`: cause code -> sentence template and group.

A reason has to be true every time (plan 11, D51): the LLM never writes log text, only these
templates do. `render` fills a code's template with a `GameEvent.params` dict; `magnitude_of`
buckets a raw number into the words-not-numbers scale the log is allowed to show; `missing_causes`
is the load-time check that every cause code actually used in code exists in this config.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

_RESERVED_KEYS = frozenset({"_magnitude_bands"})


class EventCauseFactory:
    _causes: Optional[dict[str, dict]] = None

    @classmethod
    def load(cls, path: Path) -> dict[str, dict]:
        with path.open("r", encoding="utf-8") as f:
            cls._causes = json.load(f)
        return cls._causes

    @classmethod
    def ensure_loaded(cls) -> None:
        if cls._causes is None:
            base_dir = Path(__file__).parent
            default_path = (base_dir / "../../../../gameConfig/EventCauses.json").resolve()
            cls._causes = cls.load(default_path) if default_path.exists() else {}

    @classmethod
    def reset(cls) -> None:
        """Test hook: forces the next `ensure_loaded` to re-read the file."""
        cls._causes = None

    @classmethod
    def all_codes(cls) -> set[str]:
        cls.ensure_loaded()
        return set(cls._causes or {}) - _RESERVED_KEYS

    @classmethod
    def get(cls, code: str) -> dict:
        cls.ensure_loaded()
        if code in _RESERVED_KEYS or code not in (cls._causes or {}):
            raise KeyError(f"unknown event cause code {code!r}; add it to gameConfig/EventCauses.json")
        return cls._causes[code]

    @classmethod
    def group(cls, code: str) -> str:
        return cls.get(code).get("group", "system")

    @classmethod
    def render(cls, code: str, params: Optional[dict] = None) -> str:
        template = cls.get(code)["text"]
        try:
            return template.format(**(params or {}))
        except (KeyError, IndexError) as exc:
            raise KeyError(f"cause {code!r} template needs param {exc}; got {params!r}") from exc

    @classmethod
    def magnitude_bands(cls) -> dict[str, float]:
        cls.ensure_loaded()
        return (cls._causes or {}).get("_magnitude_bands", {"clear": 0.15, "large": 0.3})

    @classmethod
    def magnitude_of(cls, amount: float) -> str:
        """Buckets a raw delta into slight / clear / large (plan 11: words, not numbers)."""
        bands = cls.magnitude_bands()
        a = abs(amount)
        if a >= bands.get("large", 0.3):
            return "large"
        if a >= bands.get("clear", 0.15):
            return "clear"
        return "slight"


_CAUSE_LITERAL = re.compile(r'cause\s*=\s*"([a-zA-Z0-9_.]+)"')


def causes_used_in(*paths: Path) -> set[str]:
    """Every `cause="..."` string literal found in the given source files.

    Not full static analysis - a `cause=f"..."` or a variable-held code would be missed - but
    every call site in this plan's paths passes a plain string literal on purpose: a cause is a
    fixed template, never assembled at runtime.
    """
    found: set[str] = set()
    for path in paths:
        if path.exists():
            found |= set(_CAUSE_LITERAL.findall(path.read_text(encoding="utf-8")))
    return found


def missing_causes(*paths: Path) -> set[str]:
    """Cause codes referenced in code but absent from `EventCauses.json` - the load-time check
    plan 11 step 1 asks for. Run from a test (`test_event_log.py`) over every module that builds
    `GameEvent`s, so a typo'd or newly added cause fails CI instead of shipping a broken log line."""
    return causes_used_in(*paths) - EventCauseFactory.all_codes()
