"""Gather: engagement cards buy conversations, not batches (D49, plan 11).

A stakeholder card buys a fixed number of **turns** per target. Each turn the player picks one
option; turns not used are lost when the conversation closes. Pure over its inputs: the caller
resolves ground truth, held items and archetype state before calling in, and performs the actual
writes (storing a revealed item, verifying an archetype) from what these functions decide. Same
inputs, same options, in the same order - no `random.sample` anywhere in this module (standing
rule, plan 11).
"""

from __future__ import annotations

from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.application.graph_service.scheduler import stable_rank
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.requirement import ConfidenceType, IntelTag

_TUNING = EmotionFactory.get_pitch_tuning()

EMOTION_REFUTED = _TUNING.emotion_refuted
EMOTION_TRIAL_BALLOON_MATCH = _TUNING.emotion_trial_balloon_match
EMOTION_TRIAL_BALLOON_MISS = _TUNING.emotion_trial_balloon_miss
EMOTION_ONE_ON_ONE_MISS = _TUNING.emotion_one_on_one_miss

MAX_TESTABLE_PER_TURN = 3  # D49: "up to 3 in stable order"

GatherOptionKind = Literal["open_question", "test_hypothesis", "generic_question", "trial_balloon", "one_on_one"]


class GatherOptionSpec(BaseModel):
    """One choice on a turn's menu. `test_hypothesis` and `trial_balloon` fan out into one spec
    per candidate item / archetype, since the player picks which one to try, not just the kind."""

    option: GatherOptionKind
    available: bool
    reason: Optional[str] = None
    item_id: Optional[str] = None
    archetype: Optional[str] = None


class GatherConversation(BaseModel):
    """One open engagement-card conversation with one stakeholder target (plan 11).

    Persisted per (player, phase, challenge, card play, stakeholder) by the handler/store; this
    model only carries what a turn needs to be resolved and what the next menu needs to be built.
    """

    card_id: str
    stakeholder_id: str
    turns_left: int
    turns_used: int = 0
    tested_item_ids: list[str] = Field(default_factory=list)
    discovered_item_ids: list[str] = Field(default_factory=list)
    one_on_one_used: bool = False
    closed: bool = False

    @property
    def is_open(self) -> bool:
        return not self.closed and self.turns_left > 0


class TurnOutcome(BaseModel):
    """What one resolved turn decided. The handler performs the actual write (store an item,
    verify/rule out an archetype) from `item_id`/`archetype`/`result`, then persists the updated
    `conversation` this carries."""

    conversation: GatherConversation
    option: Literal[GatherOptionKind, "close"]
    result: Literal[
        "revealed", "nothing_left", "inferred", "refuted", "no_hypothesis", "gist",
        "archetype_matched", "archetype_ruled_out", "no_archetype_left", "already_verified",
        "one_on_one_hit", "one_on_one_miss", "one_on_one_unavailable", "rejected", "closed",
    ]
    item_id: Optional[str] = None
    archetype: Optional[str] = None
    emotion_delta: float = 0.0
    rejected: Optional[str] = None
    events: list[GameEvent] = Field(default_factory=list)


def _stable_order(seed: str, items: list) -> list:
    """Deterministic order: same seed, same items, same order every time (no `random.sample`)."""
    return sorted(items, key=lambda i: stable_rank(seed, i.id))


def _tag_value(tag) -> str:
    return str(getattr(tag, "value", tag))


def _by_tag(items: list, allowed_types: list[str]) -> list:
    if not allowed_types:
        return list(items)
    return [i for i in items if _tag_value(i.type) in allowed_types]


def undiscovered_pool(pool: list, known_ids: set[str], allowed_types: list[str]) -> list:
    """Ground-truth items for this stakeholder the player has not yet found, tag-filtered
    (eng_2's "open questions reveal Boundaries only")."""
    return _by_tag([r for r in pool if r.id not in known_ids], allowed_types)


def testable_items(held: list, st_id: str, allowed_types: list[str], tested_ids: set[str]) -> list:
    """Held, unconfirmed notes on this stakeholder, filtered by the tag the player filed them
    under (never the true one - passing a note back must not give a mis-filed tag away)."""
    return [
        i for i in held
        if i.stakeholder_id == st_id
        and _tag_value(i.intel_type).lower() == ConfidenceType.UNCONFIRMED.value
        and i.id not in tested_ids
        and (not allowed_types or _tag_value(i.categorized_type) in allowed_types)
    ]


def one_on_one_pair(held: list, st_id: str) -> Optional[tuple[Any, Any]]:
    """A held Boundary plus a held Trade-off or Driver on this stakeholder, if the player has
    both - what the Deep Dive's 1-on-1 template needs to be on offer at all."""
    boundary = next((i for i in held if i.stakeholder_id == st_id and i.type == IntelTag.BOUNDARY), None)
    other = next(
        (i for i in held if i.stakeholder_id == st_id and i.type in (IntelTag.TRADE_OFF, IntelTag.DRIVER)),
        None,
    )
    return (boundary, other) if boundary and other else None


