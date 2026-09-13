"""Build the authored-text index consumed by fire_objections() (plan 06).

The index is keyed by (stakeholder_id, kind, target) → text.
`target` is the component/edge id from the intel item's graph payload, or None
when we cannot resolve it (fire_objections falls back to the None key then to
item.description).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional


def _objections_path() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "gameConfig" / "MlopsObjections.json"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("MlopsObjections.json not found")


def _target_from_req(req) -> Optional[str]:
    """Best-effort graph target from a StakeholderRequirement."""
    if req is None:
        return None
    suggested = getattr(req, "suggested", None)
    if suggested and getattr(suggested, "target", None):
        return suggested.target
    asserts = getattr(req, "asserts", None)
    if asserts and getattr(asserts, "target", None):
        return asserts.target
    concedes = getattr(req, "concedes", None)
    if concedes and getattr(concedes, "target", None):
        return concedes.target
    return None


@lru_cache(maxsize=1)
def load_authored_index() -> dict:
    """Return authored objection text keyed (stakeholder_id, kind, target_or_None) → text.

    A second key (stakeholder_id, kind, None) is always set so fire_objections()
    can fall back to a kind-level default when the specific target misses.
    Technical entries use component_id as the target.
    """
    from mlops_serious_game.domain.requirement_factory import RequirementFactory

    raw = json.loads(_objections_path().read_text(encoding="utf-8"))
    index: dict = {}

    for entry in raw.get("stance", []):
        st_id = entry.get("stakeholder_id", "")
        kind = entry.get("kind", "stance")
        intel_id = entry.get("intel_id", "")
        text = entry.get("text", "")

        req = RequirementFactory.get_requirement(intel_id)
        target = _target_from_req(req)

        # specific key (with target)
        if target:
            index[(st_id, kind, target)] = text
        # fallback key (no target) — first entry wins so order matters less
        index.setdefault((st_id, kind, None), text)

    for entry in raw.get("technical", []):
        st_id = entry.get("stakeholder_id", "")
        component_id = entry.get("component_id", "")
        text = entry.get("text", "")
        index[(st_id, "technical", component_id)] = text
        index.setdefault((st_id, "technical", None), text)

    return index
