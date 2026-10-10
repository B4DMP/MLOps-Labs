"""The case board's rules (docs/plans/case-board.md, D1/D3/D4/D8): what the player may see and
what a guess costs. Pure over its inputs and a `BoardStore`, so tests use an in-memory store."""

from collections.abc import Collection, Iterable
from typing import Literal, Optional

from pydantic import BaseModel

from mlops_serious_game.application.case_board_service.state import BoardKey, BoardState, BoardStore
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.relations import Relation, RelationKind, eligible

ConnectCode = Literal["found", "already_found", "wrong_kind", "nothing", "not_enough_intel", "no_attempts"]
# Words the log uses for each kind (the tags the board shows are the same).
TIE_WORDS: dict[str, str] = {
    "ally": "pushing the same way", "rift": "at odds", "chain": "one depends on the other", "step": "both care about the same step",
}


class BoardPayload(BaseModel):
    found: list[Relation]
    hints: list[list[str]]
    attempts_left: int


class ConnectResult(BaseModel):
    code: ConnectCode
    relation: Optional[Relation] = None
    attempts_left: int
    events: list[GameEvent] = []


def _state(store: BoardStore, key: BoardKey, attempts: int) -> BoardState:
    return store.load(key) or BoardState(attempts_left=attempts)


def _same_pair(rel: Relation, a: str, b: str) -> bool:
    return {rel.a, rel.b} == {a, b}


def eligible_relations(relations: Iterable[Relation], held_item_ids: Collection[str]) -> list[Relation]:
    return [r for r in relations if eligible(r, held_item_ids)]


def sync_on_record(
    store: BoardStore,
    key: BoardKey,
    relations: Iterable[Relation],
    held_item_ids: Collection[str],
    attempts: int,
    names: dict[str, str],
) -> tuple[list[Relation], list[GameEvent]]:
    """Pins the threads the challenge itself puts on the record (its conflict block) once the player
    holds a verified item on each side. Free, and only ever new ones; returns them with their log events."""
    state = _state(store, key, attempts)
    fresh = [r for r in eligible_relations(relations, held_item_ids) if r.on_record and r.id not in state.found]
    if not fresh:
        return [], []
    events = []
    for rel in fresh:
        state.found.append(rel.id)
        state.hints = [p for p in state.hints if set(p) != {rel.a, rel.b}]
        events.append(GameEvent(
            step="gather", kind="thread", direction="none", cause="board.thread_on_record",
            params={"a": names.get(rel.a, rel.a), "b": names.get(rel.b, rel.b), "tie": TIE_WORDS[rel.kind]},
            refs={"relation_id": rel.id},
        ))
    store.save(key, state)
    return fresh, events


def get_board(store: BoardStore, key: BoardKey, relations: Iterable[Relation], attempts: int) -> BoardPayload:
    """Found threads in full, hinted pairs and the guesses left. Never anything unfound."""
    state = _state(store, key, attempts)
    by_id = {r.id: r for r in relations}
    return BoardPayload(
        found=[by_id[i] for i in state.found if i in by_id],
        hints=state.hints,
        attempts_left=state.attempts_left,
    )


def connect(
    store: BoardStore,
    key: BoardKey,
    relations: Iterable[Relation],
    held_item_ids: Collection[str],
    holder_of: dict[str, str],
    a: str,
    b: str,
    kind: RelationKind,
    attempts: int,
    names: dict[str, str],
) -> ConnectResult:
    """One guess that `a` and `b` are tied as `kind`. Only a wrong kind or an empty pair spends an
    attempt; a pair the player cannot yet judge, or one already found, is free.

    `holder_of` maps item id to stakeholder id, so "knows enough about both people" means a
    verified item from each. A chain matches in either drag direction.
    """
    state = _state(store, key, attempts)
    known = {holder_of[i] for i in held_item_ids if i in holder_of}
    if a == b or a not in known or b not in known:
        return ConnectResult(code="not_enough_intel", attempts_left=state.attempts_left)
    if state.attempts_left <= 0:
        return ConnectResult(code="no_attempts", attempts_left=0)

    pair = [r for r in eligible_relations(relations, held_item_ids) if _same_pair(r, a, b)]
    params = {"a": names.get(a, a), "b": names.get(b, b)}
    match = [r for r in pair if r.kind == kind]
    fresh = [r for r in match if r.id not in state.found]
    if fresh:
        rel = fresh[0]
        state.found.append(rel.id)
        state.hints = [p for p in state.hints if set(p) != {a, b}]
        store.save(key, state)
        event = GameEvent(step="gather", kind="thread", direction="up",
                          cause="board.thread_found", params={**params, "tie": TIE_WORDS[rel.kind]},
                          refs={"relation_id": rel.id})
        return ConnectResult(code="found", relation=rel, attempts_left=state.attempts_left, events=[event])
    if match:
        return ConnectResult(code="already_found", relation=match[0], attempts_left=state.attempts_left)

    state.attempts_left -= 1
    store.save(key, state)
    cause, code = ("board.thread_wrong_kind", "wrong_kind") if pair else ("board.thread_nothing", "nothing")
    event = GameEvent(step="gather", kind="thread", direction="down", magnitude="slight", cause=cause, params=params)
    return ConnectResult(code=code, attempts_left=state.attempts_left, events=[event])


def reveal_hint(
    store: BoardStore,
    key: BoardKey,
    relations: Iterable[Relation],
    held_item_ids: Collection[str],
    attempts: int,
) -> Optional[list[str]]:
    """Team Sync-Up (D8): marks one pair that has a thread the player could find, without naming
    its kind. Only pairs the player is eligible for, never one already found or hinted."""
    state = _state(store, key, attempts)
    hinted = {frozenset(p) for p in state.hints}
    for rel in sorted(eligible_relations(relations, held_item_ids), key=lambda r: (r.a, r.b, r.id)):
        pair = frozenset((rel.a, rel.b))
        if rel.id in state.found or pair in hinted:
            continue
        state.hints.append(sorted(pair))
        store.save(key, state)
        return sorted(pair)
    return None


def toggle_pencil(
    store: BoardStore,
    key: BoardKey,
    item_id: str,
    on: bool,
    held_item_ids: Collection[str],
    attempts: int,
) -> list[str]:
    """Ticks or clears a note the player has penciled in. Only a note they hold can be ticked, so the
    list never names anything they have not seen. Returns the ticked ids, in the order they were ticked."""
    state = _state(store, key, attempts)
    if on and item_id in held_item_ids and item_id not in state.penciled:
        state.penciled.append(item_id)
    elif not on and item_id in state.penciled:
        state.penciled.remove(item_id)
    else:
        return state.penciled
    store.save(key, state)
    return state.penciled