def gather_options_for(
    conversation: GatherConversation,
    held: list,
    pool: list,
    allowed_types: list[str],
    archetype_verified: bool,
    ruled_out_archetypes: list[str],
    all_archetype_names: list[str],
    seed: str,
    one_on_one_eligible: bool = False,
) -> list[GatherOptionSpec]:
    """The turn menu for one target, given the conversation so far."""
    opts: list[GatherOptionSpec] = []

    known_ids = {i.id for i in held} | set(conversation.discovered_item_ids)
    undiscovered = undiscovered_pool(pool, known_ids, allowed_types)
    if undiscovered:
        opts.append(GatherOptionSpec(option="open_question", available=True))
    else:
        opts.append(GatherOptionSpec(
            option="open_question", available=False,
            reason="nothing left to ask about, in this card's tags",
        ))

    testable = _stable_order(
        f"{seed}|test", testable_items(held, conversation.stakeholder_id, allowed_types, set(conversation.tested_item_ids))
    )[:MAX_TESTABLE_PER_TURN]
    if testable:
        opts.extend(GatherOptionSpec(option="test_hypothesis", available=True, item_id=item.id) for item in testable)
    else:
        opts.append(GatherOptionSpec(
            option="test_hypothesis", available=False, reason="no unconfirmed note on them left to test",
        ))

    opts.append(GatherOptionSpec(option="generic_question", available=True))

    if archetype_verified:
        opts.append(GatherOptionSpec(option="trial_balloon", available=False, reason="their profile is already verified"))
    else:
        remaining = [a for a in all_archetype_names if a not in ruled_out_archetypes]
        if remaining:
            opts.extend(GatherOptionSpec(option="trial_balloon", available=True, archetype=a) for a in remaining)
        else:
            opts.append(GatherOptionSpec(option="trial_balloon", available=False, reason="every archetype has been ruled out"))

    if one_on_one_eligible and not conversation.one_on_one_used:
        opts.append(GatherOptionSpec(option="one_on_one", available=True))
    else:
        opts.append(GatherOptionSpec(
            option="one_on_one", available=False,
            reason="already used this conversation" if conversation.one_on_one_used
            else "needs a Boundary and a Trade-off or Driver held on them",
        ))

    return opts


def _spend_turn(conversation: GatherConversation) -> GatherConversation:
    return conversation.model_copy(update={
        "turns_left": conversation.turns_left - 1, "turns_used": conversation.turns_used + 1,
    })


def _reject(conversation: GatherConversation, option: GatherOptionKind, reason: str) -> TurnOutcome:
    return TurnOutcome(conversation=conversation, option=option, result="rejected", rejected=reason)


def resolve_open_question(
    conversation: GatherConversation, pool: list, known_ids: set[str], allowed_types: list[str],
    seed: str, stakeholder_name: str,
) -> TurnOutcome:
    """Reveals the next undiscovered note in stable order - Verified, as today."""
    if not conversation.is_open:
        return _reject(conversation, "open_question", "no turns left in this conversation")
    ordered = _stable_order(f"{seed}|reveal", undiscovered_pool(pool, known_ids, allowed_types))
    if not ordered:
        return TurnOutcome(conversation=_spend_turn(conversation), option="open_question", result="nothing_left")
    item = ordered[0]
    updated = _spend_turn(conversation).model_copy(
        update={"discovered_item_ids": conversation.discovered_item_ids + [item.id]}
    )
    event = GameEvent(
        step="gather", kind="intel", subject_id=conversation.stakeholder_id, direction="up", magnitude="clear",
        cause="intel.revealed", params={"st": stakeholder_name}, refs={"item_id": item.id},
    )
    return TurnOutcome(conversation=updated, option="open_question", result="revealed", item_id=item.id, events=[event])


def resolve_test_hypothesis(
    conversation: GatherConversation, held_by_id: dict[str, Any], item_id: str, stakeholder_name: str,
) -> TurnOutcome:
    """Tag right: Inferred, they add a detail. Tag wrong: Refuted, trust down, free re-tag."""
    if not conversation.is_open:
        return _reject(conversation, "test_hypothesis", "no turns left in this conversation")
    item = held_by_id.get(item_id)
    if item is None or item.id in conversation.tested_item_ids:
        return _reject(conversation, "test_hypothesis", "pick an unconfirmed note on them you have not tested yet")
    updated = _spend_turn(conversation).model_copy(
        update={"tested_item_ids": conversation.tested_item_ids + [item.id]}
    )
    correct = item.categorized_type == item.type
    if correct:
        event = GameEvent(
            step="gather", kind="intel", subject_id=conversation.stakeholder_id, direction="up", magnitude="clear",
            cause="intel.inferred", params={"st": stakeholder_name}, refs={"item_id": item.id},
        )
        return TurnOutcome(conversation=updated, option="test_hypothesis", result="inferred", item_id=item.id, events=[event])
    event = GameEvent(
        step="gather", kind="intel", subject_id=conversation.stakeholder_id, direction="down", magnitude="slight",
        cause="intel.refuted", params={"st": stakeholder_name}, refs={"item_id": item.id},
    )
    return TurnOutcome(
        conversation=updated, option="test_hypothesis", result="refuted", item_id=item.id,
        emotion_delta=EMOTION_REFUTED, events=[event],
    )


