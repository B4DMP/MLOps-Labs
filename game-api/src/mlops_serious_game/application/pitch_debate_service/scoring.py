"""Pure scoring functions for the streamlined pitch phase.

All functions take explicit data; no factory calls here. Callers resolve
stakeholders and emotion values before calling. Convincer archetypes are removed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from mlops_serious_game.domain.emotion import (
    calculate_demand_alignment,
    calculate_dynamic_weights,
    calculate_pitch_deltas,
    calculate_reactivity,
)

if TYPE_CHECKING:
    from mlops_serious_game.domain.requirement import StakeholderIntelItem

# Default thresholds
VETO_THRESHOLD: float = 0.4
OBJECTION_THRESHOLD: float = 0.3


# ---------------------------------------------------------------------------
# Continuous Demand Alignment
# ---------------------------------------------------------------------------

def demand_alignment(
    stakeholder_reqs: list[Any],
    card_slotted_req_ids: set[str],
    trade_off_fulfilled_branches: dict[str, bool] | None = None,
    card_atoms: set[str] | None = None,
) -> float:
    """Continuous demand alignment ratio in [-1.0, 1.0] across Drivers and Trade-offs."""
    return calculate_demand_alignment(
        stakeholder_reqs=stakeholder_reqs,
        card_slotted_req_ids=card_slotted_req_ids,
        trade_off_fulfilled_branches=trade_off_fulfilled_branches,
        card_atoms=card_atoms,
    )


# ---------------------------------------------------------------------------
# Emotion Normalisation and Dimensional Shifting
# ---------------------------------------------------------------------------

def emotions_norm(emotion_values: dict[str, float]) -> float:
    """Mean of all emotion dimensions for one stakeholder, in [0, 1]."""
    if not emotion_values:
        return 0.5
    vals = [v for v in emotion_values.values() if isinstance(v, (int, float))]
    return sum(vals) / len(vals) if vals else 0.5


def shift_emotions(
    emotion_values: dict[str, dict[str, float]],
    deltas: dict[str, dict[str, float] | float],
) -> dict[str, dict[str, float]]:
    """Applies dimensional emotion deltas per stakeholder.
    
    Supports both full dimensional delta dicts {st_id: {dim: delta}} and flat deltas.
    """
    if not deltas:
        return emotion_values

    shifted: dict[str, dict[str, float]] = {}
    for st_id, ev in emotion_values.items():
        st_delta = deltas.get(st_id)
        if st_delta is None:
            shifted[st_id] = dict(ev)
        elif isinstance(st_delta, dict):
            shifted[st_id] = {
                dim: max(0.0, min(1.0, round(val + st_delta.get(dim, 0.0), 4)))
                if isinstance(val, (int, float))
                else val
                for dim, val in ev.items()
            }
        else:
            flat_val = float(st_delta)
            shifted[st_id] = {
                dim: max(0.0, min(1.0, round(val + flat_val, 4)))
                if isinstance(val, (int, float))
                else val
                for dim, val in ev.items()
            }
    return shifted


# ---------------------------------------------------------------------------
# Buy-in & Outcome
# ---------------------------------------------------------------------------

def buy_in(
    alignment_val: float,
    emotions_val: float,
    boundary_violated: bool = False,
) -> float:
    """Per-stakeholder buy-in score in [0.0, 1.0].
    
    Maps alignment_val [-1.0, 1.0] -> [0.0, 1.0] and combines with emotions_norm.
    Boundaries are treated as requirements directly within demand alignment.
    """
    norm_align = max(0.0, min(1.0, 0.5 * (alignment_val + 1.0)))
    raw = 0.6 * norm_align + 0.4 * emotions_val
    return max(0.0, min(1.0, round(raw, 3)))


def outcome(
    room: list[tuple[str, str, float, bool]],
    veto_threshold: float = VETO_THRESHOLD,
    objection_threshold: float = OBJECTION_THRESHOLD,
) -> str:
    """Derive 'VETO', 'SOFT_PASS', or 'PASS' from the room's buy-in scores.

    room is a list of (stakeholder_id, power, buy_in, boundary_violated).
    High-power veto trumps all; soft-pass from any low-power stakeholder
    gives SOFT_PASS when no veto is raised.
    """
    for _st_id, power, bi, bv in room:
        if power == "high" and (bv or bi < veto_threshold):
            return "VETO"
    for _st_id, power, bi, bv in room:
        if power == "low" and (bv or bi < objection_threshold):
            return "SOFT_PASS"
    return "PASS"
