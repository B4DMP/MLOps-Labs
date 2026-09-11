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
| 02 | [Intel taxonomy](02-intel-taxonomy.md) | 01 | DONE | New tags end to end on legacy content (re-tagged stopgap). Investigate card to 06, environment dossier view to 05. |
| 03 | [Patterns and challenge selection](03-patterns-and-selection.md) | 01 | DONE | 14 anti + 17 design patterns cover every component and pipeline edge. Selection live, keeps today's order. |
| 04 | [Content pipeline](04-content-pipeline.md) | 02, 03 | WIP | Templates fixed (p3/s0 Dave want 1→2, p3/s1 Monica want 2→3). Items regenerating with i8+Qwen. Gates+CI wired (step 6 ✓). Conflict blocks fixed (step 7 ✓). Blocked on step 3 regen + human review, then steps 8-9. |
| 05 | [Persistent dossier](05-persistent-dossier.md) | 04 | TODO | Cross phase intel, chains shown as one growing card. |
| 06 | [Merged pitch phase](06-merged-phase.md) | 04, 05 | TODO | Any-mix card, five objection kinds, escalation, veto, stalemate. |
| 07 | [Simulation phase](07-simulation-phase.md) | 03, 06 | TODO | Apply, capping, propagation, patterns, grudges, delta report. |
| 08 | [Player graph view](08-graph-viz.md) | 01 | WIP | Steps 1–6, 8 done (Q21 closed: curved feedback arcs added to strip). Only step 7 (before/after toggle, blocked on 07). |
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
| D19 | Health source? | Superseded by D32. |
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
| D32 | What does health measure? | Problems, not maturity: 100 plus design bonuses minus antipattern penalties, 15 per broken target (effective 0), 6 per debt entry. Maturity is shown separately. |
| D33 | Starting state and stage fog? | The game starts green. Challenges turn the current phase's areas red, the player saves them. Stages of phases not reached yet are hidden entirely; the governance band is always visible. |
| D34 | Old gameplay data? | Wiped (everything except the `internal` campaign and its accounts, configs and the vector store). No backwards compatibility needed from here on. |
| D35 | Health under upstream break (Q22)? | Count only root-cause (nominally broken) components in health. Downstream components that have an effective level of 0 due to propagation are shown as **starved** in health readout and in the admin view, but do not each add a 15-point penalty. Challenge preconditions continue to read effective levels so a broken upstream still makes downstream challenges ineligible while the break persists. **Alternatives on record**: (a) read preconditions on nominal level too — removes the ineligibility but lets players trigger challenges on a technically broken stack; (b) keep effective level everywhere — harshest, defensible if fog fully hides it until the phase is reached. Revisit after tier 0 playtest. |

## Open questions

| ID | Question | Needed by |
|---|---|---|
| Q20 | Remaining review of `gameConfig/MlopsGraph.json`: component names, initial levels, attribute enums, `briefing_observed`, starting instances. First pass done (D30, D31); `tools/graph_refactor.py` keeps later renames cheap. | 04 |
| Q21 | Feedback arcs in pipeline strip: curved SVG arcs above stage row, colour-coded by level, height proportional to stage distance. **Closed: implemented.** | 08 |

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
- **impl** plan 02 implemented: `IntelTag` with payloads and gate, legacy content and stored rows re-tagged (migration `f6a7b8c9d0e1`), prompts and UI on shared tag wording, Facts lift fog on leaving offline gathering. 107 tests green, UI typechecks.
- **v3.3** health measures problems (D32), start green with stage-level fog (D33), gameplay data wiped (D34).
- **impl** content harness (plan 04 steps 0, 1, 1b); intel description split folded in (fact holds still, reading changes with the tag).
- **impl** tier 0 generated and assembled: 4 challenge templates, 46 items, 46 artifacts, 41 objections, 24 fragments. Name tokenizer no longer eats role words, repairs dropped apostrophes; dry runs no longer mark items stale.
