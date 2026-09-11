"""Pure scoring functions for the COMMIT stage of the pitch phase (plan 06).

All functions take explicit data; no factory calls here. Callers resolve
stakeholders, archetypes and emotion values before calling.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from mlops_serious_game.domain.convincerArchetype import ConvincerArchetype
    from mlops_serious_game.domain.requirement import StakeholderIntelItem

# Default constants (Q22 — revisit after playtest).
SECONDARY_MALUS: float = 0.15
VETO_THRESHOLD: float = 0.4
OBJECTION_THRESHOLD: float = 0.3
LOSS_W: float = 0.3


# ---------------------------------------------------------------------------
# Convincer fit
# ---------------------------------------------------------------------------

def _archetype_distance(
    arch: "ConvincerArchetype",
    st_arch: "ConvincerArchetype",
) -> float:
    """Mean normalised axis distance in [0, 1]. Each axis is 0–5."""
    diffs = (
        abs(arch.evidence_basis - st_arch.evidence_basis),
        abs(arch.risk_and_control - st_arch.risk_and_control),
        abs(arch.value_horizon - st_arch.value_horizon),
    )
    return sum(diffs) / (len(diffs) * 5)


def fit(
    st_arch: "ConvincerArchetype",
    main_arch: Optional["ConvincerArchetype"],
    secondary_arch: Optional["ConvincerArchetype"] = None,
    secondary_malus: float = SECONDARY_MALUS,
) -> float:
    """Convincer fit for one stakeholder against the card's framing.

    Returns 0.5 when no archetype has been chosen (neutral baseline).
    """
    if main_arch is None:
        return 0.5
    d_main = _archetype_distance(main_arch, st_arch)
    if secondary_arch is not None:
        d_secondary = _archetype_distance(secondary_arch, st_arch) + secondary_malus
        d = min(d_main, d_secondary)
    else:
        d = d_main
    return max(0.0, min(1.0, 1.0 - d))


# ---------------------------------------------------------------------------
# Driver coverage
# ---------------------------------------------------------------------------

def _credit(
    driver_id: str,
    driver_metric_id: Optional[str],
    card_item_ids: set[str],
    card_metric_ids: set[Optional[str]],
) -> float:
    """Credit for one Driver: 1.0 slotted, 0.5 same metric via another item, 0.0 missing."""
    if driver_id in card_item_ids:
        return 1.0
    if driver_metric_id and driver_metric_id in card_metric_ids:
        return 0.5
    return 0.0


def coverage(
    st_id: str,
    all_intel: list["StakeholderIntelItem"],
    card_item_ids: set[str],
) -> float:
    """Mean Driver coverage for one stakeholder scored against ground truth.

    all_intel is the full ground-truth list for the challenge.
    card_item_ids are the ids of items actually slotted in the card.

    Returns 1.0 when the stakeholder has no Drivers (nothing to fail).
    """
    from mlops_serious_game.domain.requirement import IntelTag

    card_metric_ids: set[Optional[str]] = {
        getattr(item, "metric_id", None)
        for item in all_intel
        if item.id in card_item_ids
    }
    drivers = [
        item for item in all_intel
        if getattr(item, "stakeholder_id", None) == st_id
        and getattr(item, "type", None) == IntelTag.DRIVER
    ]
    if not drivers:
        return 1.0
    credits = [
        _credit(d.id, getattr(d, "metric_id", None), card_item_ids, card_metric_ids)
        for d in drivers
    ]
    return sum(credits) / len(credits)


# ---------------------------------------------------------------------------
# Emotion normalisation
# ---------------------------------------------------------------------------

def emotions_norm(emotion_values: dict[str, float]) -> float:
    """Mean of all emotion dimensions for one stakeholder, in [0, 1].

    Each dimension is already in [0, 1] (enforced by emotion_node).
    """
    if not emotion_values:
        return 0.5
    vals = [v for v in emotion_values.values() if isinstance(v, (int, float))]
    return sum(vals) / len(vals) if vals else 0.5


# ---------------------------------------------------------------------------
# Uncompensated loss
# ---------------------------------------------------------------------------

def loss(
    st_id: str,
    all_intel: list["StakeholderIntelItem"],
    card_item_ids: set[str],
) -> float:
    """Normalised uncompensated loss for one stakeholder, in [0, 1].

    Sums the integer concedes.loss values of Trade-off items belonging to st
    that are NOT slotted in the card, then divides by 5 (max graph level).
    """
    from mlops_serious_game.domain.requirement import IntelTag

    total = 0
    for item in all_intel:
        if (
            getattr(item, "stakeholder_id", None) == st_id
            and getattr(item, "type", None) == IntelTag.TRADE_OFF
            and item.id not in card_item_ids
        ):
            concedes = getattr(item, "concedes", None)
            if concedes and getattr(concedes, "loss", None):
                total += concedes.loss
    return min(1.0, total / 5)


# ---------------------------------------------------------------------------
# Buy-in
# ---------------------------------------------------------------------------

def buy_in(
    coverage_val: float,
    emotions_val: float,
    fit_val: float,
    loss_val: float,
    loss_w: float = LOSS_W,
) -> float:
    """Per-stakeholder buy-in score, clamped to [0, 1].

    Formula (plan 06):
        clamp(0.7*coverage + 0.3*emotions_norm + 0.1*(fit - 0.5) - LOSS_W*loss)
    """
    raw = (
        0.7 * coverage_val
        + 0.3 * emotions_val
        + 0.1 * (fit_val - 0.5)
        - loss_w * loss_val
    )
    return max(0.0, min(1.0, raw))


# ---------------------------------------------------------------------------
# Outcome
# ---------------------------------------------------------------------------

def outcome(
    room: list[tuple[str, str, float, bool]],
    veto_threshold: float = VETO_THRESHOLD,
    objection_threshold: float = OBJECTION_THRESHOLD,
) -> str:
    """Derive 'VETO', 'SOFT_PASS', or 'PASS' from the room's buy-in scores.

    room is a list of (stakeholder_id, power, buy_in, boundary_violated).
    power is 'high' or 'low'. boundary_violated is a precomputed bool from
    the graph predicate evaluator.

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
