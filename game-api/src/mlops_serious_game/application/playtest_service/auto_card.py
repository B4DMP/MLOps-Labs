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
from mlops_serious_game.domain.requirement import item_target_and_level

# How many candidate cards to evaluate at most, and how many passing ones to collect before stopping.
DEFAULT_BUDGET = 400
DEFAULT_WANTED_PASSES = 25

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
    knowledge: Any,
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
    seen: set[tuple[str, int]] = set()

    def consider(target: Optional[str], level: Optional[int]) -> None:
        if not target or level is None or target not in allowed_set or not graph.is_target(target):
            return
        if knowledge is not None and knowledge.state_of(target, state) == "unknown":
            return
        if level <= state.level(target) or level not in graph.allowed_levels(target):
            return
        if (target, level) in seen:
            return
        seen.add((target, level))
        candidates.append(pitch.AtomicChange(target=target, kind="raise_to", value=level))

    for item in all_intel:
        target, level = item_target_and_level(item)
        consider(target, level)

    for target in sorted(allowed_set):
        if not graph.is_target(target):
            continue
        higher = [level for level in graph.allowed_levels(target) if level > state.level(target)]
        if higher:
            consider(target, min(higher))
    return candidates


def _candidate_cards(
    candidates: list[pitch.AtomicChange], rng: random.Random, budget: int
) -> Iterable[list[pitch.AtomicChange]]:
    """Cards to try: every single change first (cheap, and often enough), then random pairs and
    triples until the budget runs out."""
    yielded = 0
    for change in candidates:
        if yielded >= budget:
            return
        yield [change]
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


def search_card(
    *,
    graph: Any,
    state: Any,
    knowledge: Any,
    all_intel: list,
    room: list[tuple],
    emotions: dict,
    allowed: Iterable[str],
    seed: str,
    budget: int = DEFAULT_BUDGET,
    wanted_passes: int = DEFAULT_WANTED_PASSES,
) -> Optional[CardSearchResult]:
    """Picks a random card the room will not veto, preferring a clean pass.

    Uniform among the passing cards found, so repeated playtests explore different cards rather than
    always landing on the first. Falls back to a soft pass, then to the least-bad veto. Returns None
    only when there was nothing legal to slot at all.
    """
    rng = random.Random(seed)
    candidates = candidate_changes(graph, state, knowledge, allowed, all_intel)
    if not candidates:
        return None

    pools: dict[str, list[tuple[list[pitch.AtomicChange], float]]] = {"PASS": [], "SOFT_PASS": [], "VETO": []}
    evaluated = 0
    for card in _candidate_cards(candidates, rng, budget):
        view = pitch.card_view(
            graph=graph,
            state=state,
            all_intel=all_intel,
            changes=card,
            room=room,
            emotion_values=emotions,
            knowledge=knowledge,
        )
        evaluated += 1
        lowest = min((r.buy_in for r in view.reads), default=0.0)
        pools[view.outcome if view.outcome in pools else "VETO"].append((card, lowest))
        if len(pools["PASS"]) >= wanted_passes:
            break

    for outcome in ("PASS", "SOFT_PASS"):
        if pools[outcome]:
            card, lowest = rng.choice(pools[outcome])
            return CardSearchResult(card, outcome, evaluated, round(lowest, 3), pool=len(pools[outcome]))

    # Nothing clean: hand back the card that came closest, and say it was a veto.
    card, lowest = max(pools["VETO"], key=lambda pair: pair[1])
    return CardSearchResult(card, "VETO", evaluated, round(lowest, 3), pool=len(pools["VETO"]))
