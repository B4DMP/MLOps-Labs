"""What is the best any card can do in each room, with 3 and with 4 changes? Needs no database.

    docker compose exec -T api python tests/sim_ceiling.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

from mlops_serious_game.application.pitch_debate_service import card_search as auto_card  # noqa: E402
from mlops_serious_game.application.pitch_debate_service import session as pitch  # noqa: E402
from mlops_serious_game.domain.phase_factory import PhaseFactory  # noqa: E402
from test_playtest import _world  # noqa: E402
import random  # noqa: E402

BUDGET = int(os.environ.get("CEIL_BUDGET", "2500"))
CHALLENGES = [c.id for p in PhaseFactory.get_phases() if not p.demo for c in p.challenges if not c.retired]

for cid in CHALLENGES:
    world = _world(cid, entered=True)
    cand = auto_card.candidate_changes(world["graph"], world["state"], world["allowed"], world["all_intel"])
    for cap in (3, 4):
        pitch.MAX_ATOMIC_CHANGES = cap
        rng = random.Random(1)
        counts = {"PASS": 0, "SOFT_PASS": 0, "VETO": 0}
        best = {"PASS": 0.0, "SOFT_PASS": 0.0, "VETO": 0.0}
        t = time.time()
        n = 0
        for card in auto_card._candidate_cards(cand, rng, BUDGET, world["state"]):
            v = pitch.card_view(graph=world["graph"], state=world["state"], all_intel=world["all_intel"],
                                changes=card, room=world["room"], emotion_values=world["emotions"])
            n += 1
            o = v.outcome if v.outcome in counts else "VETO"
            counts[o] += 1
            best[o] = max(best[o], min((r.buy_in for r in v.reads), default=0.0))
        print(f"challenge {cid} phase {PhaseFactory.get_challenge_by_id(cid).phase_id} cands={len(cand)} cap={cap} n={n} "
              f"{counts} bestMinBuyIn={ {k: round(x, 2) for k, x in best.items()} } {time.time()-t:.0f}s", flush=True)
