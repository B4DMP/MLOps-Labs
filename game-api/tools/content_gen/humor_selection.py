"""Deterministic selection of which artifacts get a humor pass next, so scaling the joke
pass never redoes work already done and never overshoots how many jokes we want in flight
at once.

Never true-random: the same (seed, ratio) always selects the same set, so re-running the
selector is a no-op, and bumping the ratio only adds to what's already selected instead of
re-rolling everything. Selection unit is the challenge - a coin flip must land on the whole
challenge, never per artifact (guardrail: randomize per challenge, never per utterance, so a
brief and both its stakeholders' artifacts move as one unit; otherwise a coin-flip per line
could joke one side and leave the other flat, recreating the bias problem). Within a selected
challenge, `per_challenge_cap` bounds how many of its artifacts actually get touched, picked
by sorting on item_id so the pick is reproducible without its own random draw.
"""
import hashlib

# Mirrors the technique-5 (single-voice) rows of the archetype catalog in
# game-ui/src/components/dev/humor-memo/WorkedExamples.tsx - keep in sync by hand; there is no
# build-time link between the two. Technique-6 (garnish/brief) devices aren't here: all 11
# briefs are already done, and a future brief redo should still hand-pick from that list, since
# a brief only has one frame sentence to work with and a bad assignment has nowhere to fall back
# to. Artifacts have the volume (106) that makes assignment worth it.
# "Institutional euphemism" and "Institutional metaphor transplant" were both retired: they
# only land if the reader already recognizes an outside register (corporate-speak, a courtroom,
# a sports replay booth) as the thing being satirized. For an audience of MLOps novices rather
# than seasoned practitioners, that outside literacy can't be assumed, so both just read as more
# unfamiliar jargon stacked on unfamiliar jargon, obscuring the fact instead of sharpening it
# (guardrail: no device may require outside professional/cultural literacy the player can't be
# assumed to have).
# "Undetectable falsehood in a plausible dataset" was retired too, for a different reason: unlike
# every other device here, its own concept supplies no comic mechanism - "there's an error and
# you'll never find it" is unease, not a joke, until something else genuinely funny gets bolted
# on. That made it structurally prone to landing as an accurate, dry risk statement rather than
# a joke (guardrail: a device must supply its own irony/absurdity/anthropomorphism, not just
# describe an epistemic problem accurately). Replaced with "A reviewer who is also the author".
ARTIFACT_ARCHETYPES = [
    "Retroactively-satisfiable criterion",
    "Silence mistaken for testimony",
    "Recursive bureaucracy",
    "Personification",
    "A health check that asks the wrong question",
    "A gap left idling with a pet's patience",
    "A reviewer who is also the author",
]


def stable_fraction(key: str, seed: str) -> float:
    """A deterministic pseudo-uniform value in [0, 1) for (seed, key)."""
    digest = hashlib.sha256(f"{seed}:{key}".encode()).hexdigest()
    return int(digest[:8], 16) / 0x100000000


def assign_archetypes(
    new_item_ids: list[str], already_assigned_count: int, seed: str, pool: list[str] = ARTIFACT_ARCHETYPES,
) -> dict[str, str]:
    """Assigns a device to each of `new_item_ids` ONLY - never recomputes an existing
    assignment. `already_assigned_count` is how many artifacts already carry a persisted
    `humor_archetype` (the caller counts this by reading the artifact files, not from any
    separate state file), and is the rotation's cursor: the next artifact continues the
    round-robin from there instead of restarting at pool[0] every batch, which is what keeps
    the rotation even over many small batches instead of overusing whichever device sits first.

    Once assigned, WRITE the result back into that artifact's own record immediately - this
    function must never be called again for an id that already has one, and never re-derives
    an existing assignment from a recomputed global ordering (that's what silently reassigns
    already-in-progress work whenever the item set changes size, the actual bug in the first
    version of this function).

    `new_item_ids` are seed-hash-sorted before assigning (not alphabetically) so a batch of
    artifacts from the same challenge, which share an id prefix and would otherwise sort
    adjacently, don't land on a contiguous run of the same few devices."""
    ordered = sorted(new_item_ids, key=lambda item_id: hashlib.sha256(f"{seed}:{item_id}".encode()).hexdigest())
    return {item_id: pool[(already_assigned_count + i) % len(pool)] for i, item_id in enumerate(ordered)}


def plan_selection(artifacts: list[dict], seed: str, ratio: float, per_challenge_cap: int) -> list[str]:
    """artifacts: [{"item_id": str, "challenge": str, "humor_status": "unselected"|"selected"|"done"}].
    Returns item_ids to mark "selected" this pass. Never touches anything already
    "selected" or "done" - safe to call repeatedly as more artifacts get approved over time."""
    by_challenge: dict[str, list[dict]] = {}
    for art in artifacts:
        by_challenge.setdefault(art["challenge"], []).append(art)

    chosen: list[str] = []
    for challenge, group in by_challenge.items():
        if stable_fraction(challenge, seed) >= ratio:
            continue
        already = sum(1 for a in group if a["humor_status"] in ("selected", "done"))
        remaining_cap = per_challenge_cap - already
        if remaining_cap <= 0:
            continue
        candidates = sorted(
            (a for a in group if a["humor_status"] == "unselected"),
            key=lambda a: a["item_id"],
        )
        chosen.extend(a["item_id"] for a in candidates[:remaining_cap])
    return chosen
