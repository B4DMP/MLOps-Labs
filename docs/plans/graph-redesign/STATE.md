# STATE: MLOps Graph Redesign

Single source of truth for progress. Update after every completed step.

## Protocol

- Work top to bottom. Do not start a plan whose `Depends` are not `DONE`.
- Inside a plan file, do steps in order. Check `[x]` there, then update the row here.
- Status: `TODO`, `WIP`, `DONE`, `BLOCKED`.
- On `BLOCKED`, write the reason in Notes and stop. Do not improvise scope.
- Keep every commit runnable. No half migrated config.
- Database is disposable in development. Prefer a clean rebuild over a compatibility shim.
- Standing rule: nothing that affects score, buy-in, health or selection is produced at runtime by an LLM.

## Plans

| # | Plan | Depends | Status | Notes |
|---|---|---|---|---|
| 00 | [Overview and decisions](00-overview.md) | - | DONE | Read first. Two graphs, fog of war, taxonomy, loop. |
| 01 | [Graph core](01-graph-core.md) | 00 | DONE | Migration applied, seeding on game init, refactor tool. Ships dark. Review findings pending (Q20). |
| 02 | [Intel taxonomy](02-intel-taxonomy.md) | 01 | TODO | Driver, Boundary, Trade-off, Fact, plus Language profile. |
| 03 | [Patterns and challenge selection](03-patterns-and-selection.md) | 01 | DONE | 14 anti + 17 design patterns cover every component and pipeline edge. Selection live, keeps today's order. |
| 04 | [Content pipeline](04-content-pipeline.md) | 02, 03 | TODO | Tier 0 first, then full set. Resumable harness, 9 gates. |
| 05 | [Persistent dossier](05-persistent-dossier.md) | 04 | TODO | Cross phase intel, chains shown as one growing card. |
| 06 | [Merged pitch phase](06-merged-phase.md) | 04, 05 | TODO | Any-mix card, five objection kinds, escalation, veto, stalemate. |
| 07 | [Simulation phase](07-simulation-phase.md) | 03, 06 | TODO | Apply, capping, propagation, patterns, grudges, delta report. |
| 08 | [Player graph view](08-graph-viz.md) | 01 | TODO | Stage strip, technical modal per stage, fog rendering. |
| 09 | [Admin debug view](09-debug-view.md) | 04 | TODO | Full dump, health breakdown, orphans, selection trace. |

Suggested order: 01, then 02 and 03 in parallel, then 04 while 08 and 09 run alongside, then 05, 06, 07.

## Decided

