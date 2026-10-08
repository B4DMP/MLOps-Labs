"""Content gate: each room's declared `par_outcome` is what a card search can actually reach.

A room with par PASS must have a card (at most MAX_ATOMIC_CHANGES changes) the room passes once the challenge has
broken what it breaks (`on_enter_ops`, from the seed graph and a neutral room); a room that
declares SOFT_PASS must really have none. So an authoring change that opens or closes a clean pass
cannot go unnoticed, and the par the grade uses never drifts from the content
(docs/plans/shorter-playthrough-and-grade-spread.md, proposals 2 and 3). No database.
"""

import pytest

from mlops_serious_game.application.pitch_debate_service import card_search
from mlops_serious_game.domain.phase_factory import PhaseFactory

from test_playtest import _world

ROOMS = [c for p in PhaseFactory.get_phases() if not p.demo for c in p.challenges if not c.retired]


@pytest.mark.parametrize("challenge", ROOMS, ids=lambda c: c.template_id)
def test_declared_par_matches_what_the_room_allows(challenge):
    result = card_search.search_card(
        seed="par", budget=2500, wanted_passes=1, prefer="pass", **_world(challenge.id, entered=True)
    )
    reached = "PASS" if result is not None and result.outcome == "PASS" else "SOFT_PASS"
    assert reached == challenge.par_outcome, (
        f"{challenge.template_id} declares par {challenge.par_outcome} but the search reaches {reached}"
    )


def _targets(item) -> set[str]:
    """Every graph target an item names: its headline target, its ops and its atoms."""
    from mlops_serious_game.domain.requirement import item_target_and_level

    target, _, _ = item_target_and_level(item)
    named = {target} if target else set()
    named |= {o.get("target") for o in (getattr(item, "ops", None) or []) if isinstance(o, dict)}
    for atom in getattr(item, "atoms", None) or []:
        named.add(atom.split("(", 1)[1].split(",", 1)[0].strip())
    return {t for t in named if t}


# Drivers still pinned at the floor by a cross-stage edge the room does not offer. They do not stop a
# PASS in the rooms that have one, but each is a note the player can never act on. Fix them in the
# content and delete the line; the test lets nothing new in.
KNOWN_UNREACHABLE = {
    "gen_nightly_window_miss_ruth_trigger_driver",
    "gen_heatwave_forecast_gap_dave_driver_fs_train",
    "gen_override_blind_spot_dave_driver_data",
    "gen_override_blind_spot_emilia_driver_efficiency",
    "gen_override_blind_spot_emilia_driver_monitoring",
    "gen_shadow_deployment_contract_reuben_driver_orch",
    "gen_cost_crisis_drift_gap_monica_driver_edge_perf",
}


@pytest.mark.parametrize("challenge", ROOMS, ids=lambda c: c.template_id)
def test_a_boundary_can_always_be_met_and_a_driver_can_always_be_started(challenge):
    """A boundary on something the player may not touch is violated for good, and a driver none of
    whose targets can be touched is unmet for good: either one pins its owner at the floor and
    makes a clean pass impossible whatever the player does."""
    world = _world(challenge.id, entered=True)
    allowed = set(world["allowed"])
    stuck = []
    for item in world["all_intel"]:
        kind = getattr(item.type, "value", item.type)
        named = _targets(item)
        if kind == "boundary":
            holds = getattr(item, "holds", None) or {}
            held = holds.get("component") or holds.get("edge")
            if held and held not in allowed:
                stuck.append(f"boundary {item.id} holds on {held}")
        elif kind == "driver" and named and not (named & allowed) and item.id not in KNOWN_UNREACHABLE:
            stuck.append(f"driver {item.id} only names {sorted(named)}")
    assert not stuck, f"{challenge.template_id}: {stuck}"
