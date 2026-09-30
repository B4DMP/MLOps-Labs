"""One stakeholder's intel items must not undo each other (`self_contradictions`)."""

from mlops_serious_game.domain.requirement import StakeholderRequirement, self_contradictions


def req(rid, tag, sid="s1", **fields):
    return StakeholderRequirement(id=rid, challenge_id=1, stakeholder_id=sid, type=tag, description="d", **fields)


def driver(rid, target, level, axis="automation", sid="s1", ops=None):
    return req(rid, "driver", sid, metric_id="data", suggested={"target": target, "axis": axis, "level": level}, ops=ops or [])


def trade_off(rid, target, ceiling, axis="automation", sid="s1", **fields):
    return req(rid, "trade_off", sid, concedes={"target": target, "axis": axis, "accepts_max_level": ceiling}, **fields)


def raise_op(target, level, axis="automation"):
    return {"kind": "raise_to", "target": target, "axis": axis, "value": level}


def test_driver_above_own_concession_is_flagged():
    found = self_contradictions([driver("d", "data.validation", 3), trade_off("t", "data.validation", 2)])
    assert len(found) == 1 and "'d'" in found[0] and "'t' can never be honoured" in found[0]


def test_other_stakeholders_are_not_compared():
    assert self_contradictions([driver("d", "data.validation", 3), trade_off("t", "data.validation", 2, sid="s2")]) == []


def test_other_axis_or_target_is_no_contradiction():
    assert self_contradictions([driver("d", "data.validation", 3, axis="governance"), trade_off("t", "data.validation", 2)]) == []
    assert self_contradictions([driver("d", "data.versioning", 3), trade_off("t", "data.validation", 2)]) == []


def test_composite_driver_step_is_checked_too():
    d = driver("d", "data.validation", 3, ops=[raise_op("e.validate_version", 3)])
    assert self_contradictions([d, trade_off("t", "e.validate_version", 2)])


def test_boundary_floor_against_own_branch_kills_the_branch():
    branch = {"description": "keep it", "target": "data.validation", "axis": "automation", "level": 2}
    t = req("t", "trade_off", branch_x=branch, branch_y={**branch, "level": 3})
    b = req("b", "boundary", holds={"component": "data.validation", "axis": "automation", "op": "gte", "level": 3},
            ops=[raise_op("data.validation", 3)])
    assert self_contradictions([t, b])


def test_boundary_upper_limit_against_own_driver_is_flagged():
    b = req("b", "boundary", holds={"not": {"component": "data.validation", "axis": "automation", "op": "gte", "level": 3}},
            ops=[])
    assert self_contradictions([b, driver("d", "data.validation", 3)])
    assert self_contradictions([b, driver("d", "data.validation", 2)]) == []


def test_trade_off_alternatives_that_avoid_each_other_are_fine():
    """A branch that does not touch a target leaves the player a way to honour both items."""
    x = {"description": "x", "target": "deploy.cicd", "axis": "governance", "level": 3}
    y = {"description": "y", "target": "deploy.cicd", "axis": "automation", "level": 3}
    a = req("a", "trade_off", branch_x=x, branch_y=y)
    assert self_contradictions([a, trade_off("t", "deploy.cicd", 2)]) == []


def test_different_values_written_to_one_attribute_are_flagged():
    def writes(rid, value):
        return req(rid, "trade_off", concedes={"metric_id": "efficiency", "loss": 3},
                   ops=[{"kind": "set_attr", "target": "data.feature_store", "attr": "sourcing", "value": value}])

    assert self_contradictions([writes("a", "bought"), writes("b", "built")])
    assert self_contradictions([writes("a", "bought"), writes("b", "bought")]) == []


def test_written_value_the_own_boundary_rules_out_is_flagged():
    writer = req("w", "trade_off", concedes={"metric_id": "efficiency", "loss": 3},
                 ops=[{"kind": "set_attr", "target": "deploy.serving", "attr": "hosting", "value": "public_cloud"}])
    boundary = req("b", "boundary", holds={"not": {"attr": "deploy.serving.hosting", "op": "eq", "value": "public_cloud"}}, ops=[])
    assert self_contradictions([writer, boundary])


def test_facts_are_ignored():
    fact = req("f", "fact", sid=None, asserts={"target": "data.validation", "axis": "automation", "level": 1})
    assert self_contradictions([fact, trade_off("t", "data.validation", 2)]) == []
