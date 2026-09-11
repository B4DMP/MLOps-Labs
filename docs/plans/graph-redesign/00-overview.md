# 00 Overview and Decisions

Progress tracked in [STATE.md](STATE.md). Supersedes [../pitch-debate-redesign.md](../pitch-debate-redesign.md), which stays as motivation and notation reference. Reviewer input in [REVISION_NOTES.md](REVISION_NOTES.md), folded in as v3.

## Goal

Everything points at one shared object: the MLOps Environment Graph. Intel describes stakeholders and the environment. Action cards change the graph. Patterns found in the graph set health and schedule challenges. Stakeholders own components. Player sees stage health and investigates the rest.

## Two graphs

| graph | holds | who sees it |
|---|---|---|
| **technical graph** | ~34 components, ~40 edges (workflows and pipelines), levels, attributes, instances | player through fog of war, admin in full |
| **stage graph** | 6 stages, stage health, stage to stage flow | player always, it is the pipeline view |

The stage graph stores nothing of its own. It is derived from the technical graph every fold. Stage health comes from patterns matched on the technical graph. Details in [01](01-graph-core.md).

## Core decision: levels, not free text

```
levels:  0 broken | 1 absent | 2 manual | 3 automated | 4 governed
applies to components and to edges
op:      raise_to(target, level)   player actions, max semantics
         set_to(target, level)     world events, forced, can go down
```

`broken` sits below `absent` on purpose. A failing check nobody trusts is worse than no check.

No `scripted` level (D30). Who starts the work is the edge trigger, so edge level and trigger are kept consistent automatically: `absent`/`broken` carry trigger `none`, `manual` carries `manual_request`, `automated`/`governed` carry an automatic trigger (`scheduled`, `on_data_arrival`, `on_alert`, ...). Reproducibility, the one thing a scripted rung added, is expressed by the versioning and tracking components and their patterns.

**Instances** are the concrete things in the graph: datasets, features, models, endpoints, pipelines. Each kind has ordered properties in config (D31), for example model `performance` poor < fair < good < excellent, dataset `quality` and `freshness`, endpoint `availability`, pipeline `reliability`. Predicates compare them, so patterns and challenge preconditions react to "the live model slipped" or "training data went stale", and world events such as drift change them. A handful exist at game start. They never enter buy-in coverage.

**Nominal versus effective.** A component has the level it was built to (nominal) and the level it actually delivers (effective). Effective is capped by its upstream components and by the maturity of the incoming edges. Broken upstream propagates downstream. Health, patterns and scoring run on effective levels.

No LLM and no embeddings in any scoring path. LLM writes prose only.

## Stages

| stage | phase | default owner | technical components |
|---|---|---|---|
| Requirements | 1 | requirements_reuben | KPI definition, acceptance criteria, data contracts, risk assessment |
| Data | 2 | data_dave | ingestion, validation, feature store, versioning, labeling, training data drift check |
| Modeling | 3 | model_monica | experiment tracking, registry (includes model versioning), training pipeline, HPO, evaluation |
| Deployment | 4 | automation_alex | CI/CD, serving endpoint, canary / A/B, shadow, containerization, orchestration, API gateway |
| Monitoring and Ops | 5 | reliability_ruth | performance monitoring, production drift monitoring, alerting, observability, retraining trigger, rollback |
| Governance and Infra | all | per component | IAM, audit, model cards, cost monitoring, IaC, compute scheduling |

Governance and Infra is a cross-cutting band, drawn under the pipeline, not a step in it. Ownership is per component with the stage owner as default, so cost monitoring can belong to efficiency_emilia while IAM belongs to someone else.

## Fog of war

The player is a PM. PMs do not know every technical property of their environment on day one. Finding out costs time.

**Always visible:** topology. Which components and edges exist. The PM has the architecture diagram.

**Hidden until observed:** nominal and effective level of each component, maturity and trigger of each edge, attributes.

**Knowledge state** per component and per edge: `unknown`, `current`, `stale`.

**How the player observes:**

| source | cost |
|---|---|
| Fact intel from offline artifacts, tagged correctly | tagging decision |
| Investigate engagement card on a stage | attention tokens |
| technical objection naming a component | a weaker pitch |
| the player's own card, after simulation | free, you know what you did |
| briefing at game start | free, a handful of facts only |

**What goes stale:** world events and owner degradation change ground truth without an `observe`. Last seen value stays on screen, marked stale.

**Why it matters in the pitch:** facts never forbid anything. Capping is physics, vetoes come from Boundaries. Facts let the player see both coming. Without them the card builder shows `?` for the predicted outcome and the delta report brings the surprise.

**Stage health** with unobserved parts renders as a band, not a number.

