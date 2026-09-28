# Corpus-wide driver/trade-off rebalance

Status: **not blocking anything, optional, low priority.**

## The gap

`content_gen validate` fails a pre-existing gate: of 66 generated stances, 59.1% are trade-offs
(scope allows at most 55%) and only 24.2% are drivers (scope wants at least 25%). This predates
all of this session's work - it was already failing the first time `validate` ran. Converting 3
trade-offs into drivers would close both gaps at once (driver 19/66 = 28.8%, trade-off 36/66 = 54.5%).

This does not block shipping more humor content, and does not need fixing for the humor pipeline
to keep working.

## Why it's not a mechanical fix

Every item already carries all four readings (`driver`/`boundary`/`trade_off`/`fact`) regardless of
which tag is active, and a trade-off's `branch_x` already names the "more automation" target/level -
so converting one to a driver needs no new writing, just reusing `readings.driver` and `branch_x` as
`suggested_target`/`level`/`axis`, the same mechanical shape as the reclassification fix already done
in `content-gen-ledger-drift.md`.

What makes it not mechanical: a trade-off gives the player something to negotiate a concession out
of; a driver is a fixed ask with no concession. Converting one to the other changes what a player
actually negotiates in that challenge, not just which text describes it. That's a design/pacing call
- which stakeholder gets the pushier ask, in which challenge - not a coherence question with a
checkable right answer.

## Candidate items, if someone wants to do this

Picked for spread across challenges/stakeholders and because their `readings.driver` already reads
as a clean ambition with minimal rework:

- `override_blind_spot` / `emilia_cost_concern` (efficiency_emilia)
- `shadow_deployment_contract` / `alex_shadow_tradeoff` (automation_alex)
- One more, chosen to avoid doubling up a stakeholder/challenge already picked above.

Not evaluated further than this - picking the actual 3 and converting them was paused here rather
than decided unilaterally, since it's a gameplay-shape call.
