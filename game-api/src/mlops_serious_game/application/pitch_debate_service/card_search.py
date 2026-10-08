"""Finding an action card the room will not veto (docs/plans/results-screen.md, D9).

`card_view` is pure and LLM-free, and a card is at most `MAX_ATOMIC_CHANGES` changes drawn from the
few targets the player may touch in a phase, so this is a search over a small space with a cheap
oracle. It samples that space rather than enumerating it: three-change cards over thirty targets is
thousands of evaluations, and a few hundred random ones find a passing card whenever one is common
enough to be worth finding.

**No guarantee that a non-veto card exists.** `buy_in = 0.6 * alignment + 0.4 * emotions`, and a
boundary violation by a high-power stakeholder vetoes regardless of score, so a room with
worn-down emotions or conflicting boundaries may have no clean card at all. The search says so,
returning the best it found with `outcome == "VETO"`, rather than pretending.

Deterministic for a given seed, so a playtest run can be reproduced.
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from mlops_serious_game.application.pitch_debate_service import session as pitch
from mlops_serious_game.domain.graph import AutomationState
from mlops_serious_game.domain.requirement import item_target_and_level

# How many candidate cards to evaluate at most, and how many passing ones to collect before stopping.
DEFAULT_BUDGET = 400
DEFAULT_WANTED_PASSES = 25

# Outcomes in the order a search tries them, per preference. A veto is only ever picked on purpose.
_LADDER = {
    "pass": ("PASS", "SOFT_PASS"),
    "soft": ("SOFT_PASS", "PASS"),
    "veto": ("VETO", "SOFT_PASS", "PASS"),
}

# "best" looks at the whole budget and keeps the strongest card instead of a random acceptable one.
BEST_BUDGET = 1500
# A hint shown to a player mid-pitch, so it has to come back in a few seconds.
CEILING_BUDGET = 600
_RANK = {"PASS": 2, "SOFT_PASS": 1, "VETO": 0}

# With this few candidates every card can be tried, so the search is exhaustive rather than sampled.
SMALL_SPACE = 12


@dataclass
class CardSearchResult:
    """What the search found: the card, how it fared, and how hard it had to look."""

    changes: list[pitch.AtomicChange]
    outcome: str
    evaluated: int
    #: The lowest buy-in in the room for the chosen card. Shows how close a veto was.
    min_buy_in: float
    #: How many cards of the chosen outcome were found, i.e. how much choice the pick had.
    pool: int = 0

    @property
    def found_non_veto(self) -> bool:
        return self.outcome in ("PASS", "SOFT_PASS")


def candidate_changes(
    graph: Any,
    state: Any,
    allowed: Iterable[str],
    all_intel: Iterable[Any] = (),
) -> list[pitch.AtomicChange]:
    """Every change the player could legally slot.

    Two kinds. First, what the intel actually asks for: a stakeholder's demand names a target and a
    level, and a card only satisfies it by raising that target *to that level*. Raising by one step
    is not enough when the demand is two up, which is why a search over single steps alone finds
    almost nothing the room will accept. Second, the plain next step on every known target, so the
    search can also try changes nobody asked for.

    Mirrors what `handle_pitch_set_card` accepts, so nothing returned here is rejected there: a
    target outside the allowed set or never looked at is skipped, as is one already at its top.
    """
    allowed_set = set(allowed)
    candidates: list[pitch.AtomicChange] = []
    seen: set[tuple[str, str, int]] = set()

    def consider(target: Optional[str], level: Optional[int], axis: Optional[str]) -> None:
        if not target or level is None or axis is None or target not in allowed_set or not graph.is_target(target):
            return
        if level <= state.value(target, axis) or level not in graph.allowed_for(target, axis):
            return
        if (target, axis, level) in seen:
            return
        seen.add((target, axis, level))
        candidates.append(pitch.AtomicChange(target=target, kind="raise_to", axis=axis, value=level))

    for item in all_intel:
        target, level, axis = item_target_and_level(item)
        consider(target, level, axis)

    for target in sorted(allowed_set):
        if not graph.is_target(target):
            continue
        for axis in ("automation", "governance"):
            higher = [level for level in graph.allowed_for(target, axis) if level > state.value(target, axis)]
            if higher:
                consider(target, min(higher), axis)

    # A governance raise on an unimplemented target needs its implementing automation step as a
    # candidate too, or `_implementation_pairs` has nothing to pair it with (the next step may be < MANUAL).
    for change in list(candidates):
        current = state.value(change.target, "automation")
        if change.axis == "governance" and current < AutomationState.MANUAL:
            implementing = [lv for lv in graph.allowed_for(change.target, "automation")
                            if lv >= AutomationState.MANUAL and lv > current]
            if implementing:
                consider(change.target, min(implementing), "automation")
    return candidates


def _implementation_pairs(candidates: list[pitch.AtomicChange], state: Any) -> list[list[pitch.AtomicChange]]:
    """A governance ask on a target that isn't implemented yet needs its automation step in the
    same card - apply.py's `_apply_one` rejects a governance raise outright otherwise (00-plan.md's
    governance-requires-implemented follow-up). Paired here and tried right after singles, rather
    than left to random combination luck once the space is too big to enumerate outright: a
    governance-only single never passes on its own now, so without this the search could burn its
    whole budget on singles and never try the one combination that actually works."""
    automation_for_target: dict[str, pitch.AtomicChange] = {}
    for c in candidates:
        if c.axis == "automation" and isinstance(c.value, int) and c.value >= AutomationState.MANUAL:
            existing = automation_for_target.get(c.target)
            if existing is None or c.value < existing.value:
                automation_for_target[c.target] = c

    pairs = []
    for c in candidates:
        if c.axis != "governance" or state.value(c.target, "automation") >= AutomationState.MANUAL:
            continue
        automation = automation_for_target.get(c.target)
        if automation is not None:
            pairs.append([automation, c])
    return pairs


def _candidate_cards(
    candidates: list[pitch.AtomicChange], rng: random.Random, budget: int, state: Any = None
) -> Iterable[list[pitch.AtomicChange]]:
    """Cards to try: every single change first (cheap, and often enough), then every
    automation-implements-its-own-governance pair, then random pairs and triples until the budget
    runs out."""
    yielded = 0
    for change in candidates:
        if yielded >= budget:
            return
        yield [change]
        yielded += 1

    if state is not None:
        pairs = _implementation_pairs(candidates, state)
        for pair in pairs:
            if yielded >= budget:
                return
            yield pair
            yielded += 1
        # A room with more than one high-power stakeholder can easily need more than just the
        # pair: try each alongside one more candidate before falling back to blind combination
        # search, rather than leaving "the pair plus whatever else the room needs" to chance.
        if pitch.MAX_ATOMIC_CHANGES > 2:
            for pair in pairs:
                used = {(c.target, c.axis) for c in pair}
                for extra in candidates:
                    if (extra.target, extra.axis) in used:
                        continue
                    if yielded >= budget:
                        return
                    yield pair + [extra]
                    yielded += 1

    seen: set[frozenset[int]] = set()
    indices = range(len(candidates))
    max_size = min(pitch.MAX_ATOMIC_CHANGES, len(candidates))
    # A space this small can be enumerated outright; only sample when it is too big to.
    if len(candidates) <= SMALL_SPACE:
        for size in range(2, max_size + 1):
            for combo in itertools.combinations(indices, size):
                if yielded >= budget:
                    return
                yield [candidates[i] for i in combo]
                yielded += 1
        return

    attempts = 0
    while yielded < budget and attempts < budget * 6:
        attempts += 1
        size = rng.randint(2, max_size)
        combo = frozenset(rng.sample(list(indices), size))
        if combo in seen:
            continue
        seen.add(combo)
        yield [candidates[i] for i in sorted(combo)]
        yielded += 1


# The share each thing has in the final grade (compute.DEFAULT_PILLAR_WEIGHTS); intel is fixed by the
# profile, so it does not take part in choosing a card.
_W_PIPELINE, _W_RELATIONS, _W_DECISION = 0.3, 0.3, 0.2
# What one low-power objection costs the relations proxy: it becomes a grudge.
_OBJECTION_COST = 0.03
SHORTLIST = 100


def _health_after(graph, state, card, reads, phase_limit, before_health) -> float:
    """What the pipeline pillar would score this card on the phase's own stage: the share of the
    damage the challenge did that the card wins back (`compute.pipeline_progress`). Judged on the
    card alone; the world and grudges that follow in the simulation are not predicted.

    `before_health` is the stage's health with no card, from the same evaluation."""
    from mlops_serious_game.application.graph_service.apply import apply_ops
    from mlops_serious_game.application.graph_service.phase_stage import stage_for_phase
    from mlops_serious_game.application.graph_service.view import evaluate_graph
    from mlops_serious_game.application.results_service.compute import NO_HEADROOM
    from mlops_serious_game.domain.pattern import PatternFactory

    stage = stage_for_phase(graph, phase_limit)
    if stage is None:
        return 0.0
    ops = pitch.atomic_changes_to_ops(graph, state, card)
    after = apply_ops(graph, state, ops, owner_buyin={r.stakeholder_id: r.buy_in for r in reads}).state
    evaluation = evaluate_graph(graph, after, PatternFactory.patterns, PatternFactory.order)
    post = next((sv.health for sv in evaluation.stage_graph.stages if sv.id == stage.id), 0.0) / 100.0
    headroom = 1.0 - before_health
    return post if headroom < NO_HEADROOM else max(0.0, min(1.0, (post - before_health) / headroom))