Scoring, patterns, health and challenge selection always run on ground truth. Knowledge only filters what the player is shown. Stakeholders are never fogged: they know their own part of the environment, the PM is the one who has to catch up.

## Intel taxonomy

Full design in [02](02-intel-taxonomy.md).

```
stakeholder stance   Driver | Boundary | Trade-off     per item, tagged in offline intel gathering
environment          Fact                               per item, tagged in offline intel gathering
stakeholder profile  Language                           one per stakeholder, existing convincer tagging
```

Every stance item is an action on the graph plus how much its stakeholder cares: Boundary must happen or must never be undone, Driver is wanted, Trade-off is accepted at a cost. The card takes 1 to 5 stance items in any mix, no quota per tag. Unslotted Boundaries are still checked automatically. Language sets the framing. Facts feed knowledge, not slots.

## Loop

1. **Challenge selection.** Patterns in the graph matched against challenge preconditions. Deterministic. Challenge may fire world events on entry.
2. **Offline intel gathering.** Stakeholder and technical artifacts, tagged with the new taxonomy.
3. **Pitch phase, PREPARE.** Engagement cards, including Investigate. Player builds a card from 1 to 5 stance items in any mix, plus main and optional secondary convincer profile. Building is free.
4. **Pitch phase, OBJECT.** Deterministic objections. Player answers with options earned earlier. Amendments are made by adding intel items, nothing else.
5. **Pitch phase, COMMIT.** Pass, Soft Pass, or Veto. Veto cleared by an Escalation Point or a materially different rebuild at the cost of patience. Patience exhausted is Stalemate.
6. **Simulation phase.** Card ops applied, owner degradation, capping and propagation, world events, patterns recomputed, grudges fire, delta report. Replaces the empty `ac_simulation` mock.
7. Next challenge selected from the new graph.

## Health

```
stage_health = clamp( 20
                      + 40 * mean(effective_level / 4 over stage components and internal edges)
                      + sum(design pattern bonuses)
                      - sum(antipattern penalties)
                      - 6 * debt_entries_in_stage , 0, 100)
system_health = weighted mean of stage health
```

Maturity alone tops out at 60. Healthy (>75) needs design patterns. Patterns are the main driver, maturity keeps every raise visible. Details in [03](03-patterns-and-selection.md).

## Tech debt

Owner unhappy at apply time means the change lands one allowed level lower. Recorded as `{target, intended, applied, owner_id, challenge}`. Drags stage health, can flip a pattern, cleared by a later card on the same target with a happy owner.

## State model

Append-only op log per player. Ground truth and player knowledge are two pure folds over it. Database is disposable during development: schema changes drop and rebuild.

## What is being deleted

- `requirement`, `negotiable_preference`, `personal_friction` tag set
- `determine_dialogue_options` randomized option list
- LLM-estimated metric changes
- challenge ordering by fixed index
- the flat 7 node graph from v2

## Standing rules

0. Scope cut on purpose goes in [BACKLOG.md](BACKLOG.md), never silently dropped.
1. Nothing that affects score, buy-in, health or selection is produced at runtime by an LLM.
2. All narrative content is generated offline, reviewed, committed, replayable.
3. Availability of any player option is a pure function of player state. Never random.
4. Content generation gets a blind reclassification gate.
5. Compromises are built by the player from intel items. No dialogue option makes a trade for them.

## Roast, still standing

1. **Content volume is the project.** 34 components, ~40 edges, two pattern kinds, facts as a new artifact class. Mitigated by tier 0: a minimal content set that exercises every mechanic once, verified end to end before the full run. See [04](04-content-pipeline.md#tier-0).
2. **Patterns are load bearing.** Health and scheduling both depend on them. A component in no pattern is invisible to health beyond the maturity term. Gate: every component and pipeline edge appears in at least one pattern.
3. **Capping is non-local.** Raising a component may do nothing because of something two hops upstream. Mitigated by feasibility preview from facts, technical objections, and a delta report that names what capped what. Without all three it feels arbitrary.
4. **Nominal versus effective will confuse.** UI must show both where they differ, with the reason.
5. **Coverage denominator.** Do not exclude well covered items. Threshold decides what is shown, not what is counted.
6. **Coverage plus emotions double counts.** Weight emotions low.
7. **Veto must be able to stop you.** Finite Escalation Points, patience, stalemate. Losing a challenge is a legitimate outcome.
8. **Grudges must fire.** Otherwise Soft Pass silently becomes Pass.
9. **Driver versus Boundary phrasing.** Threshold statements sit on the line. Generation phrases Drivers as direction and Boundaries as refusal. Expect most regenerations here.
