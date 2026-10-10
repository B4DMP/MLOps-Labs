"""Hand the Pen balance sim (docs/plans/hand-over-the-pen.md, step 2). No database.

For every non-demo challenge, every component's owner (the plan's own open question defers edges:
"start with components only"), and each of the three trust bands (forced by setting the holder's
own Trust dimension), this locks `pen.draft_for_pen`'s draft into one slot and searches the
remaining slots with `card_search` at its usual budget, same as sim_incident.py.
Reports, against the same room with no pen:
  - the best outcome reached and how many sampled cards reach it,
  - the share of the challenge's damage won back (`card_search._health_after`),
  - a per-stakeholder tally, so a single always-best recipient would show up.

    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_pen.py
    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_pen.py 116 119
    docker compose exec -T -e PYTHONPATH=/app -e SIM_BUDGET=1500 api python tests/sim_pen.py

Neutral emotions throughout except the holder's forced Trust, as in sim_incident.py: a room with
worn-down emotions can only do worse, so this reads as the ceiling case. Owner-only and
components-only keeps this tractable (a "held note" can make almost anyone eligible for almost
anything, which multiplies the search space without changing what the trust-band logic itself
does - that part is already covered input-by-input in test_pen.py).
"""
import itertools
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mlops_serious_game.application.pitch_debate_service import card_search as auto_card  # noqa: E402
from mlops_serious_game.application.pitch_debate_service import pen  # noqa: E402
from mlops_serious_game.application.pitch_debate_service import session as pitch  # noqa: E402
from mlops_serious_game.domain.emotion_factory import EmotionFactory  # noqa: E402
from mlops_serious_game.domain.phase_factory import PhaseFactory  # noqa: E402
from test_playtest import _world  # noqa: E402

BUDGET = int(os.environ.get("SIM_BUDGET", "1500"))
RANK = {"PASS": 2, "SOFT_PASS": 1, "VETO": 0}
# Representative Trust values inside each of EmotionFactory's buckets (<=0.34 low, >=0.66 high).
BAND_TRUST = {"low": 0.15, "medium": 0.5, "high": 0.85}

only = {int(a) for a in sys.argv[1:]}
challenges = [
    c for p in PhaseFactory.get_phases() if not p.demo for c in p.challenges
    if not c.retired and (not only or c.id in only)
]


def _health_and_outcome(world, card):
    view = pitch.card_view(
        graph=world["graph"], state=world["state"], all_intel=world["all_intel"], changes=card,
        room=world["room"], emotion_values=world["emotions"],
    )
    health = auto_card._health_after(
        world["graph"], world["state"], card, view.reads, world["phase"], world["before_health"], world["par_health"],
    )
    return view.outcome, health


def _best_card_with_lock(world, locked, others, rng):
    """Best (outcome, health) among cards that keep `locked` in its slot and fill the rest from
    `others`, same combination strategy as sim_incident.py's restoring-chain search."""
    room_left = pitch.MAX_ATOMIC_CHANGES - 1
    combos = [[]]
    for k in range(1, room_left + 1):
        if len(others) < 14:
            picks = list(itertools.combinations(range(len(others)), k))
        else:
            picks = {tuple(sorted(rng.sample(range(len(others)), min(k, len(others))))) for _ in range(BUDGET // 4)}
        combos += [[others[i] for i in combo] for combo in picks]

    best_outcome, best_health = "VETO", 0.0
    pool = 0
    for extra in combos[:BUDGET]:
        outcome, health = _health_and_outcome(world, [locked] + extra)
        rank = RANK.get(outcome, 0)
        if rank > RANK.get(best_outcome, 0) or (rank == RANK.get(best_outcome, 0) and health > best_health):
            best_outcome, best_health = outcome, health
        if rank == RANK.get(best_outcome, 0):
            pool += 1
    return best_outcome, best_health, pool


print(f"{'id':>4} {'no-pen':<8} {'best w/ pen':<12} {'band':<7} {'holder':<20} {'target':<28} "
      f"{'won back':>8}  verdict")
per_recipient_best: dict[str, int] = {}
challenges_seen = 0
never_veto_free_low = []

for ch in challenges:
    world = _world(ch.id, entered=True)
    graph, state = world["graph"], world["state"]
    world["phase"] = ch.phase_id
    world["before_health"] = auto_card._stage_health_now(graph, state, ch.phase_id)
    world["par_health"] = round(world["before_health"] * 100)
    rng = random.Random(ch.id)

    cand = auto_card.candidate_changes(graph, state, world["allowed"], world["all_intel"])
    no_pen_result = auto_card.search_card(
        graph=graph, state=state, all_intel=world["all_intel"], room=world["room"], emotions=world["emotions"],
        allowed=world["allowed"], seed=f"pen-sim-{ch.id}", budget=BUDGET, prefer="best",
    )
    no_pen_outcome = no_pen_result.outcome if no_pen_result else "VETO"
    challenges_seen += 1

    room_ids = {st_id for st_id, _, _ in world["room"]}
    owned_targets = [
        (graph.owner_of(c.id), c.id) for c in graph.components if graph.owner_of(c.id) in room_ids
    ]

    challenge_best = ("VETO", 0.0, None, None)
    for stakeholder_id, target in owned_targets:
        for band, trust in BAND_TRUST.items():
            emotions = dict(world["emotions"])
            emotions[stakeholder_id] = EmotionFactory.apply_delta(
                emotions.get(stakeholder_id, EmotionFactory.create_default_emotion_values()),
                {"trust": trust - 0.5},
            )
            draft = pen.draft_for_pen(
                stakeholder_id, target, graph, state, world["all_intel"], world["room"], emotions,
                EmotionFactory.get_pitch_tuning(),
            )
            if draft is None:
                continue
            locked = draft.change.model_copy(update={"delegated_to": stakeholder_id})
            others = [c for c in cand if c.target != target]
            outcome, health, pool = _best_card_with_lock(world, locked, others, rng)

            if band == "low" and RANK.get(outcome, 0) == 0:
                never_veto_free_low.append((ch.id, stakeholder_id, target))

            if RANK.get(outcome, 0) > RANK.get(challenge_best[0], 0) or (
                RANK.get(outcome, 0) == RANK.get(challenge_best[0], 0) and health > challenge_best[1]
            ):
                challenge_best = (outcome, health, band, stakeholder_id, target)

    best_outcome, best_health, best_band, best_holder, best_target = (
        challenge_best if len(challenge_best) == 5 else (*challenge_best, None)
    )
    if best_holder:
        per_recipient_best[best_holder] = per_recipient_best.get(best_holder, 0) + 1
        print(f"{ch.id:>4} {no_pen_outcome:<8} {best_outcome:<12} {best_band:<7} {best_holder:<20} "
              f"{best_target:<28} {best_health:>8.2f}")
    else:
        print(f"{ch.id:>4} {no_pen_outcome:<8} {'(no draft)':<12}")

print()
print("best-recipient tally (a single dominant name across most challenges would be a red flag):")
for st_id, n in sorted(per_recipient_best.items(), key=lambda kv: -kv[1]):
    print(f"  {st_id:<20} best in {n}/{challenges_seen} challenges")

print()
if never_veto_free_low:
    print(f"Low-trust drafts that left NO veto-free card ({len(never_veto_free_low)}):")
    for ch_id, st_id, target in never_veto_free_low[:20]:
        print(f"  challenge {ch_id}: {st_id} on {target}")
else:
    print("No Low-trust draft left every searched card a veto (within this budget/sample).")
