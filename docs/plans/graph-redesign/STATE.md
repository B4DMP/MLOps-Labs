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
| 00 | [Overview and decisions](00-overview.md) | - | DONE | Read first. Vocabulary, decisions, roast. |
| 01 | [Graph core](01-graph-core.md) | 00 | TODO | Levels, attributes, instances, predicates, health, op log. |
| 02 | [Intel taxonomy](02-intel-taxonomy.md) | 01 | TODO | Position / Evidence / Leverage, six subtypes. |
| 03 | [Antipatterns and challenge selection](03-antipatterns-and-selection.md) | 01 | TODO | Preconditions, world events, stalemate ops, conflicts. |
| 04 | [Content pipeline](04-content-pipeline.md) | 02, 03 | TODO | Long pole. Resumable harness, full regeneration, 8 gates. |
| 05 | [Persistent dossier](05-persistent-dossier.md) | 04 | TODO | Cross phase intel, refinement chains, computed status. |
| 06 | [Merged pitch phase](06-merged-phase.md) | 04, 05 | TODO | Prepare, object, commit. Earned dialogue, escalation, veto. |
| 07 | [Simulation phase](07-simulation-phase.md) | 03, 06 | TODO | Apply, world events, grudges, delta report. |
| 08 | [Player graph view](08-graph-viz.md) | 01 | TODO | Pipeline panel with health. |
| 09 | [Admin debug view](09-debug-view.md) | 04 | TODO | Full dump, orphans, selection trace, guarded. |

Suggested order: 01, then 02 and 03 in parallel, then 04 while 08 and 09 run alongside, then 05, 06, 07.

## Decided

| # | Question | Decision |
|---|---|---|
| D1 | Is the pitch terminal? | Yes, terminal, but amendable during the objection round before commit. |
| D2 | 7 graph nodes or 5? | 7. |
| D3 | Do antipatterns pick challenges? | Yes. Challenge templates carry preconditions matched against graph state. Content regenerated for it. |
| D4 | Fewer than 5 Position items at pitch time? | Corporate noise filler, zero coverage, flat emotion penalty. |
| D5 | Keep the old online intel phase behind a flag? | No, delete it. |
| D6 | Do amendments cost attention tokens? | No. Building and amending the card is free. Preparation is what costs. Emergency Addendum costs an Escalation Point. |
| D7 | What happens on a veto? | Pass / Soft Pass / Veto. Veto is cleared with an Escalation Point (3 per game) or a rebuild that costs patience and must differ materially. Patience exhausted means Stalemate: no card applies, `stalemate_ops` fire, game advances. No auto pass, no soft lock. |
| D8 | Where do conflicts live? | On the challenge template, formalising the framing conflict the game already writes per challenge. Not a separate file. |
| D9 | How is content generated? | Progress aware, resumable, cancellable harness over the existing LLM stack, sqlite ledger keyed by input hash. |
| D10 | Legacy database migration? | None. Drop and rebuild. |
| D11 | Fog of war on the graph view? | Yes. Player sees `unknown`, `current` or `stale` per component. Scoring always runs on ground truth, knowledge only filters what is shown. |
| D12 | Can action cards create instances? | No. Only challenges and world events in v1. Deferred in [BACKLOG.md](BACKLOG.md). |
| D13 | Six levels everywhere, or per component subsets? | Per component `allowed_levels` subsets. |
| D14 | Is patience per challenge or per phase? | Per challenge. |
| D15 | Do Escalation Points regenerate? | No, 3 for the whole game. Revisit after playtest, see [BACKLOG.md](BACKLOG.md). |

## Open questions

None. Everything is decided above. New questions raised during implementation go here with the plan number that needs them, and move up to Decided once answered.

## Deferred scope

Anything cut on purpose goes in [BACKLOG.md](BACKLOG.md), with the reason and what it would need. Cuts made during implementation belong there too. Nothing leaves that file except through its own numbered plan.

## Revisions

- **v1** first plan set. Graph as levels, coverage math, merged phase, antipatterns modulating authored challenges.
- **v2** after design review. Added `broken` level and per component level subsets, component attributes and instances, intel taxonomy rework, precondition driven challenge selection with world events, objection dialogue with earned options, escalation points and stalemate, simulation phase as its own plan, resumable content generation harness. Renumbered 02 to 09.
- **v2.1** fog of war decided, player created instances deferred, [BACKLOG.md](BACKLOG.md) added as the standing record of cut scope.
- **v2.2** last three questions answered. Design is closed, implementation can start at 01.
