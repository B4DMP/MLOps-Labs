# Case board: content pass

Status: first pass done for rooms 110, 111 and 118 (hand-authored, in `gameConfig`). Findable rifts are
not done and need a design decision (below).

The board is only worth having if every room gives the player something to find beyond the free
on-record rift (the challenge's own `conflict` block). What a room offers is decided entirely by its
intel items, so this is a content problem, not a UI one.

## What the content can say

Threads are derived at read time from the items (`domain/relations.py`, see `case-board.md` D2):

| thread | needs in the items |
|---|---|
| ally | two people with a floor on the same (target, axis), or a ceiling on it (both accept the same limit) |
| shared step | two people with a stance on the same component or edge, on different axes or otherwise neither agreeing nor clashing |
| chain | one person's automation floor on a target that an upstream step, owned or held by another, cannot deliver |
| rift | one person's floor above another's ceiling on the same (target, axis), conflicting trigger or attribute values, or the conflict block |

A pair is never both allies and at odds: a rift wins, and what such a pair agrees on becomes a shared
step. Chains are rare outside the deployment stage, because most pipeline edges carry slack: an upstream
ceiling has to sit below the floor minus that slack, which is only possible where edges have none
(deploy) or where an upstream step is capped to broken or absent.

## The bar (enforced)

For every room with a board (3 or more people, not the demo), not counting the on-record rift:
at least 3 threads to find, tying at least 2 different pairs, of at least 2 kinds.

- `tests/test_relations.py::test_real_content_gives_every_playable_room_enough_to_find` checks the
  shipped content.
- `content_gen validate` (`gates.py`, gate 8f) checks any content a run produces, so a regeneration that
  thins a room is an error, not a surprise. `tests/test_content_gen.py::test_board_gate_flags_a_room_with_too_little_to_find`
  proves the gate fires.

## Where the rooms stand

Findable threads per room (ally, rift, chain, step):

| room | before the pass | after |
|---|---|---|
| 110 committed pallets | 3 (3 allies, one kind) | 5 (3 ally, 2 step) |
| 111 cost crisis drift gap | 2 (2 steps, one kind) | 4 (1 ally, 3 step) |
| 112 | 4 | 4 |
| 114 | 5 | 5 |
| 115 | 6 | 6 |
| 116 | 3 | 3 |
| 117 | 3 | 3 |
| 118 shadow deployment contract | 3 (3 chains, one kind) | 5 (1 ally, 3 chain, 1 step) |
| 119 | 4 | 4 |
| 120 | 10 | 10 |

The "before" column already has the exclusivity rule applied (it removed allies from rifted pairs).
116 and 117 pass the bar with no margin: one lost item and they fail.

## What this pass added

Five Drivers, each with its source artifact (`OfflineIntelArtifacts.json`) and objection line
(`MlopsObjections.json`), written by hand in the existing voice and checked by `content_gen validate`:

| room | stakeholder | asks for | makes |
|---|---|---|---|
| 110 | Alex | KPI definition signed off (governance) | shared steps with Emilia and Ruth, who both accept manual only on it |
| 111 | Monica | alert to retraining hand-over automated | ally with Emilia, who asks for the same |
| 111 | Reuben | observability signals reviewed (governance) | shared step with Emilia, who accepts a cap on its automation |
| 118 | Reuben | serving step signed off (governance) | ally with Emilia, who holds the same line on serving |
| 118 | Ruth | serving to gateway hand-over audited (governance) | shared step with Alex, who accepts a cap on that hand-over |

All five are Drivers, so the stance mix stays inside its bounds. They add per-stakeholder stance counts
above the room's quota in 5 places and nothing else; those are warnings today (`shape_blocks` is off).

### Caveat: these items live only in `gameConfig`

`content_gen assemble` rebuilds every `gen_` requirement from the ledger (see
[content-gen-ledger-drift.md](content-gen-ledger-drift.md)), so a full assemble would delete these five.
Until they are in the ledger, do not run it for real. To make them permanent: add them to
`work/out` as approved `items`, `artifacts` and `objections` outputs for their templates (or freeze the
stages once they match), then check `assemble --dry-run` shows no removals.

## Findable rifts: needs a decision

No room has a findable rift, and the content stage is built so that none can appear. The items stage
rejects any Driver that asks for more than another stakeholder's Trade-off accepts
(`foreclosed_compromises`) and any stakeholder whose own items undo each other (`self_contradictions`).
Together that makes the conflict block the only place two people are set against each other, which is
the design, not an oversight: every room must stay passable without a veto.

Options, cheapest first:

1. **Leave it.** One rift per room, free, on the record. The board then teaches rifts once and spends
   the rest of the game on allies, shared steps and chains. No work.
2. **One pull per room.** The items stage authors one Boundary with an upper limit on a target (a hard
   ceiling) and one other person's Driver that asks above it. Neither is caught by
   `foreclosed_compromises` (it only counts Trade-offs and the soft conflict), and the room stays
   passable because the Driver can be left unmet at the price of a soft objection. Needs: a prompt
   paragraph and a shape gate in `stages/items.py`, a gate in `gates.py` that the pair exists, and
   regeneration of the items, artifacts, objections and gists stages for every room (about 14 items a
   room, all rooms). This is the real cost: it also replaces the hand-written items above unless they
   are imported into the ledger first.
3. **A second conflict block per challenge.** A schema and scoring change. Not recommended.

Recommendation: option 1 until a playtest says players want more rifts, then option 2. Rifts are the
thread with the most to teach, but they are also the one whose effect (a compromise pair) only matters
in rooms where a Trade-off can settle it.

## Rerun checklist after any content change

```bash
docker compose exec api python -m pytest tests/test_relations.py tests/test_content_gen.py -q
docker exec game-api sh -c "cd /app/tools && python -m content_gen --scope tier1 validate"
```
