"""Boundaries of a room against its entered state: which already hold, and what each needs. No database.

    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_boundaries.py 114 115
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mlops_serious_game.application.graph_service.view import evaluate_graph  # noqa: E402
from mlops_serious_game.domain.graph_predicates import evaluate  # noqa: E402
from mlops_serious_game.domain.phase_factory import PhaseFactory  # noqa: E402
from test_playtest import _world  # noqa: E402

for cid in [int(a) for a in sys.argv[1:]]:
    ch = PhaseFactory.get_challenge_by_id(cid)
    w = _world(cid, entered=True)
    ctx = evaluate_graph(w["graph"], w["state"]).context(w["graph"], w["state"])
    print(f"\n=== {cid} {ch.template_id} par={ch.par_outcome} conflict={ch.conflict.model_dump() if ch.conflict else None}")
    power = {sid: p for sid, p, _ in w["room"]}
    for it in w["all_intel"]:
        t = getattr(it.type, "value", it.type)
        if t != "boundary":
            continue
        holds = getattr(it, "holds", None)
        try:
            ok = evaluate(holds, ctx).value
        except Exception as e:  # noqa: BLE001
            ok = f"?{e}"
        print(f" BOUNDARY {it.stakeholder_id} ({power.get(it.stakeholder_id)}) holds_now={ok} id={it.id}")
        print("    holds:", json.dumps(holds)[:160])
        print("    ops:", [(o.get('target'), o.get('axis'), o.get('value')) for o in (getattr(it, 'ops', None) or [])])
