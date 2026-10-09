"""Which challenges have a card that fixes what the challenge broke AND gets past the room? No database.

Each challenge opens with a world event (`on_enter_ops`) that breaks one target. This sweeps
cards of up to MAX_ATOMIC_CHANGES changes and, per challenge, compares:
  - the best outcome of any card,
  - the best outcome of cards that put the broken target back to working order (Manual or better:
    nobody can raise to Absent on purpose, so that is what a repair means), and how many cards in
    the sample reach it, so a room where only one lucky card works shows as narrow,
  - how many slots that takes,
  - the share of the damage the challenge did that the best veto-free card wins back, on the same
    measure the final grade's Pipeline pillar uses (`card_search._health_after`, up to the stage's
    health before the event): that counts a route around the break, which the strict "repair the
    broken component" test does not.

    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_incident.py
    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_incident.py 116 119      # a few challenges
    docker compose exec -T -e PYTHONPATH=/app -e SIM_BUDGET=3000 api python tests/sim_incident.py

Neutral emotions are used, as in sim_ceiling.py: a room with worn-down emotions can only do worse.
"""
import itertools
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mlops_serious_game.application.graph_service.apply import apply_ops  # noqa: E402
from mlops_serious_game.application.pitch_debate_service import card_search as auto_card  # noqa: E402
from mlops_serious_game.application.pitch_debate_service import session as pitch  # noqa: E402
from mlops_serious_game.domain.phase_factory import PhaseFactory  # noqa: E402
from test_playtest import _world  # noqa: E402

BUDGET = int(os.environ.get("SIM_BUDGET", "1500"))
RANK = {"PASS": 2, "SOFT_PASS": 1, "VETO": 0}
MANUAL = 2

only = {int(a) for a in sys.argv[1:]}
challenges = [
    c for p in PhaseFactory.get_phases() if not p.demo for c in p.challenges
    if not c.retired and (not only or c.id in only)
]


def chain_to(graph, state, target, axis, level):
    """The changes that take `target` from where it stands to `level`, one allowed rung per slot.
    Nobody raises to Absent on purpose (`resolve_step_cap`), so a repair from Broken goes straight to Manual."""
    if axis == "automation":
        level = max(level, MANUAL) if state.value(target, axis) < MANUAL else level
        steps = [lv for lv in sorted(graph.allowed_for(target, axis)) if max(state.value(target, axis), 1) < lv <= level]
    else:
        steps = [lv for lv in sorted(graph.allowed_for(target, axis)) if state.value(target, axis) < lv <= level]
    return [pitch.AtomicChange(target=target, kind="raise_to", axis=axis, value=lv) for lv in steps]


def evaluate(world, card):
    """(view, state after the card, share of the damage won back)."""
    view = pitch.card_view(
        graph=world["graph"], state=world["state"], all_intel=world["all_intel"], changes=card,
        room=world["room"], emotion_values=world["emotions"],
    )
    ops = pitch.atomic_changes_to_ops(world["graph"], world["state"], card)
    after = apply_ops(world["graph"], world["state"], ops).state
    health = auto_card._health_after(
        world["graph"], world["state"], card, view.reads, world["phase"], world["before_health"], world["par_health"]
    )
    return view, after, health


def best_of(rows):
    if not rows:
        return "none", 0, 0.0
    top = max(r[0] for r in rows)
    pool = [r for r in rows if r[0] == top]
    name = {2: "PASS", 1: "SOFT_PASS", 0: "VETO"}[top]
    return name, len(pool), max(r[1] for r in pool)


print(f"{'id':>4} {'incident':<32} {'before':>6} {'now':>3} {'touch':>5} {'slots':>5}  "
      f"{'any card':<10} {'restoring cards':<18} {'sampled':>7}  {'won ok':>6} {'won any':>6}  verdict")
flagged = []
for ch in challenges:
    world = _world(ch.id, entered=True)
    seed_world = _world(ch.id, entered=False)
    seed_state = seed_world["state"]
    graph, state = world["graph"], world["state"]
    world["phase"] = ch.phase_id
    world["par_health"] = round(auto_card._stage_health_now(seed_world["graph"], seed_world["state"], ch.phase_id) * 100)
    world["before_health"] = auto_card._stage_health_now(graph, state, ch.phase_id)
    ops = ch.on_enter_ops or []
    if not ops:
        print(f"{ch.id:>4} (no world event)")
        continue
    target, axis = ops[0]["target"], ops[0].get("axis", "automation")
    pre, now = seed_state.value(target, axis), state.value(target, axis)
    touchable = target in set(world["allowed"])

    cand = auto_card.candidate_changes(graph, state, world["allowed"], world["all_intel"])
    others = [c for c in cand if c.target != target]
    rng = random.Random(7)

    results = {"any": [], "restore": []}
    # Plain cards: the usual search space.
    for card in auto_card._candidate_cards(cand, rng, BUDGET, state):
        view, after, health = evaluate(world, card)
        lvl = after.value(target, axis)
        row = (RANK.get(view.outcome, 0), min((r.buy_in for r in view.reads), default=0.0), health)
        results["any"].append(row)
        if lvl >= MANUAL:
            results["restore"].append(row)
    # Cards built around a restoring chain, so that part of the space is covered however big the rest is.
    # Two chains: back to Manual (one slot), and on to the top rung (Fix It, then Automate It), because
    # a stage can carry an anti-pattern that only clears once the component is fully automated.
    top = max(graph.allowed_for(target, axis))
    for name, level in (("restore", MANUAL), ("restore", top)):
        chain = chain_to(graph, state, target, axis, level) if touchable else []
        if not chain or len(chain) > pitch.MAX_ATOMIC_CHANGES:
            continue
        room = pitch.MAX_ATOMIC_CHANGES - len(chain)
        extras = [[]]
        for k in range(1, room + 1):
            combos = list(itertools.combinations(range(len(others)), k)) if len(others) < 14 else None
            if combos is None:
                combos = {tuple(sorted(rng.sample(range(len(others)), min(k, len(others))))) for _ in range(BUDGET // 2)}
            extras += [[others[i] for i in combo] for combo in combos]
        for extra in extras[:BUDGET * 2]:
            view, after, health = evaluate(world, chain + extra)
            if after.value(target, axis) >= level:
                results[name].append((RANK.get(view.outcome, 0), min((r.buy_in for r in view.reads), default=0.0), health))

    slots = len(chain_to(graph, state, target, axis, MANUAL)) if touchable else None
    any_best = best_of(results["any"])[0]
    best, best_n, _ = best_of(results["restore"])
    every = results["any"] + results["restore"]
    won_ok = max((r[2] for r in every if r[0] > 0), default=0.0)
    won_any = max((r[2] for r in every), default=0.0)
    ok = best in ("PASS", "SOFT_PASS")
    if not touchable:
        verdict = "NOT TOUCHABLE"
    elif not ok:
        verdict = "NEEDS A FIX: no veto-free card restores it"
    elif RANK.get(best, 0) < RANK.get(any_best, 0):
        verdict = "restoring costs the outcome"
    elif best_n <= 3:
        verdict = "ok but narrow"
    else:
        verdict = "ok"
    if verdict != "ok":
        flagged.append((ch.id, verdict))
    print(f"{ch.id:>4} {target:<32} {pre:>6} {now:>3} {str(touchable):>5} {str(slots):>5}  "
          f"{any_best:<10} {best + ' (' + str(best_n) + ')':<18} {len(results['restore']):>7}  "
          f"{won_ok:>6.2f} {won_any:>6.2f}  {verdict}")

print()
print("flagged:", flagged or "none")