| # | Question | Decision |
|---|---|---|
| D1 | Is the pitch terminal? | Yes, amendable during OBJECT before commit. |
| D2 | Graph shape? | **v3:** two graphs. Technical graph with ~34 components and typed edges. Stage graph derived from it: 5 pipeline stages plus a Governance and Infra band. Replaces the flat 7 node graph. |
| D3 | Do patterns pick challenges? | Yes. Templates carry preconditions over anti and design patterns. Content regenerated. |
| D4 | Card size? | 1 to 5 intel items, no filler. Composition in D27. |
| D5 | Keep the old online intel phase behind a flag? | No, delete it. |
| D6 | Do card building or amendments cost attention tokens? | No. Emergency Addendum costs an Escalation Point. |
| D7 | What happens on a veto? | Pass / Soft Pass / Veto. Veto Breaker for an Escalation Point, or Rebuild at patience cost with a material difference. Patience exhausted is Stalemate. |
| D8 | Where do conflicts live? | On the challenge template, typed `soft` (Trade-off exists) or `hard` (Boundary exists). |
| D9 | How is content generated? | Resumable, cancellable CLI harness over the existing LLM stack, sqlite ledger keyed by input hash. |
| D10 | Legacy database migration? | None. Drop and rebuild. |
| D11 | Fog of war? | **v3:** topology visible, levels, triggers and attributes hidden until observed. Facts, Investigate cards, technical objections and own card results reveal. Seed reveals only briefing facts. Stakeholders are never fogged. Scoring on ground truth. |
| D12 | Can action cards create instances? | No. Deferred in [BACKLOG.md](BACKLOG.md). |
| D13 | Levels everywhere, or subsets? | Per component and per edge `allowed_levels`. |
| D14 | Patience per challenge or per phase? | Per challenge. |
| D15 | Do Escalation Points regenerate? | No, 3 per game. Revisit after playtest. |
| D16 | Intel taxonomy? | Driver, Boundary, Trade-off, Fact as item tags. Language as the per stakeholder profile via existing convincer tagging. |
| D17 | Driver target? | Metric plus suggested target. Full credit on the suggested target, partial on anything weighted into the same metric. |
| D18 | Do facts forbid actions? | No. Capping comes from edges, vetoes from Boundaries. Facts make both visible in the builder. Mis-tagged facts do not lift fog. |
| D19 | Health source? | Maturity term capped at 60 plus design pattern bonuses minus antipattern penalties minus debt. Healthy needs design patterns. |
| D20 | Cadence? | Moved from component attribute to edge trigger. |
| D21 | Attributes? | Still out of health, but Boundaries and Trade-offs may read them, and Driver items may set them. |
| D22 | Convincer fit scope? | Every stakeholder in the room, against the better of main and secondary (secondary with a small malus). |
| D23 | Dialogue options? | Amend, Reframe, Stonewall, Emergency Addendum, Concede Correction. Compromises only via Amend with intel items. |
| D24 | Refinement chains in the dossier? | Displayed as one growing card, newest link as headline, older links stacked, locked rows for undiscovered links. |
| D25 | Requirements stage components? | KPI definition, acceptance criteria, data contracts, risk assessment. |
| D26 | Near-duplicate components? | `model.registry` absorbs model versioning. Drift pair kept, renamed `data.training_drift_check` and `ops.production_drift_monitoring`. |
| D27 | Card composition? | 1 to 5 stance items in any mix of Driver, Boundary, Trade-off. No quota. Every stance item is an action plus its importance to the stakeholder. Boundaries are slottable and also checked automatically when unslotted. |
| D28 | Edge slack? | 0 on the core data to model to serving flow, 1 on side edges. Per edge, tunable. |
| D29 | Content scope for v1? | Tier 0 first: 2 phases, 2 templates each plus fallback, every mechanic exercised once, verified end to end. Full set after. |
| D30 | Scripted vs automated? | No `scripted` level. Five levels: broken, absent, manual, automated, governed. Edge level and trigger are kept consistent automatically. |
| D31 | Instance properties? | Ordered enum properties per instance kind in config, read by predicates, changed by world events, seeded starting instances. Not in coverage. |

## Open questions

| ID | Question | Needed by |
|---|---|---|
| Q21 | Starting graph puts every stage in the red band (health 18 to 31). Intended "you inherit a mess", or too grim? Knobs: `health_base`, `degraded` threshold, initial levels. | playtest |
| Q20 | Remaining review of `gameConfig/MlopsGraph.json`: component names, initial levels, attribute enums, `briefing_observed`, starting instances. First pass done (D30, D31); `tools/graph_refactor.py` keeps later renames cheap. | 04 |

## Deferred scope

Cut scope goes in [BACKLOG.md](BACKLOG.md), with the reason and what it would need. Rejected ideas are recorded there too.

## Revisions

- **v1** first plan set. Graph as levels, coverage math, merged phase, antipatterns modulating authored challenges.
- **v2** design review. `broken` level, attributes and instances, precondition driven selection, earned dialogue, escalation and stalemate, simulation phase, resumable content harness.
- **v2.1** fog of war decided, instances deferred, BACKLOG added.
- **v2.2** Q9 to Q11 answered.
- **v3** Driver / Boundary / Trade-off / Fact taxonomy with Language as profile. Reviewer notes ([REVISION_NOTES.md](REVISION_NOTES.md)) folded in: two-graph architecture with edges as mechanics, 34 component set, health and scheduling from anti and design patterns, facts as intel with defined pitch effects, fog of war sharpened, chains shown as one card, card of intel only, fit against all stakeholders, Defer, Cite Evidence and Trade removed. Plan 03 renamed.
- **v3.2** graph review: scripted level dropped with edge trigger invariant (D30), typed instance properties (D31).
- **v3.1** Q16 to Q19 answered: risk assessment added, registry absorbs versioning, drift pair renamed, any-mix card with slottable Boundaries, slack defaults, tier 0 content first.
- **impl** plan 01 implemented: `domain/graph.py`, `domain/graph_factory.py`, `domain/story_factory.py`, `application/graph_service/` (apply, effective, predicates, stage_graph, story, store), migration `e5f6a7b8c9d0`, `tests/test_graph_core.py`.
- **impl** graph refactor tool with aliases and retirements; absent steps pass through in effective levels.
- **impl** plan 03 implemented: `domain/pattern.py`, `domain/graph_predicates.py` (moved from application so config load can validate), `application/graph_service/view.py`, `scheduler.py`, challenge template fields, `MlopsPatterns.json`, `tests/test_graph_patterns.py`.
