# 07 Simulation Phase

Depends: [03](03-antipatterns-and-selection.md), [06](06-merged-phase.md). Tracked in [STATE.md](STATE.md).

`ac_simulation.tsx` is an empty mock today. This makes it the real phase where the card meets the graph.

## Server pipeline, deterministic, no LLM in any branch

```
1. before        = load_state(user)
2. owner_buyin   = buy_in of each node owner, from COMMIT
3. card ops      = raise_to(component, level) for every component in the locked card
4. after, debt   = apply_ops(before, card_ops, owner_buyin)
5. world events  = on_exit_ops of the challenge, plus consequence ops from standing antipatterns
6. after         = apply_ops(after, world_events)
7. antipatterns  = recompute, diff against before
8. metrics       = weighted sum of component level deltas, replaces the LLM estimate
9. promises      = broken promises resolve as trust loss, grudges fire their scheduled friction
10. persist ops, debt, snapshot
11. next challenge = select_challenge(after, next phase or same phase)
```

## Outcome branches

The pipeline above is the PASS path. Three variants from [06](06-merged-phase.md):

- **SOFT_PASS.** Same as pass, plus a `grudge` per neglected low power stakeholder. A grudge is persisted state, not a mood value: it schedules friction. Resolution at step 9 picks one effect per grudge, deterministically by grudge age and owner: a component landing one level lower, a world event delayed by one challenge, or an extra objection with `patience - 1` next time that stakeholder is in the room.
- **VETO_BROKEN.** Card applies in full, the overridden stakeholder degrades every component they own to the maximum extent, and carries a grudge with double weight.
- **STALEMATE.** No card ops at all. Steps 3 and 4 are skipped. The challenge `stalemate_ops` fire as a world event, metrics take the authored hit, every stakeholder in the room carries a grudge, and the game advances. The report screen leads with what went wrong instead of what changed.

## Wrong categorization

An item tagged wrong that survived the objection round lands one level lower and costs the owner emotion. Right thing, wrong reason.

## Delta report payload

```json
{
  "components": [{"id": "...", "node_id": "data", "before": 1, "after": 4,
                  "degraded_by": "data_dave", "story": "Great Expectations runs on every commit."}],
  "debt_created": [{"component": "...", "owner_id": "data_dave", "intended": 4, "applied": 2}],
  "world_events": [{"component": "...", "before": 4, "after": 0, "reason": "nightly job died"}],
  "node_health": {"data": {"before": 40, "after": 62}},
  "system_health": {"before": 38, "after": 51},
  "antipatterns": {"created": [...], "resolved": [...]},
  "promises_broken": [...],
  "grudges": {"created": [...], "fired": [...]},
  "outcome": "soft_pass",
  "metric_deltas": {"data": 4, "automation": 2}
}
```

Story strings come from the [01](01-graph-core.md) fragment table, so the same delta always reads the same way.

## Screen

Rewrite `ac_simulation.tsx` as a three beat report:

1. **What you changed.** Component list, green lifted, amber degraded by an unhappy owner, red debt. Owner avatar on every degraded row with the one line reason.
2. **What the world did.** World event rows, including things that broke on their own.
3. **Where you stand.** Pipeline before and after from [08](08-graph-viz.md), antipatterns created and resolved, metric deltas, then continue.

## Metric coupling

`GameMetrics.json` entries gain `component_weights`. Metric delta is a weighted sum of level deltas. Deterministic and explainable. The LLM metric estimation path is deleted, not flagged.

## Steps

- [ ] 1. `application/graph_service/pipeline.py` implementing the 11 steps, pure except the store calls.
- [ ] 2. Owner resolution helper, phase aware, fallback to config default.
- [ ] 3. `on_exit_ops` on challenge templates, antipattern consequence ops.
- [ ] 4. `component_weights` in `GameMetrics.json`, delete the LLM metric path.
- [ ] 5. Promise and grudge resolution, deterministic effect pick.
- [ ] 5b. Outcome branches: soft pass, veto broken, stalemate with `stalemate_ops`.
- [ ] 6. New ws event `graph:delta_report`.
- [ ] 7. Rewrite `ac_simulation.tsx` as the three beat report.
- [ ] 8. Trigger next challenge selection at the end of the report.
- [ ] 9. Tests: unhappy owner degrades, happy owner does not, debt repaid later, world event can break a component the player just raised.

## Done when

Locking a card visibly moves node health, an unhappy owner visibly creates debt, the world visibly breaks something on its own, and metric changes match the arithmetic.
