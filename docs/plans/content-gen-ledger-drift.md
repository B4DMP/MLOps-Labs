# content_gen ledger vs. production drift

Status: **partially fixed, two items still open.**

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

## Still open

**Six items where the ledger's own tag disagrees with what's shipped** - all `driver` in the ledger,
`trade_off` in production. Not an axis problem: the ledger's own driver payload is incomplete
(`suggested_target`/`suggested_level` are null), so production's reclassification is almost certainly
correct, but fixing it means picking which `fact`/`reading` text to keep, which is a content call, not
a mechanical field copy:

- `gen_cost_crisis_drift_gap_emilia_efficiency_kpi`
- `gen_heatwave_forecast_gap_monica_driver_eval`
- `gen_heatwave_forecast_gap_emilia_driver_eff`
- `gen_loyalty_data_deployment_block_alex_promotion_deadline`
- `gen_nightly_window_miss_ruth_validation_driver`
- `gen_silent_ingestion_failure_ruth_driver_ingest`

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