def _stage_health_now(graph, state, phase_limit) -> float:
    from mlops_serious_game.application.graph_service.phase_stage import stage_for_phase
    from mlops_serious_game.application.graph_service.view import evaluate_graph
    from mlops_serious_game.domain.pattern import PatternFactory

    stage = stage_for_phase(graph, phase_limit)
    if stage is None:
        return 1.0
    evaluation = evaluate_graph(graph, state, PatternFactory.patterns, PatternFactory.order)
    return next((sv.health for sv in evaluation.stage_graph.stages if sv.id == stage.id), 100.0) / 100.0


def _flawless_card(
    graph, state, all_intel, room, emotions, candidates, rng, budget, phase_limit, par
) -> CardSearchResult:
    """The card that leaves the best final grade, not the best room.

    The room's buy-in and the system's health pull apart: the card a room likes best is not the one
    that builds the most. Every acceptable card in the budget is read for both and scored with the
    pillar weights (pipeline, relations, decision). Cards the room vetoes are only considered when
    nothing else exists, since pushing one through costs a point and a grudge.
    """
    scored = []
    evaluated = 0
    for card in _candidate_cards(candidates, rng, budget, state):
        view = pitch.card_view(
            graph=graph, state=state, all_intel=all_intel, changes=card, room=room, emotion_values=emotions
        )
        evaluated += 1
        buy_ins = [r.buy_in for r in view.reads] or [0.0]
        scored.append((_RANK.get(view.outcome, 0), sum(buy_ins) / len(buy_ins), min(buy_ins), card, view))

    acceptable = [row for row in scored if row[0] > 0] or scored
    acceptable.sort(key=lambda row: (row[0], row[1]), reverse=True)

    par_score = _RANK.get(par, 2) / 2.0
    before_health = _stage_health_now(graph, state, phase_limit)
    best, best_value = None, None
    for rank, mean_buy_in, lowest, card, view in acceptable[:SHORTLIST]:
        objections = sum(1 for r in view.reads if r.power == "low" and (r.boundary_violated or r.buy_in < 0.3))
        decision = min(1.0, (rank / 2.0) / par_score) if par_score else 1.0
        relations = max(0.0, mean_buy_in - _OBJECTION_COST * objections)
        value = (
            _W_PIPELINE * _health_after(graph, state, card, view.reads, phase_limit, before_health)
            + _W_RELATIONS * relations
            + _W_DECISION * decision
        )
        if best_value is None or value > best_value:
            best, best_value, best_outcome, best_lowest = card, value, view.outcome, lowest
    return CardSearchResult(best, best_outcome, evaluated, round(best_lowest, 3), pool=len(acceptable))


