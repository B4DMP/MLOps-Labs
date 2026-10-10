"""The case board's rules: results of a guess, what it costs, and what is never revealed
(docs/plans/case-board.md, D1/D4/D8). Uses an in-memory store, so no Postgres."""

from mlops_serious_game.application.case_board_service.service import (
    connect, get_board, reveal_hint, sync_on_record, toggle_pencil,
)
from mlops_serious_game.application.case_board_service.state import BoardKey, BoardState
from mlops_serious_game.domain.relations import Relation

KEY = BoardKey(user_id=1, run_index=1, phase_index=1, challenge_index=1)
NAMES = {"amy": "Amy", "bob": "Bob", "cat": "Cat"}
HOLDER = {"i1": "amy", "i2": "bob", "i3": "cat"}


class MemoryStore:
    def __init__(self):
        self.rows: dict[BoardKey, BoardState] = {}

    def load(self, key):
        row = self.rows.get(key)
        return row.model_copy(deep=True) if row else None

    def save(self, key, state):
        self.rows[key] = state.model_copy(deep=True)


def rel(kind, a, b, a_ids, b_ids, target="data.validation"):
    return Relation(id=f"{kind}-{a}-{b}", kind=kind, a=a, b=b, target=target, a_item_ids=a_ids, b_item_ids=b_ids)


ALLY = rel("ally", "amy", "bob", ["i1"], ["i2"])
RIFT = rel("rift", "amy", "cat", ["i1"], ["i3"])
CHAIN = rel("chain", "amy", "bob", ["i1"], ["i2"], target="e.validate_version")
ALL = [ALLY, RIFT, CHAIN]


def guess(store, a, b, kind, held=("i1", "i2", "i3"), rels=ALL, attempts=3):
    return connect(store, KEY, rels, set(held), HOLDER, a, b, kind, attempts, NAMES)


def test_right_kind_is_found_and_costs_nothing():
    store = MemoryStore()
    result = guess(store, "amy", "bob", "ally")
    assert result.code == "found" and result.relation.id == ALLY.id and result.attempts_left == 3
    assert result.events[0].cause == "board.thread_found" and result.events[0].kind == "thread"
    assert [r.id for r in get_board(store, KEY, ALL, 3).found] == [ALLY.id]


def test_wrong_kind_and_empty_pair_each_spend_one_attempt():
    store = MemoryStore()
    wrong = guess(store, "amy", "bob", "rift")
    assert wrong.code == "wrong_kind" and wrong.attempts_left == 2 and wrong.relation is None
    assert wrong.events[0].cause == "board.thread_wrong_kind"
    nothing = guess(store, "bob", "cat", "ally")
    assert nothing.code == "nothing" and nothing.attempts_left == 1
    assert nothing.events[0].cause == "board.thread_nothing"


def test_not_enough_intel_is_free_and_leaks_nothing():
    store = MemoryStore()
    result = guess(store, "amy", "bob", "ally", held=("i1",))
    assert result.code == "not_enough_intel" and result.attempts_left == 3 and result.events == []
    # A real thread the player has no verified items for looks exactly like a pair with nothing.
    assert guess(store, "amy", "cat", "rift", held=("i1",)).code == "not_enough_intel"
    assert store.rows == {}


def test_a_thread_needs_a_verified_item_on_each_side():
    # Both people are known, but the items held are not the ones behind the thread.
    thin = rel("ally", "amy", "bob", ["x1"], ["x2"])
    assert guess(MemoryStore(), "amy", "bob", "ally", rels=[thin]).code == "nothing"


def test_no_attempts_left_stops_wrong_guesses_but_not_reading():
    store = MemoryStore()
    store.save(KEY, BoardState(attempts_left=0))
    assert guess(store, "amy", "bob", "ally").code == "no_attempts"
    assert get_board(store, KEY, ALL, 3).attempts_left == 0


def test_found_again_is_free_and_chain_matches_either_drag_direction():
    store = MemoryStore()
    assert guess(store, "bob", "amy", "chain").code == "found"
    again = guess(store, "amy", "bob", "chain")
    assert again.code == "already_found" and again.attempts_left == 3


def test_board_shows_only_found_threads():
    store = MemoryStore()
    guess(store, "amy", "bob", "ally")
    payload = get_board(store, KEY, ALL, 3)
    assert [r.id for r in payload.found] == [ALLY.id]
    assert RIFT.id not in payload.model_dump_json() and CHAIN.id not in payload.model_dump_json()


