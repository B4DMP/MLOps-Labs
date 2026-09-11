# 00 Overview and Decisions

Progress tracked in [STATE.md](STATE.md). Supersedes [../pitch-debate-redesign.md](../pitch-debate-redesign.md), which stays as motivation and notation reference.

## Goal

Everything points at one shared object: the MLOps Environment Graph. Intel asserts graph facts. Action cards change the graph. Challenges are picked by graph state. Stakeholders own graph nodes. Antipatterns are broken graph states. Player sees graph health.

## Core decision: components are levels, not free text

```
component id:  data.schema_validation
level:         0 broken | 1 absent | 2 manual | 3 scripted | 4 automated | 5 governed
op:            raise_to(component, level)   player actions, max semantics
               set_to(component, level)     world events, forced, can go down
```

Level is the only thing that drives health, coverage and antipatterns. Equality is string equality. No LLM, no embeddings in any scoring path. LLM writes prose only, and gets the component list handed to it as fact.

`broken` sits below `absent` on purpose. A failing check that nobody trusts is worse than no check, because it buys false confidence. World events and unhappy owners push things to `broken`.

## Three layers in the graph

| layer | drives | example |
|---|---|---|
| node | health rollup, ownership | `data` |
| component | health, coverage, objections, antipatterns | `data.schema_validation` level 4 |
| attributes | story only, never health | `sourcing: bought`, `tool: Great Expectations`, `version: 0.18` |
| instances | story plus antipattern predicates, never coverage | `dataset:crm_orders` state `stale` |

Attributes and instances exist so the same graph state always produces the same story. Prose comes from a lookup table keyed by enum values, not from an LLM guess.

Instances are typed entities that come and go: `dataset`, `feature`, `model`, `endpoint`, `pipeline`. They link to each other, so predicates like "endpoint serves a model trained on a stale dataset" become expressible. Instances stay out of the buy-in math in v1.

## Fog of war

The player sees what they observed, not ground truth. Per component: `unknown`, `current`, or `stale`. Observation comes from Evidence intel, objections, engagement card probes, the seeded starting graph, and the player's own card. World events and owner degradation flip an observed component to `stale` without telling anyone. Node health with anything unobserved renders as a band, not a number.

Scoring, health, antipatterns and challenge selection always run on ground truth. Knowledge only filters what is shown. Details in [08](08-graph-viz.md).

## Nodes (v1)

| node | subtitle | phase | owner role |
|---|---|---|---|
| requirements | specs and reqs | 1 | requirements_reuben |
| data | ingest and ETL | 2 | data_dave |
| features | offline / online store | 2 | data_dave |
| model | train and registry | 3 | model_monica |
| deployment | containers and CD | 4 | automation_alex |
| serving | live predictions | 4 | efficiency_emilia |
| monitoring | drift and feedback | 5 | reliability_ruth |

Owner filled per phase from `GameProgression.stakeholders`, config default as fallback.

## State model

Append-only op log per player. State is a pure fold. Gives replay, snapshots, delta reports and the admin view for free. Cache the fold, never trust the cache.

Database is disposable during development. Schema changes drop and rebuild. No legacy shims for new fields.

## Intel taxonomy rework

Three categories, two subtypes each, each with a distinct mechanical consumer. Full design in [02](02-intel-taxonomy.md).

```
Position  -> Mandate | Preference          feeds the action card, coverage, objections
Evidence  -> System State | Constraint     feeds graph knowledge, citable in objections
Leverage  -> Motivation | Alliance         feeds convincer fit and coalitions
```

Only Position items go into card slots. That makes mis-tagging expensive and teaches the distinction.

## Loop after change

