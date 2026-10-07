"""Why a room has no PASS: the best card's per-stakeholder read, and who blocks it. No database.

    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_rooms.py 114 115 116
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mlops_serious_game.application.pitch_debate_service import session as pitch  # noqa: E402
from mlops_serious_game.application.pitch_debate_service import card_search as auto_card  # noqa: E402
from mlops_serious_game.domain.phase_factory import PhaseFactory  # noqa: E402
from test_playtest import _world  # noqa: E402

for cid in [int(a) for a in sys.argv[1:]]:
    ch = PhaseFactory.get_challenge_by_id(cid)
    world = _world(cid, entered=True)
    print(f"\n=== {cid} {ch.template_id} phase {ch.phase_id} conflict={ch.conflict.model_dump() if ch.conflict else None}")
    for item in world["all_intel"]:
        print("   intel", item.stakeholder_id, getattr(item.type, "value", item.type), "|", item.description[:90])
    cand = auto_card.candidate_changes(world["graph"], world["state"], world["allowed"], world["all_intel"])
    best = None
    rng = random.Random(1)
    for card in auto_card._candidate_cards(cand, rng, 2500, world["state"]):
        v = pitch.card_view(graph=world["graph"], state=world["state"], all_intel=world["all_intel"], changes=card,
                            room=world["room"], emotion_values=world["emotions"])
        key = ({"PASS": 2, "SOFT_PASS": 1}.get(v.outcome, 0), min(r.buy_in for r in v.reads), sum(r.buy_in for r in v.reads))
        if best is None or key > best[0]:
            best = (key, card, v)
    _, card, v = best
    print("   best:", v.outcome, [(c.target, c.axis, c.value) for c in card])
    for r in v.reads:
        print(f"   read {r.stakeholder_id:20} {r.power:5} align={r.alignment:+.2f} buy_in={r.buy_in:.2f} boundary={r.boundary_violated}")
