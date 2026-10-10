"""Stakeholder relations derived from intel items (docs/plans/case-board.md, D1/D2). Pure, no DB."""

import json

from mlops_serious_game.domain.Challenge import ChallengeConflict
from mlops_serious_game.domain.relations import derive_relations, eligible
from mlops_serious_game.domain.requirement import StakeholderRequirement


def req(rid, tag, sid, **fields):
    return StakeholderRequirement(id=rid, challenge_id=1, stakeholder_id=sid, type=tag, description="d", **fields)


def driver(rid, sid, target, level, axis="automation"):
    return req(rid, "driver", sid, metric_id="data", suggested={"target": target, "axis": axis, "level": level})


def trade_off(rid, sid, target, ceiling, axis="automation"):
    return req(rid, "trade_off", sid, concedes={"target": target, "axis": axis, "accepts_max_level": ceiling})


def kinds(rels):
    return sorted((r.kind, r.a, r.b, r.target) for r in rels)


def test_shared_floor_makes_an_unordered_ally_pair(real):
    rels = derive_relations([driver("d1", "zed", "data.validation", 2), driver("d2", "amy", "data.validation", 3)], None, real)
    assert kinds(rels) == [("ally", "amy", "zed", "data.validation")]
    assert rels[0].a_item_ids == ["d2"] and rels[0].b_item_ids == ["d1"]


def test_different_axis_or_target_is_not_an_ally(real):
    items = [driver("d1", "amy", "data.validation", 2), driver("d2", "zed", "data.validation", 2, axis="governance"),
             driver("d3", "bob", "data.versioning", 2)]
    assert [r.kind for r in derive_relations(items, None, real)] == ["step"]  # not allies: a different axis


def test_two_asks_on_one_step_on_different_axes_are_a_shared_step(real):
    items = [driver("d1", "amy", "data.validation", 2), driver("d2", "zed", "data.validation", 2, axis="governance")]
    rels = derive_relations(items, None, real)
    assert kinds(rels) == [("step", "amy", "zed", "data.validation")]
    assert rels[0].a_item_ids == ["d1"] and rels[0].b_item_ids == ["d2"]


def test_a_shared_step_is_not_added_when_they_are_already_allies_or_in_a_rift(real):
    ally = derive_relations([driver("d1", "amy", "data.validation", 2), driver("d2", "zed", "data.validation", 3)], None, real)
    rift = derive_relations([driver("d1", "amy", "data.validation", 3), trade_off("t", "zed", "data.validation", 1)], None, real)
    assert [r.kind for r in ally] == ["ally"] and [r.kind for r in rift] == ["rift"]


def test_both_accepting_the_same_limit_on_a_step_makes_allies(real):
    rels = derive_relations([trade_off("t1", "amy", "data.validation", 2), trade_off("t2", "zed", "data.validation", 1)], None, real)
    assert kinds(rels) == [("ally", "amy", "zed", "data.validation")]


def test_floor_above_ceiling_is_a_rift(real):
    rels = derive_relations([driver("d", "amy", "data.validation", 3), trade_off("t", "zed", "data.validation", 1)], None, real)
    assert kinds(rels) == [("rift", "amy", "zed", "data.validation")]


def test_same_stakeholder_is_never_compared(real):
    assert derive_relations([driver("d", "amy", "data.validation", 3), trade_off("t", "amy", "data.validation", 1)], None, real) == []


def test_set_value_clash_is_a_rift(real):
    def setter(rid, sid, value):
        return req(rid, "boundary", sid, ops=[{"kind": "set_trigger", "target": "e.validate_version", "value": value}])

    rels = derive_relations([setter("a", "amy", "scheduled"), setter("b", "zed", "on_commit")], None, real)
    assert [(r.kind, r.target) for r in rels] == [("rift", "e.validate_version")]


def test_conflict_block_makes_a_rift_when_both_sides_hold_an_item_near_the_target(real):
    conflict = ChallengeConflict(type="soft", target="data.validation", positions=[
        {"stakeholder_id": "amy", "axis": "governance", "wants": 3},
        {"stakeholder_id": "zed", "axis": "automation", "wants": 2},
    ])
    items = [driver("d1", "amy", "data.validation", 1, axis="governance"), driver("d2", "zed", "e.validate_version", 1)]
    rels = derive_relations(items, conflict, real)
    assert [(r.kind, r.a, r.b) for r in rels] == [("rift", "amy", "zed")]
    assert rels[0].on_record  # the challenge's own conflict is public
    # No item from zed near the target: nothing to connect.
    assert derive_relations(items[:1] + [driver("d3", "zed", "model.registry", 1)], conflict, real) == []


