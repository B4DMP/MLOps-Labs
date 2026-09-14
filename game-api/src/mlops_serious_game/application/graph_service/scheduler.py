"""Challenge selection from graph state. Deterministic: the same graph, history and seed always
pick the same challenge, so runs can be reproduced and debugged."""

import hashlib
from typing import Optional

from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.graph_predicates import PredicateContext, evaluate
from mlops_serious_game.domain.Phase import Phase


def stable_rank(seed: str, template_id: str) -> int:
    return int(hashlib.sha256(f"{seed}|{template_id}".encode()).hexdigest()[:12], 16)


def eligible(challenge: Challenge, ctx: PredicateContext, played: set[str]) -> bool:
    if challenge.template_id in played and not challenge.repeatable:
        return False
    return evaluate(challenge.preconditions, ctx).value and not evaluate(challenge.excluded_if, ctx).value


def select_in_phase(phase: Phase, ctx: PredicateContext, played: set[str], seed: str) -> Optional[Challenge]:
    """Highest priority eligible non-fallback template; the fallback when none qualifies.
    A retired challenge is never dealt, fallback or not; only kept in config for its data."""
    pool = [c for c in phase.challenges if not c.fallback and not c.retired and eligible(c, ctx, played)]
    if pool:
        return max(pool, key=lambda c: (c.priority, stable_rank(seed, c.template_id)))
    for c in phase.challenges:
        if c.fallback and not c.retired and (c.template_id not in played or c.repeatable):
            return c
    return None


def next_challenge(
    phases: list[Phase], current_phase_id: int, played: set[str], ctx: PredicateContext, seed: str
) -> Optional[Challenge]:
    """Stays in the current phase until its quota is played, then moves on. None ends the game."""
    for phase in phases:
        if phase.id < current_phase_id:
            continue
        played_here = sum(1 for c in phase.challenges if c.template_id in played)
        if played_here >= phase.challenge_quota:
            continue
        pick = select_in_phase(phase, ctx, played, seed)
        if pick is not None:
            return pick
    return None


def reachable_templates(
    phase: Phase, contexts: list[PredicateContext], seeds: list[str]
) -> set[str]:
    """Templates a fresh player can be dealt first in this phase, across sampled graph states.
    Content gate: a phase that only ever reaches its fallback feels static."""
    reached: set[str] = set()
    for ctx in contexts:
        for seed in seeds:
            pick = select_in_phase(phase, ctx, set(), seed)
            if pick is not None:
                reached.add(pick.template_id)
    return reached
