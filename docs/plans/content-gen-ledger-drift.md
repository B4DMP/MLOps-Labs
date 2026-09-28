# content_gen ledger vs. production drift

Status: **axis and reclassification fixed; one design-balance side effect still open.**

## The gap

`gameConfig/*.json` is the live, hand-tunable source of truth; `game-api/tools/content_gen/work/out/*.json`
is the pipeline's own record of what it generated and approved. Nothing keeps them in sync after the
fact - a hand edit to `gameConfig` (a rename, a balance fix, a reclassification) never flows back into
the ledger, so re-running `content_gen assemble` for real can silently revert production to a stale
state. This was discovered while shipping three humor rewrites and trying to run a full `assemble`
afterward.

Fixed so far:
- Challenge renames propagated into cached `items`/`artifacts`/`gists` output.
- `axis` backfilled on all 11 templates' `conflict.positions`/`on_enter_ops`/`stalemate_ops`.
- `to_requirements()` was missing a `branch_x_axis`/`branch_y_axis` field entirely (a real tool bug,
  not just stale data) - added, wired through, and gated in `axis_errors()`.
- Item-level axis data backfilled for 100 of 106 items from the current `gameConfig/RequirementObjects.json`.
- 29 `Fact`-tagged items pruned from the ledger after origin removed them from production.
- 6 `driver`/`trade_off` reclassification mismatches resolved (see below); `select-humor`'s
  temporary exclusion for them was removed since they're no longer unstable.

## Resolved

**Six items where the ledger's own tag disagreed with what's shipped** - `driver` in the ledger,
`trade_off` in production. Reclassified to `trade_off` and backfilled fact/reading/concedes/branch
data from production, checked individually rather than by blanket rule - each one had a concrete
coherence break against its own shipped mechanic (an invented detail with no field to back it,
a concession running the wrong direction, or a fact narrower than the branch it was supposed to
describe). Production's text won every time, but for a specific, checkable reason each time, not
because "production is newer":

- `gen_cost_crisis_drift_gap_emilia_efficiency_kpi` - ledger's fact invented a "monitoring
  contractor" that the real branches (automation level 2 vs. 3) have no way to represent.
- `gen_heatwave_forecast_gap_monica_driver_eval` - ledger's reading conceded speed *for*
  automation; the real branch_y is the opposite (harness goes back to manual).
- `gen_heatwave_forecast_gap_emilia_driver_eff` - ledger's reading invented an "accuracy
  threshold" with no field in the branch structure.
- `gen_loyalty_data_deployment_block_alex_promotion_deadline` - ledger's reading read as a neutral
  fact about the deadline, not Alex's own concession, and never referenced the branch.
- `gen_nightly_window_miss_ruth_validation_driver` - ledger's reading implied no change
  ("remains manual"); the real branch_y is a partial raise to level 2.
- `gen_silent_ingestion_failure_ruth_driver_ingest` - ledger's fact was scoped to ingestion alone;
  production's branch_x is a composite raise across ingestion, validation, and versioning together.

Side effect: this pushes 6 more items from `driver` to `trade_off`, worsening a pre-existing
`validate` gate failure below.

## Still open

**Stance-mix gate failure**, worse than before this fix but not caused by it - see
`stance-mix-rebalance.md`. Not blocking anything; optional.

**Three orphan requirements in production with no ledger counterpart at all**, each missing an
objection line (a pre-existing `validate` gate error, not caused by any of this work):

- `gen_loyalty_consent_gap_reuben_kpi_documentation`
- `gen_silent_ingestion_failure_reuben_driver_validation_governance`
- `gen_silent_forecast_failure_reuben_driver_observability`

A full `content_gen assemble` would delete all three outright (it strips and rebuilds every `gen_`
requirement from the ledger). Someone needs to decide whether they're worth re-authoring in the
ledger or dropping from production.

## Not yet checked

Whether the same drift exists in the `templates`/`items` stages' other fields beyond axis (name,
description, preconditions text), or in `objections`/`gists`. The axis gap was found and fixed
narrowly; a full audit hasn't been done.