def test_hint_names_a_pair_never_a_kind_and_only_for_eligible_pairs():
    store = MemoryStore()
    pair = reveal_hint(store, KEY, ALL, {"i1", "i2"}, 3)
    assert pair == ["amy", "bob"]
    payload = get_board(store, KEY, ALL, 3)
    assert payload.hints == [["amy", "bob"]]
    assert "ally" not in payload.model_dump_json() and "chain" not in payload.model_dump_json()
    # The amy/cat rift is not hintable without cat's item, and the pair already hinted is not repeated.
    assert reveal_hint(store, KEY, ALL, {"i1", "i2"}, 3) is None


def test_finding_a_thread_clears_its_hint():
    store = MemoryStore()
    reveal_hint(store, KEY, [ALLY], {"i1", "i2"}, 3)
    guess(store, "amy", "bob", "ally", rels=[ALLY])
    assert get_board(store, KEY, [ALLY], 3).hints == []


def test_board_get_is_read_only_and_board_connect_is_not():
    from mlops_serious_game.infrastructure.websocket.router import EVENT_REGISTRY, READ_ONLY_EVENTS

    assert "board:get" in READ_ONLY_EVENTS and "board:get" in EVENT_REGISTRY
    assert "board:connect" in EVENT_REGISTRY and "board:connect" not in READ_ONLY_EVENTS


ON_RECORD = rel("rift", "amy", "cat", ["i1"], ["i3"]).model_copy(update={"on_record": True})


def test_on_record_thread_is_pinned_for_free_once_both_sides_are_held():
    store = MemoryStore()
    assert sync_on_record(store, KEY, [ON_RECORD], {"i1"}, 5, NAMES) == ([], [])  # cat's side not held yet
    pinned, events = sync_on_record(store, KEY, [ON_RECORD, ALLY], {"i1", "i2", "i3"}, 5, NAMES)
    assert [r.id for r in pinned] == [ON_RECORD.id]  # the ally thread is not on the record
    assert events[0].cause == "board.thread_on_record"
    board = get_board(store, KEY, [ON_RECORD, ALLY], 5)
    assert [r.id for r in board.found] == [ON_RECORD.id] and board.attempts_left == 5
    assert sync_on_record(store, KEY, [ON_RECORD], {"i1", "i3"}, 5, NAMES) == ([], [])  # only once


def test_pinning_an_on_record_thread_clears_its_hint():
    store = MemoryStore()
    store.save(KEY, BoardState(attempts_left=5, hints=[["amy", "cat"]]))
    sync_on_record(store, KEY, [ON_RECORD], {"i1", "i3"}, 5, NAMES)
    assert get_board(store, KEY, [ON_RECORD], 5).hints == []


def test_debug_answer_key_lists_every_thread_and_what_is_missing():
    from mlops_serious_game.application.case_board_service.context import BoardContext
    from mlops_serious_game.infrastructure.websocket.handlers.case_board_handler import _answer_key

    ctx = BoardContext(key=KEY, phase_id=1, challenge_id=1, visible=True, people=["amy", "bob", "cat"],
                       relations=[ALLY, RIFT], held_ids={"i1", "i2"}, names=NAMES)
    key = {row["id"]: row for row in _answer_key(ctx, {ALLY.id})}
    assert key[ALLY.id]["found"] and key[ALLY.id]["eligible"] and key[ALLY.id]["lacking"] == []
    assert not key[RIFT.id]["found"] and not key[RIFT.id]["eligible"] and key[RIFT.id]["lacking"] == ["Cat"]


def test_pencilling_a_note_in_and_out_is_remembered_and_only_for_held_notes():
    store = MemoryStore()
    held = {"i1", "i2"}
    assert toggle_pencil(store, KEY, "i1", True, held, 5) == ["i1"]
    assert toggle_pencil(store, KEY, "i2", True, held, 5) == ["i1", "i2"]
    assert toggle_pencil(store, KEY, "i1", True, held, 5) == ["i1", "i2"]  # no duplicate
    assert toggle_pencil(store, KEY, "i9", True, held, 5) == ["i1", "i2"]  # not a note they hold
    assert toggle_pencil(store, KEY, "i1", False, held, 5) == ["i2"]
    assert store.load(KEY).penciled == ["i2"] and store.load(KEY).attempts_left == 5  # guesses untouched


def test_board_pencil_is_an_action_not_a_read():
    from mlops_serious_game.infrastructure.websocket.router import EVENT_REGISTRY, READ_ONLY_EVENTS

    assert "board:pencil" in EVENT_REGISTRY and "board:pencil" not in READ_ONLY_EVENTS