def resolve_generic_question(
    conversation: GatherConversation, pool: list, known_ids: set[str], seed: str, stakeholder_name: str,
    gist_of: Callable[[Any], str] = lambda item: "",
) -> TurnOutcome:
    """The gist of their next undiscovered note, any tag. Nothing enters the dossier.

    `gist_of` resolves the picked item to its display text (D52): the authored gist when there
    is one, a template from the metric name otherwise - the caller owns that lookup (it needs
    `RequirementFactory`/`MetricFactory`, which this pure module does not import).
    """
    if not conversation.is_open:
        return _reject(conversation, "generic_question", "no turns left in this conversation")
    ordered = _stable_order(f"{seed}|gist", undiscovered_pool(pool, known_ids, []))
    updated = _spend_turn(conversation)
    if not ordered:
        return TurnOutcome(conversation=updated, option="generic_question", result="nothing_left")
    item = ordered[0]
    event = GameEvent(
        step="gather", kind="intel", subject_id=conversation.stakeholder_id, direction="none",
        cause="intel.gist_heard", params={"st": stakeholder_name, "gist": gist_of(item)}, refs={"item_id": item.id},
    )
    return TurnOutcome(conversation=updated, option="generic_question", result="gist", item_id=item.id, events=[event])


def resolve_trial_balloon(
    conversation: GatherConversation, guessed_archetype: str, true_archetype: str, stakeholder_name: str,
) -> TurnOutcome:
    """A match verifies the tag. A miss rules that archetype out (struck through in the re-tag
    picker) and never shows the true one."""
    if not conversation.is_open:
        return _reject(conversation, "trial_balloon", "no turns left in this conversation")
    updated = _spend_turn(conversation)
    if guessed_archetype == true_archetype:
        event = GameEvent(
            step="gather", kind="archetype", subject_id=conversation.stakeholder_id, direction="up", magnitude="clear",
            cause="archetype.matched", params={"st": stakeholder_name},
        )
        return TurnOutcome(
            conversation=updated, option="trial_balloon", result="archetype_matched",
            archetype=guessed_archetype, emotion_delta=EMOTION_TRIAL_BALLOON_MATCH, events=[event],
        )
    event = GameEvent(
        step="gather", kind="archetype", subject_id=conversation.stakeholder_id, direction="down", magnitude="slight",
        cause="archetype.ruled_out", params={"st": stakeholder_name, "archetype": guessed_archetype},
    )
    return TurnOutcome(
        conversation=updated, option="trial_balloon", result="archetype_ruled_out",
        archetype=guessed_archetype, emotion_delta=EMOTION_TRIAL_BALLOON_MISS, events=[event],
    )


def resolve_one_on_one(
    conversation: GatherConversation, boundary_item: Any, other_item: Any, stakeholder_name: str,
) -> TurnOutcome:
    """"I understand [Boundary]. If we guarantee [Trade-off/Driver], would that work for you?"

    A right pair - the player correctly tagged both - verifies both. A wrong pair is a trust hit;
    Deep Dive only, and only once per conversation.
    """
    if not conversation.is_open:
        return _reject(conversation, "one_on_one", "no turns left in this conversation")
    if conversation.one_on_one_used:
        return _reject(conversation, "one_on_one", "already used this conversation")
    updated = _spend_turn(conversation).model_copy(update={"one_on_one_used": True})
    right = boundary_item.categorized_type == boundary_item.type and other_item.categorized_type == other_item.type
    if right:
        event = GameEvent(
            step="gather", kind="intel", subject_id=conversation.stakeholder_id, direction="up", magnitude="clear",
            cause="intel.one_on_one_hit", params={"st": stakeholder_name},
            refs={"item_ids": [boundary_item.id, other_item.id]},
        )
        return TurnOutcome(
            conversation=updated, option="one_on_one", result="one_on_one_hit",
            item_id=boundary_item.id, events=[event],
        )
    event = GameEvent(
        step="gather", kind="emotion", subject_id=conversation.stakeholder_id, direction="down", magnitude="slight",
        cause="emotion.one_on_one_miss", params={"st": stakeholder_name},
    )
    return TurnOutcome(
        conversation=updated, option="one_on_one", result="one_on_one_miss",
        emotion_delta=EMOTION_ONE_ON_ONE_MISS, events=[event],
    )


def close_conversation(conversation: GatherConversation, stakeholder_name: str) -> TurnOutcome:
    """Ends the conversation; unused turns are lost (D49)."""
    updated = conversation.model_copy(update={"closed": True})
    events = []
    if updated.turns_left > 0:
        events.append(GameEvent(
            step="gather", kind="card", subject_id=conversation.stakeholder_id,
            cause="card.turn_lost", params={"st": stakeholder_name, "n": str(updated.turns_left)},
        ))
    return TurnOutcome(conversation=updated, option="close", result="closed", events=events)
