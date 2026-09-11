# 07 Simulation Phase

Depends: [03](03-patterns-and-selection.md), [06](06-merged-phase.md). Tracked in [STATE.md](STATE.md).

`ac_simulation.tsx` is an empty mock today. This makes it the phase where the card meets the graph.

## Server pipeline, deterministic, no LLM

```
1.  before          = load_state(user), with effective levels and active patterns
2.  owner_buyin     = buy-in of each component owner, from COMMIT
3.  card ops        = union of the ops of every slotted stance item
4.  after, debt     = apply_ops(before, card ops, owner_buyin)
5.  effective       = recompute effective levels, record capped_by per target
6.  world events    = on_exit_ops of the template, plus consequence ops from active antipatterns
7.  after           = apply_ops(after, world events), recompute effective
8.  patterns        = recompute, diff against before
9.  grudges         = fire scheduled friction
10. metrics         = weighted sum of effective level deltas
11. observe         = emit observe ops for every target the card touched, effective values
12. persist ops, debt, snapshot
13. next challenge  = select_challenge(after, ...)
```

Every slotted stance item applies its ops, whatever the player tagged it as. The tag only shaped how the player weighed it: wrong tags cost buy-in and objections in OBJECT ([02](02-intel-taxonomy.md#mis-tag-consequences)), not the action itself. A Fact tagged as a stance has no ops and does nothing.

## Outcome branches

- **PASS**: pipeline as above.
- **SOFT_PASS**: plus a grudge per neglected low power stakeholder. A grudge is persisted state that schedules friction. At step 9 each grudge picks one effect, deterministically by age and owner: a target landing one level lower, a world event brought forward, or an extra objection at patience minus one next time.
- **VETO_BROKEN**: card applies, overridden stakeholder degrades everything they own maximally, double weight grudge.
- **STALEMATE**: steps 3 to 5 skipped. `stalemate_ops` fire as a world event, metrics take the authored hit, grudges for everyone in the room. Report leads with what went wrong.

## Delta report payload

```json
{
  "outcome": "soft_pass",
  "targets": [{"id": "model.training_pipeline", "stage": "model",
               "nominal": {"before": 2, "after": 4},
               "effective": {"before": 2, "after": 2},
               "capped_by": {"id": "e.fs_train", "level": 2},
               "degraded_by": null,
               "story": "The pipeline is automated, but it still waits for someone to hand over features."}],
  "debt_created": [{"target": "...", "owner_id": "data_dave", "intended": 4, "applied": 2}],
  "world_events": [{"target": "e.ingest_validate", "before": 4, "after": 0, "reason": "nightly job died"}],
  "propagated": [{"target": "data.feature_store", "effective": {"before": 4, "after": 1}, "via": "e.ingest_validate"}],
  "stage_health": {"model": {"before": 40, "after": 52}},
  "system_health": {"before": 38, "after": 47},
  "patterns": {"gained": ["dp_reproducible_training"], "lost": [], "anti_created": [], "anti_resolved": []},
  "grudges": {"created": [], "fired": []},
  "metric_deltas": {"model": 4, "automation": 2}
}
```

`capped_by` and `propagated` are what make capping feel fair. Every cap is named.

## Screen

`ac_simulation.tsx` as a four beat report:

1. **What you built.** Targets with nominal and effective side by side where they differ, the cap named. Amber for owner degradation, red for debt.
2. **What the world did.** World events and what they propagated to.
3. **Patterns.** Design patterns gained or lost, antipatterns created or resolved, with their story lines.
4. **Where you stand.** Stage graph before and after from [08](08-graph-viz.md), metric deltas, continue.

## Metric coupling

`GameMetrics.json` entries gain `component_weights` over components and edges. Metric delta is a weighted sum of effective level deltas. Driver credit reuses the same weights ([02](02-intel-taxonomy.md#payloads)). LLM metric estimation deleted.

## Steps

- [ ] 1. `graph_service/pipeline.py`, 13 steps, pure except store calls.
- [ ] 2. Owner resolution per component, stage default fallback.
- [ ] 3. `on_exit_ops`, antipattern consequence ops.
- [ ] 4. `component_weights` in `GameMetrics.json`, delete the LLM metric path.
- [ ] 5. Grudge resolution, deterministic effect pick.
- [ ] 6. Outcome branches.
- [ ] 7. `graph:delta_report` event.
- [ ] 8. Rewrite `ac_simulation.tsx` as the four beat report.
- [ ] 9. Next challenge selection at the end of the report.
- [ ] 10. Tests: capped raise reports its cap, propagation after a break, unhappy owner degrades, debt repaid later, design pattern gained lifts health.

## Done when

A capped raise names what capped it, a break visibly propagates, a completed design pattern lifts stage health, and metric deltas match the arithmetic.