def test_a_rift_found_only_in_the_items_is_not_on_the_record(real):
    rels = derive_relations([driver("d", "amy", "data.validation", 3), trade_off("t", "zed", "data.validation", 1)], None, real)
    assert [r.on_record for r in rels] == [False]


def test_a_pair_is_never_both_allies_and_at_odds(real):
    conflict = ChallengeConflict(type="soft", target="data.validation", positions=[
        {"stakeholder_id": "amy", "axis": "governance", "wants": 3},
        {"stakeholder_id": "zed", "axis": "automation", "wants": 2},
    ])
    # amy and zed agree on data.versioning, but the challenge itself sets them against each other.
    items = [driver("d1", "amy", "data.validation", 1, axis="governance"), driver("d2", "zed", "data.validation", 1),
             driver("a1", "amy", "data.versioning", 2), driver("a2", "zed", "data.versioning", 2)]
    rels = derive_relations(items, conflict, real)
    assert {r.kind for r in rels if {r.a, r.b} == {"amy", "zed"}} == {"rift", "step"}
    assert [r.target for r in rels if r.kind == "step"] == ["data.versioning"]  # what they share is a step, not an alliance


def test_chain_when_an_upstream_ceiling_cannot_deliver_the_ask(real):
    items = [driver("ask", "amy", "e.validate_version", 3), trade_off("cap", "zed", "data.validation", 0)]
    chains = [r for r in derive_relations(items, None, real) if r.kind == "chain"]
    assert [(r.a, r.b, r.target, r.via) for r in chains] == [("amy", "zed", "e.validate_version", "data.validation")]
    # A generous ceiling leaves nothing in the way.
    relaxed = [driver("ask", "amy", "e.validate_version", 3), trade_off("cap", "zed", "data.validation", 3)]
    assert [r for r in derive_relations(relaxed, None, real) if r.kind == "chain"] == []


def test_ids_are_stable_and_output_is_sorted(real):
    items = [driver("d1", "zed", "data.validation", 2), driver("d2", "amy", "data.validation", 3), trade_off("t", "bob", "data.validation", 1)]
    first = derive_relations(items, None, real)
    again = derive_relations(list(reversed(items)), None, real)
    assert [r.model_dump() for r in first] == [r.model_dump() for r in again]
    assert len({r.id for r in first}) == len(first)
    assert first == sorted(first, key=lambda r: (["ally", "rift", "chain"].index(r.kind), r.a, r.b, r.target, r.via or ""))


def test_eligible_needs_a_held_item_on_each_side(real):
    rel = derive_relations([driver("d1", "amy", "data.validation", 2), driver("d2", "zed", "data.validation", 2)], None, real)[0]
    assert eligible(rel, {"d1", "d2"})
    assert not eligible(rel, {"d1"})
    assert not eligible(rel, {"d2", "other"})
    assert not eligible(rel, set())


def test_real_content_gives_every_playable_room_enough_to_find(config_dir, real):
    """The coverage gate (docs/plans/case-board.md, step 0): beyond the free on-record rift, every room
    with a board has at least 3 threads to find, tying at least 2 different pairs of people with at least 2 kinds of thread,
    and no pair is both allied and at odds. Rerun
    after any content regeneration."""
    reqs = [StakeholderRequirement(**r) for r in json.loads((config_dir / "RequirementObjects.json").read_text(encoding="utf-8"))["requirements"]]
    conflicts = {c["id"]: c.get("conflict") for c in json.loads((config_dir / "GameProgression.json").read_text(encoding="utf-8"))["challenges"]}
    rooms = {}
    for r in reqs:
        rooms.setdefault(r.challenge_id, []).append(r)
    for ch, items in rooms.items():
        people = {r.stakeholder_id for r in items if r.stakeholder_id}
        rels = derive_relations(items, ChallengeConflict(**conflicts[ch]) if conflicts.get(ch) else None, real)
        assert any(r.kind == "rift" and r.on_record for r in rels), f"challenge {ch} has no on-record rift"
        if len(people) < 3:
            continue  # no board in the demo
        by_pair: dict = {}
        for r in rels:
            by_pair.setdefault(frozenset((r.a, r.b)), set()).add(r.kind)
        assert not [p for p, k in by_pair.items() if {"ally", "rift"} <= k], f"challenge {ch} has a pair both allied and at odds"
        findable = [r for r in rels if not r.on_record]
        assert len(findable) >= 3, f"challenge {ch} has only {len(findable)} threads to find"
        assert len({frozenset((r.a, r.b)) for r in findable}) >= 2, f"challenge {ch} ties only one pair"
        assert len({r.kind for r in findable}) >= 2, f"challenge {ch} only has {findable[0].kind} threads to find"
