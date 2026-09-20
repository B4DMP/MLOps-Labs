# Costing the size of a raise

Status: **options, nothing implemented.**

## The gap

Nothing stops a player proposing `broken → governed` in one card. `apply.py` resolves a raise
as:

```python
requested = snap_down(int(op.value), allowed)
new = max(current, requested) if kind == "raise_to" else requested
```

`snap_down` only finds the nearest *allowed* rung at or below the request. No clamp on the
distance, no scaling cost, and nothing in pitch scoring reads the delta either. Today's only
brakes are:

| Brake | Where | What it limits |
|---|---|---|
| 3 slots per proposal | `MAX_ATOMIC_CHANGES`, UI-side | How many targets, not how far each one moves |
| `allowed_levels` | per target in `MlopsGraph.json` | Which rungs exist at all |
| Owner degradation | `resolve_degradation` | Buy-in below `debt_buyin_threshold` (0.4) drops the raise one allowed rung and books a `DebtEntry`. A degraded repair of something broken stays broken |

So a player with a happy owner can take a component from broken to governed for the same
price as nudging it one rung, which is the opposite of what MLOps practice teaches.

## Why not a hard clamp

The obvious fix - `new = min(requested, current + 1)` - is one line, and it would silently
rewrite authored content: **31 payloads in `RequirementObjects.json` already raise a target by
two or more rungs** (several `req.kpi_definition` 1 → 4). A clamp turns every one of those
into a quieter change than its author intended, with no error to notice. If we ever want it,
it needs a content audit first, not just the line.

The two options below leave `apply` alone and put the cost where the game already argues.

## Option A: slot cost by distance

A proposal has three slots. Let a raise consume one slot per rung it climbs.

```
slots_used = sum(target_level - current_level for each change)   # min 1 per change
```

Then a single broken → governed jump (4 rungs) does not fit in a proposal at all, a 3-rung
jump is the whole proposal, and three modest raises still fit as they do now.

- **Where:** UI (`MAX_ATOMIC_CHANGES` accounting) plus the same rule server-side wherever a
  proposal is validated, so it is not merely a client-side courtesy.
- **Teaches:** ambition crowds out breadth. A player wanting one dramatic upgrade gives up
  everything else this round, which is exactly the trade a real team makes.
- **Reads well:** the slot strip already shows 3 boxes; a 3-rung raise visibly fills three.
- **Risk:** the authored multi-rung payloads above are action-card content, not player
  proposals, so they are unaffected - but any card that *offers* a 4-rung raise would then be
  proposing something a player could never assemble themselves. Worth a consistency pass.

## Option B: resistance by distance

Leave the slots alone and make the stakeholders the brake: the further a raise reaches, the
harder the owner is to convince.

Concretely, one of:

1. **Buy-in threshold scales with distance.** `debt_buyin_threshold` is a flat 0.4. Make the
   required buy-in rise per rung, e.g. `0.4 + 0.15 * (distance - 1)`, so a 4-rung jump needs
   an owner who is genuinely behind it.
2. **Degradation scales with distance.** Today an unhappy owner costs exactly one rung. Let it
   cost one rung per two rungs attempted, so an over-reach lands much closer to where it
   started and books correspondingly larger debt.
3. **An extra objection.** A change of more than one rung adds an objection to the debate,
   drawn from the owner's boundaries ("that is a quarter of work, not a sprint").

- **Where:** `resolve_degradation` and the pitch objection selection - both already exist and
  already carry the vocabulary of buy-in and debt.
- **Teaches:** big leaps are not forbidden, they are *expensive to get agreed*, which is the
  truer lesson and the one this game is built to deliver.
- **Risk:** it is invisible until the player pitches. Without a UI hint in the composer, a
  player only learns the rule by losing a debate.

## Recommendation

**B, with a hint of A's honesty in the UI.** Resistance by distance reuses machinery that
exists, needs no content migration, and puts the brake in the part of the game that is about
persuasion rather than in a rule that silently clips a number. Pair it with a marker in the
level picker - the rungs beyond `current + 1` flagged as a reach, with the owner named - so
the cost is legible before the pitch rather than after it.

If we want a hard ceiling anyway, A is the one to build, because it is visible in a control
the player is already reading.

## Open questions

1. Does distance count rungs, or allowed rungs? A target whose `allowed_levels` skips a rung
   would otherwise be cheaper to climb than a dense one.
2. Does repairing from broken count as distance, or is a repair its own thing? Today a
   degraded repair of something broken stays broken, which already makes repairs special.
3. Should governance targets be exempt? They are editable in every phase, and their raises
   are usually policy rather than build effort.