def _best_card(graph, state, all_intel, room, emotions, candidates, rng, budget) -> CardSearchResult:
    """The strongest card in the budget: best outcome, then the highest lowest buy-in, then the
    highest average. A random acceptable card (what the other preferences pick) is not a perfect
    player's card."""
    best, best_key, evaluated = None, None, 0
    for card in _candidate_cards(candidates, rng, budget, state):
        view = pitch.card_view(
            graph=graph, state=state, all_intel=all_intel, changes=card, room=room, emotion_values=emotions
        )
        evaluated += 1
        buy_ins = [r.buy_in for r in view.reads] or [0.0]
        key = (_RANK.get(view.outcome, 0), min(buy_ins), sum(buy_ins) / len(buy_ins))
        if best_key is None or key > best_key:
            best, best_key, best_outcome = card, key, view.outcome
    return CardSearchResult(best, best_outcome, evaluated, round(best_key[1], 3), pool=1)


def search_card(
    *,
    graph: Any,
    state: Any,
    all_intel: list,
    room: list[tuple],
    emotions: dict,
    allowed: Iterable[str],
    seed: str,
    budget: int = DEFAULT_BUDGET,
    wanted_passes: int = DEFAULT_WANTED_PASSES,
    prefer: str = "pass",
    phase_limit: Optional[int] = None,
    par: str = "PASS",
) -> Optional[CardSearchResult]:
    """Picks a random card the room will not veto, preferring a clean pass.

    Uniform among the passing cards found, so repeated playtests explore different cards rather than
    always landing on the first. Falls back to a soft pass, then to the least-bad veto. Returns None
    only when there was nothing legal to slot at all.

    `prefer` ("soft" or "veto") aims lower on purpose, for a playtest profile that should land
    softer outcomes; it still falls back down the same ladder when the room has none. "best"
    maximises the room's acceptance; "flawless" maximises the final grade (see `_flawless_card`),
    which needs `phase_limit` (the phase being played) and the room's `par`.
    """
    rng = random.Random(seed)
    candidates = candidate_changes(graph, state, allowed, all_intel)
    if not candidates:
        return None
    if prefer == "flawless":
        return _flawless_card(
            graph, state, all_intel, room, emotions, candidates, rng, max(budget, BEST_BUDGET), phase_limit, par
        )
    if prefer == "best":
        return _best_card(graph, state, all_intel, room, emotions, candidates, rng, max(budget, BEST_BUDGET))

    pools: dict[str, list[tuple[list[pitch.AtomicChange], float]]] = {"PASS": [], "SOFT_PASS": [], "VETO": []}
    evaluated = 0
    for card in _candidate_cards(candidates, rng, budget, state):
        view = pitch.card_view(
            graph=graph,
            state=state,
            all_intel=all_intel,
            changes=card,
            room=room,
            emotion_values=emotions,
        )
        evaluated += 1
        lowest = min((r.buy_in for r in view.reads), default=0.0)
        pools[view.outcome if view.outcome in pools else "VETO"].append((card, lowest))
        if len(pools[_LADDER[prefer][0]]) >= wanted_passes:
            break

    for outcome in _LADDER[prefer]:
        if pools[outcome]:
            card, lowest = rng.choice(pools[outcome])
            return CardSearchResult(card, outcome, evaluated, round(lowest, 3), pool=len(pools[outcome]))

    # Nothing clean: hand back the card that came closest, and say it was a veto.
    card, lowest = max(pools["VETO"], key=lambda pair: pair[1])
    return CardSearchResult(card, "VETO", evaluated, round(lowest, 3), pool=len(pools["VETO"]))
