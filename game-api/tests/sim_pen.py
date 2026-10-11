"""Hand the Pen balance sim (docs/plans/hand-over-the-pen.md). No database.

For every non-demo challenge, every stakeholder in the room and each trust band (forced by setting
the holder's Trust), this takes `pen.draft_for_pen`'s draft and reports, against the same room with
no pen:
  - the axis mix of the drafts per band (automation versus governance), so a skew shows up,
  - whether a veto-free card still exists with the draft locked in a slot,
  - what a takeover does to the best card found without a pen (outcome, and whether it removed
    the change that restores the challenge's incident),
  - a per-recipient tally, so a single always-best person would show up.

    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_pen.py
    docker compose exec -T -e PYTHONPATH=/app api python tests/sim_pen.py 116 119
    docker compose exec -T -e PYTHONPATH=/app -e SIM_BUDGET=1500 api python tests/sim_pen.py

Neutral emotions throughout except the holder's forced Trust, as in sim_incident.py: a room with
worn-down emotions can only do worse, so this reads as the ceiling case.
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
TIE_TOLERANCE = 0.02

only = {int(a) for a in sys.argv[1:]}
challenges = [
    c for p in PhaseFactory.get_phases() if not p.demo for c in p.challenges
    if not c.retired and (not only or c.id in only)
]


def _outcome_and_health(world, card):
    view = pitch.card_view(
        graph=world["graph"], state=world["state"], all_intel=world["all_intel"], changes=card,
        room=world["room"], emotion_values=world["emotions"],
    )
    health = auto_card._health_after(
        world["graph"], world["state"], card, view.reads, world["phase"], world["before_health"], world["ceiling"],
    )
    return view.outcome, health


def _best_with_lock(world, locked, others, rng):
    """Best (outcome, health) among cards that keep `locked` and fill the rest from `others`."""
    combos = [[]]
    for k in range(1, pitch.MAX_ATOMIC_CHANGES):
        if len(others) < 14:
            picks = list(itertools.combinations(range(len(others)), k))
        else:
            picks = {tuple(sorted(rng.sample(range(len(others)), min(k, len(others))))) for _ in range(BUDGET // 4)}
        combos += [[others[i] for i in combo] for combo in picks]
    best = ("VETO", 0.0)
    for extra in combos[:BUDGET]:
        outcome, health = _outcome_and_health(world, [locked] + extra)
        if (RANK[outcome], health) > (RANK[best[0]], best[1]):
            best = (outcome, health)
    return best


axis_mix = {band: {"automation": 0, "governance": 0} for band in BAND_TRUST}
item_mix = {band: {"from an item": 0, "owned fallback": 0} for band in BAND_TRUST}
no_draft = 0
low_without_veto_free: list[tuple] = []
takeovers = {"replaced": 0, "outcome dropped": 0, "incident repair lost": 0, "became veto": 0}
tied_by_recipient: dict[str, int] = {}
seen_by_recipient: dict[str, int] = {}

print(f"{'id':>4} {'no-pen':<8} per band best card with the draft locked (outcome, won back), for the best recipient")
for ch in challenges:
    world = _world(ch.id, entered=True)
    graph, state = world["graph"], world["state"]
    world["phase"] = ch.phase_id
    world["before_health"] = auto_card._stage_health_now(graph, state, ch.phase_id)
    world["ceiling"] = round(auto_card._stage_health_now(_world(ch.id)["graph"], _world(ch.id)["state"], ch.phase_id) * 100)
    rng = random.Random(ch.id)
    allowed = set(world["allowed"])
    incident = (ch.on_enter_ops or [{}])[0].get("target")
    cand = auto_card.candidate_changes(graph, state, world["allowed"], world["all_intel"])
    base = auto_card.search_card(
        graph=graph, state=state, all_intel=world["all_intel"], room=world["room"], emotions=world["emotions"],
        allowed=world["allowed"], seed=f"pen-sim-{ch.id}", budget=BUDGET, prefer="best",
    )
    base_card = list(base.changes) if base else []
    base_outcome = base.outcome if base else "VETO"

    rows = {band: [] for band in BAND_TRUST}
    for st_id, _power, _interest in world["room"]:
        seen_by_recipient[st_id] = seen_by_recipient.get(st_id, 0) + 1
        for band, trust in BAND_TRUST.items():
            emotions = dict(world["emotions"])
            emotions[st_id] = EmotionFactory.apply_delta(
                emotions.get(st_id, EmotionFactory.create_default_emotion_values()), {"trust": trust - 0.5}
            )
            draft = pen.draft_for_pen(
                st_id, graph, state, world["all_intel"], world["room"], emotions, EmotionFactory.get_pitch_tuning(),
                [], allowed_targets=allowed, seed=f"sim:{ch.id}:{st_id}",
            )
            if draft is None:
                no_draft += 1
                continue
            axis_mix[band][draft.change.axis] += 1
            item_mix[band]["from an item" if draft.item_id else "owned fallback"] += 1

            locked = draft.change.model_copy(update={"delegated_to": st_id})
            outcome, health = _best_with_lock(world, locked, [c for c in cand if c.target != draft.target], rng)
            rows[band].append((RANK[outcome], health, outcome, st_id))
            if band == "low" and outcome == "VETO":
                low_without_veto_free.append((ch.id, st_id, draft.target))

            placed = pen.place_draft(base_card, draft)
            if placed is not None and placed[1] is not None:
                takeovers["replaced"] += 1
                new_outcome, _ = _outcome_and_health(world, placed[0])
                if RANK[new_outcome] < RANK[base_outcome]:
                    takeovers["outcome dropped"] += 1
                if new_outcome == "VETO" and base_outcome != "VETO":
                    takeovers["became veto"] += 1
                touched = lambda card: any(c.target == incident for c in card)  # noqa: E731
                if touched(base_card) and not touched(placed[0]):
                    takeovers["incident repair lost"] += 1

    cells = []
    best_overall = []
    for band, rs in rows.items():
        if not rs:
            cells.append(f"{band}: (none)")
            continue
        top = max(rs, key=lambda r: (r[0], r[1]))
        cells.append(f"{band}: {top[2]} {top[1]:.2f}")
        best_overall += rs
    if best_overall:
        top_rank = max(r[0] for r in best_overall)
        top_health = max(r[1] for r in best_overall if r[0] == top_rank)
        for st in {r[3] for r in best_overall if r[0] == top_rank and r[1] >= top_health - TIE_TOLERANCE}:
            tied_by_recipient[st] = tied_by_recipient.get(st, 0) + 1
    print(f"{ch.id:>4} {base_outcome:<8} " + "   ".join(cells))

print()
print("axis of the draft, per band (a governance share well above half where the holder has an")
print("unmet automation item is the skew this rework was meant to remove):")
for band, mix in axis_mix.items():
    total = sum(mix.values()) or 1
    print(f"  {band:<7} automation {mix['automation']:>3}  governance {mix['governance']:>3}  "
          f"({100 * mix['governance'] / total:.0f}% governance)   "
          f"from an item {item_mix[band]['from an item']:>3}, owned fallback {item_mix[band]['owned fallback']:>3}")
print(f"  no draft possible: {no_draft}")

print()
print("takeover, against the best card found without a pen:")
for name, n in takeovers.items():
    print(f"  {name:<22} {n}")

print()
print(f"recipients within {TIE_TOLERANCE} health of the top rank, per challenges they were in the room for")
print("(one name near 100% while the rest sit near 0% is the dominant-recipient red flag):")
for st_id in sorted(seen_by_recipient, key=lambda s: -tied_by_recipient.get(s, 0) / seen_by_recipient[s]):
    n, of = tied_by_recipient.get(st_id, 0), seen_by_recipient[st_id]
    print(f"  {st_id:<20} {n}/{of} ({100 * n / of:.0f}%)")

print()
if low_without_veto_free:
    print(f"Low-trust drafts that left NO veto-free card ({len(low_without_veto_free)}):")
    for ch_id, st_id, target in low_without_veto_free[:20]:
        print(f"  challenge {ch_id}: {st_id} on {target}")
else:
    print("No Low-trust draft left every searched card a veto (within this budget/sample).")
