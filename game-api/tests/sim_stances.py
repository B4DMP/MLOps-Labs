"""Every stance in a room, what it asks for, and whether the player may touch that target. No database.

    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_stances.py 115
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mlops_serious_game.domain.phase_factory import PhaseFactory  # noqa: E402
from mlops_serious_game.domain.requirement import item_target_and_level  # noqa: E402
from test_playtest import _world  # noqa: E402

for cid in [int(a) for a in sys.argv[1:]]:
    ch = PhaseFactory.get_challenge_by_id(cid)
    w = _world(cid, entered=True)
    allowed = set(w["allowed"])
    power = {sid: p for sid, p, _ in w["room"]}
    print(f"\n=== {cid} {ch.template_id}  allowed={sorted(allowed)}")
    for it in w["all_intel"]:
        t = getattr(it.type, "value", it.type)
        if t == "fact":
            continue
        target, level, axis = item_target_and_level(it)
        ops = [(o.get("target"), o.get("axis"), o.get("value")) for o in (getattr(it, "ops", None) or [])]
        atoms = list(getattr(it, "atoms", None) or [])
        bx, by = list(getattr(it, "branch_x_atoms", None) or []), list(getattr(it, "branch_y_atoms", None) or [])
        print(f" {it.stakeholder_id:20} {power.get(it.stakeholder_id):5} {t:9} target={target} {axis} {level} reachable={target in allowed if target else None}")
        if ops: print("      ops  ", ops)
        if atoms: print("      atoms", atoms)
        if bx or by: print("      X", bx, "Y", by)
