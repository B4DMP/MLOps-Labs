"""How close a room is to a PASS: cards that cross no boundary, and who still objects to the best of them.
No database.

    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_near.py 114 115
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mlops_serious_game.application.pitch_debate_service import card_search  # noqa: E402
from mlops_serious_game.application.pitch_debate_service import session as pitch  # noqa: E402
from test_playtest import _world  # noqa: E402

BUDGET = int(os.environ.get("NEAR_BUDGET", "6000"))
for cid in [int(a) for a in sys.argv[1:]]:
    w = _world(cid, entered=True)
    cand = card_search.candidate_changes(w["graph"], w["state"], w["allowed"], w["all_intel"])
    clean = []
    for card in card_search._candidate_cards(cand, random.Random(1), BUDGET, w["state"]):
        v = pitch.card_view(graph=w["graph"], state=w["state"], all_intel=w["all_intel"], changes=card,
                            room=w["room"], emotion_values=w["emotions"])
        if not any(r.boundary_violated for r in v.reads):
            clean.append((card, v))
    print(f"\n=== {cid}: cards crossing no boundary: {len(clean)} of up to {BUDGET}")
    clean.sort(key=lambda cv: (-{"PASS": 2, "SOFT_PASS": 1, "VETO": 0}[cv[1].outcome], len(cv[0]), -min(r.buy_in for r in cv[1].reads)))
    for card, v in clean[:3]:
        print("  ", v.outcome, [(c.target, c.axis, c.value) for c in card])
        for r in v.reads:
            print(f"      {r.stakeholder_id:20} {r.power:5} align={r.alignment:+.2f} buy_in={r.buy_in:.2f}")