1. **Challenge selection.** Graph state matched against challenge preconditions. Deterministic pick. Challenge may fire world event ops on entry, so things break or land without the player.
2. **Offline intel gathering.** Artifacts tagged with the new taxonomy.
3. **Merged pitch phase.** Attention tokens buy engagement cards. Player assembles a card: 5 Position items, main convincer profile, optional secondary. Assembling is free, only preparation costs. Not locked in yet.
4. **Objection round.** Pre-authored objections fire deterministically. Player answers each with a dialogue option whose availability is a pure function of what they did earlier. Player may amend the card here, then commit. Outcome is Pass, Soft Pass, or Veto. A veto is cleared with an Escalation Point or by rebuilding a materially different card at the cost of stakeholder patience. Patience exhausted means Stalemate, and the challenge resolves badly without the player.
5. **Simulation phase.** Card applied to the graph, unhappy owners degrade what they dislike, tech debt recorded, world events resolve, grudges and promises fire, antipatterns recomputed, delta report shown. This replaces the current empty `ac_simulation` mock.
6. Next challenge selected from the new graph state.

## Tech debt

Owner unhappy at apply time means the change lands one level lower, floor `broken` only if the intent was a repair of a broken component.

```
debt entry = {component, intended, applied, owner_id, challenge}
```

Debt drags node health, can flip an antipattern, cleared by a later card on the same component with a happy owner.

## Health

```
node_health   = 100 * weighted_mean(level / 5) - debt_penalty - antipattern_penalty
system_health = weighted_mean(node_health, node.weight)
```

Bands: >75 healthy, >45 degraded, else broken. Matches the reference mock at `asmodiel.de/stakeholder-showdown/pipeline.html`.

## What is being deleted

- `personal_friction`, `requirement`, `negotiable_preference` tag set
- `determine_dialogue_options` randomized option list. Dialogue survives, randomness does not.
- LLM-estimated metric changes. Metrics derive from graph delta.
- challenge ordering by fixed index. Challenges are now picked by precondition.

## Standing rules

0. Scope cut on purpose goes in [BACKLOG.md](BACKLOG.md), never silently dropped.
1. Nothing that affects score, buy-in, health or selection may be produced at runtime by an LLM.
2. All narrative content is generated offline, reviewed, committed, and replayable.
3. Availability of any player option is a pure function of player state. Never random.
4. Content generation gets a blind reclassification gate: a second pass must recover the authored label from the artifact alone, otherwise regenerate.

## Roast, still standing

1. **Content volume is now the project.** Precondition-driven challenge selection means authoring 3 to 5 challenges per phase instead of a fixed sequence, each with requirements, artifacts and objections. Roughly 4 to 6 times the current content. Plan [04](04-content-pipeline.md) exists because of this. If the generation pipeline is not solid, nothing else ships.
2. **Instances can eat the schedule.** They are the most attractive and least load bearing part of this design. Keep them out of coverage math and out of v1 player actions.
3. **Coverage denominator.** Do not exclude well covered objections from the mean. Threshold decides what is shown, not what is counted.
4. **Coverage plus emotions double counts.** Engagement cards move both. Weight emotions low.
5. **Six levels per component is a lot of authoring.** Not every component needs all six. Config allows a per component `allowed_levels` subset.
6. **Attribute driven story only pays off if the tables are written.** An attribute with no story fragment is dead weight in the config. Validation gate rejects it.
7. **Veto has to be able to actually stop you.** An auto-pass on the second attempt makes the veto free to ignore. Instead: Escalation Points are finite (3 per game), rebuilds cost patience, and running out ends the challenge in Stalemate with a detrimental world event. Losing a challenge is a legitimate outcome, and it is the only thing that makes the veto mean anything.
8. **Grudges need to actually fire.** Soft Pass is only meaningful if the neglected low power stakeholder does something later. If grudge resolution slips out of [07](07-simulation-phase.md), Soft Pass silently becomes Pass and low power stakeholders are free to ignore.
9. **The generation harness is infrastructure, not a script.** Resumable, hash invalidated, budget capped. Half of [04](04-content-pipeline.md) is that harness, and it is worth it at 700 plus generated items.
