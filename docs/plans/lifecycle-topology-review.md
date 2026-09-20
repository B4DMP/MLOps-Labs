# Lifecycle topology review

Raised while building the stage neighbour rails in the Performance Dashboard: the rails read
the stage flow lists out loud ("to Data and Modeling", "loops back into Modeling and
Deployment"), and doing so surfaced two claims about the lifecycle that nobody had had to
look at before.

Status: **issue 1 shipped, issue 2 specified and not built.**

## What the graph says today

Cross-stage edges in `gameConfig/MlopsGraph.json`, excluding `governs`:

| Edge | From → To | Stages | Kind | Slack | Initial |
|---|---|---|---|---|---|
| `e.contracts_ingest` | `req.data_contracts` → `data.ingestion` | req → data | pipeline | 1 | 1 |
| `e.acceptance_eval` | `req.acceptance_criteria` → `model.evaluation` | req → model | pipeline (`stage_flow: false`) | 1 | 1 |
| `e.fs_train` | `data.feature_store` → `model.training_pipeline` | data → model | pipeline | 0 | 2 |
| `e.driftcheck_train` | `data.training_drift_check` → `model.training_pipeline` | data → model | pipeline | 1 | 1 |
| `e.registry_cicd` | `model.registry` → `deploy.cicd` | model → deploy | pipeline | 0 | 2 |
| `e.serving_observe` | `deploy.serving` → `ops.observability` | deploy → ops | pipeline | 1 | 2 |
| `e.retrain_train` | `ops.retraining_trigger` → `model.training_pipeline` | ops → model | feedback | 1 | 1 |
| `e.rollback_serving` | `ops.rollback` → `deploy.serving` | ops → deploy | feedback | 1 | 1 |

## Issue 1: Requirements appeared to feed Modeling directly — fixed

### What was actually modelled

The edge is `req.acceptance_criteria → model.evaluation`: the acceptance criteria are the
yardstick the evaluation measures against. As a component-level dependency that is correct
and load-bearing — the `dp_gated_promotion` design pattern requires exactly this chain
(`req.acceptance_criteria ≥ 2`, `e.acceptance_eval ≥ 3`, `e.train_eval ≥ 3`,
`model.evaluation ≥ 3`, `e.eval_registry ≥ 3`) and pays out `model +8, req +6`.

So the edge never claimed "you can build a model without data". It claimed "you cannot
meaningfully evaluate a model without agreed acceptance criteria", which is right.

### Why it read wrong

`stage_graph.py` collapsed every cross-stage pipeline edge into one arrow per stage pair. One
*specification* dependency between two components therefore became a stage-level flow
`req → model`, indistinguishable from the *supply* dependency `data → model`. The stage strip
hid this because it only draws connectors between adjacent buttons; the neighbour rails do
not, so Requirements announced "to Data and Modeling".

The graph was conflating two relations under `pipeline`:

- **supply** — work products flow along it (`data.feature_store → model.training_pipeline`)
- **specification** — one thing defines the bar another is judged against
  (`req.acceptance_criteria → model.evaluation`)

Both must cap effective level. Only supply should read as lifecycle sequence.

### What shipped

`Edge.stage_flow: bool = True` (`domain/graph.py`), honoured in both aggregation loops in
`stage_graph.py`, added to `gameConfigSchemas/MlopsGraph.schema.json`, and set to `false` on
`e.acceptance_eval`.

Capping is untouched, because `compute_effective` builds its incoming map from
`graph.pipeline_edges()` and never consults `stage_flow`. Verified: with
`req.acceptance_criteria` broken, `model.evaluation` still drops to effective 1 with
`capped_by = req.acceptance_criteria`, while the stage flows are now exactly
`req → data → model → deploy → ops`. `dp_gated_promotion` is unaffected. 89 graph tests pass.

## Issue 2: the lifecycle is a spiral and the graph cannot say so

### Decision: no new backward edges

Play runs forward and ends in a report screen after Monitoring and Ops. Backward *lifecycle*
edges would fight that, and they would also invite the reading the game must avoid: that
finishing a cycle undoes it.

This gives a rule worth writing down, because the two existing backward edges are not
exceptions to it:

> A backward edge models **runtime automation inside the deployed system** — machine-initiated,
> no human decision. `ops.retraining_trigger → model.training_pipeline` and
> `ops.rollback → deploy.serving` qualify: the running system retrains and rolls back on its
> own. Anything that requires somebody to *re-decide* — new data contracts, revised KPIs,
> a changed acceptance threshold — is not an edge. It is the next turn of the spiral.

This settles the two loops previously proposed here:

| Previously proposed | Verdict |
|---|---|
| `ops.production_drift_monitoring → data.training_drift_check` | **Not an edge.** Responding to drift with new data means revisiting data contracts and labelling, which is a decision, not plumbing. Carries into the next iteration instead. |
| `ops.performance_monitoring → req.kpi_definition` | **Not an edge.** Same reason, more so: renegotiating a KPI is the most human decision in the game. |

The teaching point survives, and improves: the player learns that drift is *not* answered by
automated retraining alone, because the retraining loop is drawn as plumbing while the data
and requirements response arrives as a decision they have to make next cycle.

### What needs encoding

Two separate things, which is why one edge could never carry them:

1. **Runtime feedback** — exists today as `feedback` edges. Nothing to change.
2. **Lifecycle iteration** — after the report, the next cycle opens at Requirements, carrying
   forward everything already built.

### Encoding: lifecycle metadata, not topology

Add a top-level block to `MlopsGraph.json`, next to `stages`:

```json
"lifecycle": {
  "cycle": ["req", "data", "model", "deploy", "ops"],
  "closes_into": "req"
}
```

Ship it on the `graph:state` payload as-is. It says the stage order is a cycle and names where
the next turn opens. It is a statement about the model the game teaches, so it belongs in the
config that defines that model rather than being inferred in the UI.

Rejected alternatives:

| Option | Why not |
|---|---|
| `next_iteration_stage` on the last stage | Same information, scattered across stage entries, and silent about the cycle as a whole |
| A `next_iteration` edge kind, ops → req | Still a backward edge in the data. Every consumer would have to learn to ignore it, and the phase gating would have to special-case it |
| Infer it in the UI: "a stage with no outbound flow links to the first stage" | Puts a claim about MLOps in a React component, where no other consumer can read it and no schema validates it |

### Encoding: the iteration counter

"Next version of requirements, not undo" needs the game to say which turn of the spiral it is
on. Add `iteration` (default 1) to the persisted graph state, incremented when the report
screen hands over.

The important half of this is already true and only needs saying out loud: **component and
edge levels persist across the hand-over.** The next cycle starts from the maturity the player
built, so the spiral visibly climbs. Surfacing the counter — "Cycle 2" in the phase rail,
"Requirements · iteration 2" in the dashboard — is what turns an invisible property into a
lesson.

### Encoding: the report screen as the hand-off

The report is where the loops that are *not* edges get their teeth. It reads the end-of-cycle
graph state and names what the next iteration should revisit, each item pointing at real graph
targets:

```json
"carry_over": [
  {
    "finding": "production_drift",
    "evidence": "ops.production_drift_monitoring",
    "revisit": ["data.training_drift_check", "data.labeling"]
  },
  {
    "finding": "kpi_missed",
    "evidence": "ops.performance_monitoring",
    "revisit": ["req.kpi_definition", "req.acceptance_criteria"]
  }
]
```

Those `revisit` targets are the ops → data and ops → req loops, expressed as a decision handed
to the player rather than as plumbing the system runs by itself. They are also the natural
seed for the next cycle's challenge and intel.

### UI consequences

- The end-of-cycle neighbour rail in the Performance Dashboard changes from "the cycle closes
  here" to a spiral marker naming the next iteration's opening stage, clickable like any other
  neighbour. Wording already avoids "the project begins"; it should now say which iteration.
- Runtime loops and the spiral hand-off must not look alike. Runtime feedback stays a dotted
  arc between stage buttons; the hand-off is a wrap-around at the end of the strip.
- The phase rail gains the cycle number.

## Open questions

1. Does the report screen advance the iteration counter, or does entering the next cycle's
   Requirements phase do it? (Affects whether the counter is graph state or progression state.)
2. Are `carry_over` findings authored per challenge, or derived from end-of-cycle graph state
   by rule (drift component above a threshold, acceptance criteria unmet)? Derived teaches
   more; authored is controllable.
3. Does a second cycle re-run the same phases with new challenges, or a shortened set? The
   `lifecycle.cycle` list assumes the full loop.
4. Should `stage_flow: false` also apply to `e.contracts_ingest`? It is arguably a
   specification edge too (data contracts define what ingestion must satisfy), but unlike
   `e.acceptance_eval` it points the same way the lifecycle runs, so drawing it as a hand-off
   costs nothing. Left as a hand-off for now.
