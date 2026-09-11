# 01 Graph Core

Depends: [00](00-overview.md). Tracked in [STATE.md](STATE.md).

Backend only. Ships dark. Everything else builds on this.

## New files

```
gameConfig/MlopsGraph.json               technical graph: stages, components, edges
gameConfig/MlopsStoryFragments.json
gameConfigSchemas/MlopsGraph.schema.json
game-api/src/mlops_serious_game/domain/graph.py
game-api/src/mlops_serious_game/domain/graph_factory.py
game-api/src/mlops_serious_game/application/graph_service/apply.py
game-api/src/mlops_serious_game/application/graph_service/effective.py
game-api/src/mlops_serious_game/application/graph_service/stage_graph.py
game-api/src/mlops_serious_game/application/graph_service/predicates.py
game-api/src/mlops_serious_game/application/graph_service/knowledge.py
game-api/src/mlops_serious_game/application/graph_service/story.py
game-api/src/mlops_serious_game/application/graph_service/store.py
game-api/tests/test_graph_core.py
```

## Technical graph config

```json
{
  "levels": ["broken", "absent", "manual", "scripted", "automated", "governed"],
  "triggers": ["none", "manual_request", "scheduled", "on_commit", "on_data_arrival",
               "on_new_version", "on_metric_threshold", "on_alert", "on_approval"],
  "stages": [
    {"id": "data", "name": "Data", "phase_id": 2, "weight": 1.0, "owner_role": "data_dave", "band": false},
    {"id": "gov",  "name": "Governance and Infra", "phase_id": null, "weight": 0.7, "owner_role": null, "band": true}
  ],
  "components": [{
    "id": "data.validation",
    "stage_id": "data",
    "name": "Data Validation",
    "owner_role": null,
    "weight": 1.0,
    "initial_level": 1,
    "allowed_levels": [0, 1, 2, 4, 5],
    "attributes": {
      "sourcing": {"values": ["none", "custom", "open_source", "bought"], "initial": "none"},
      "tool":     {"values": ["none", "great_expectations", "deequ", "inhouse"], "initial": "none"}
    }
  }],
  "edges": [{
    "id": "e.ingest_validate",
    "from": "data.ingestion",
    "to": "data.validation",
    "kind": "pipeline",
    "slack": 0,
    "initial_level": 2,
    "initial_trigger": "manual_request",
    "allowed_levels": [0, 1, 2, 3, 4],
    "allowed_triggers": ["manual_request", "scheduled", "on_data_arrival"]
  }],
  "thresholds": {"healthy": 75, "degraded": 45, "debt_penalty_per_entry": 6}
}
```

`owner_role: null` on a component means the stage owner. Cadence is no longer a component attribute. It is the edge trigger.

## Components (v3 starting set)

Reviewer list plus a Requirements stage. Ids are `stage.name`.

```
req    kpi_definition, acceptance_criteria, data_contracts, risk_assessment
data   ingestion, validation, feature_store, versioning, labeling, training_drift_check
model  experiment_tracking, registry, training_pipeline, hpo, evaluation
deploy cicd, serving, canary_ab, shadow, containerization, orchestration, api_gateway
ops    performance_monitoring, production_drift_monitoring, alerting, observability, retraining_trigger, rollback
gov    iam, audit, model_cards, cost_monitoring, iac, compute_scheduling
```

34 components. D25, D26: `model.registry` includes model versioning. The drift pair stays split and is named by when it runs: `data.training_drift_check` compares a new training batch against the reference before training, `ops.production_drift_monitoring` watches live inputs and predictions after deployment.

## Edges

| kind | meaning | caps downstream | in DAG check |
|---|---|---|---|
| `pipeline` | a workflow moving artefacts between components | yes | yes |
| `feedback` | monitoring back into training or rollback | no | no |
| `governs` | a gov component attached to what it controls | no | no |

Edges carry a maturity `level` and a `trigger`. An edge at `absent` means nobody moves the artefact. At `manual` someone does it by hand on request. At `automated` with `on_data_arrival` it runs itself.

Starting skeleton, pipeline edges:

```
data.ingestion -> data.validation -> data.versioning -> data.feature_store -> model.training_pipeline
data.labeling -> data.versioning
model.hpo -> model.training_pipeline -> model.experiment_tracking
model.training_pipeline -> model.evaluation -> model.registry
model.registry -> deploy.cicd -> deploy.containerization -> deploy.orchestration -> deploy.serving -> deploy.api_gateway
deploy.cicd -> deploy.canary_ab -> deploy.serving
deploy.cicd -> deploy.shadow
deploy.serving -> ops.observability -> ops.performance_monitoring -> ops.alerting
ops.observability -> ops.production_drift_monitoring -> ops.alerting
data.versioning -> data.training_drift_check -> model.training_pipeline
req.data_contracts -> data.ingestion
req.risk_assessment -> req.acceptance_criteria -> model.evaluation
```

Feedback: `ops.alerting -> ops.retraining_trigger -> model.training_pipeline`, `ops.alerting -> ops.rollback -> deploy.serving`.

Governs: `gov.*` to the components they control, for example `gov.iam -> deploy.api_gateway`, `gov.compute_scheduling -> model.training_pipeline`. Also `req.risk_assessment -> gov.audit` and `req.risk_assessment -> gov.model_cards`.

Slack defaults (D28): `0` on the core flow from data through model to serving, so a break there propagates in full. `1` on side edges such as experiment tracking and requirement feeds. Per edge in config, tunable in playtest.

## Effective level

Computed in topological order over pipeline edges. Pure.

```python
cap(e)          = min(effective(e.from), e.level) + e.slack        # slack 0 hard dependency, 1 soft
effective(c)    = min(nominal(c), min(cap(e) for e in incoming pipeline edges of c), default=nominal(c))
effective(e)    = min(e.level, effective(e.from) + 1)               # an edge cannot outrun its source
```

A missing (`absent`) step is skipped: whatever reaches it passes straight through, and a missing step with nothing upstream constrains nothing. A `broken` step blocks: it supplies 0 downstream. Without this, one absent component mid-chain would starve the whole pipeline, which is exactly what the starting graph looked like before the fix.

Consequences:
- **Level capping.** A `governed` training pipeline fed by a manual feature store hand-off delivers `manual`.
- **Propagation.** A world event breaking `data.ingestion` drags everything downstream on hard edges.
- **Explainability.** Every cap records its binding constraint: `capped_by: {edge or component, value}`. Delta report and UI read this.

Validation gate: pipeline edges form a DAG.

## Stage graph

Derived, never stored. `stage_graph.py`:

```python
stage_graph(tech, state) -> {stages: [{id, health, maturity, patterns_active, debt}],
                             flows: [{from_stage, to_stage, level, weakest_edge_id}]}
```

Stage flow level is the weakest pipeline edge crossing that stage boundary. Stage health formula in [00](00-overview.md), pattern terms from [03](03-patterns-and-selection.md).

## Domain

```python
class Stage:      id, name, phase_id, weight, owner_role, band
class Component:  id, stage_id, name, owner_role, weight, initial_level, allowed_levels, attributes
class Edge:       id, from_id, to_id, kind, slack, initial_level, initial_trigger, allowed_levels, allowed_triggers
class Instance:   id, kind, component_id, name, state, attrs, links
class GraphOp:    kind: Literal["raise_to", "set_to", "set_trigger", "set_attr", "instance_upsert", "observe"]
                  target, value, source_kind, source_id, phase_id, challenge_template
class DebtEntry:  target_id, intended_level, applied_level, owner_id, challenge_template
class GraphState: component_levels, edge_levels, edge_triggers, attrs, instances, debt
class Knowledge:  seen: dict[target_id, SeenEntry]     # level, trigger or attrs seen, seq
```

`raise_to` and `set_to` target components or edges. `source_kind` in `intel`, `action_card`, `world_event`, `challenge_seed`, `admin`.

## Apply rules

- `raise_to` takes max, never silently downgrades
- `set_to` is forced, world events and owner degradation, can reach `broken`
- level snaps down to the nearest `allowed_levels` value, logged
- owner degradation: `applied = previous allowed level below intended` when owner buy-in is under the debt threshold. Resolved once, when the card is applied: the logged op carries `intended`, so replay needs no buy-in and always reproduces the same debt
- `set_trigger` and `set_attr` validate enum membership. Attributes stay out of health but Boundaries may read them ([02](02-intel-taxonomy.md))

## Knowledge fold

Second fold over the same log. Rules in [00](00-overview.md#fog-of-war).

- `observe` ops carry what was seen: level, trigger, attributes of one target
- seed emits the topology only, plus `observe` for the briefing facts. Everything else starts `unknown`
- the player's own card emits `observe` for every target it touched, after simulation, on effective values
- `set_to` and degradation emit no `observe`, so seen entries go `stale`

## Predicates

One boolean tree evaluator, used by patterns, Boundaries, challenge preconditions.

```json
{"all": [
  {"component": "deploy.serving", "op": "gte", "level": 4, "on": "effective"},
  {"edge": "e.alert_retrain", "op": "lte", "level": 1},
  {"edge": "e.ingest_validate", "trigger": "eq", "value": "manual_request"},
  {"attr": "deploy.serving.hosting", "op": "ne", "value": "public_cloud"},
  {"not": {"pattern": "ap_silent_failure"}}
]}
```

Ops `eq ne lt lte gt gte`, `exists` and `count` for instances, combinators `all any not`. `on` defaults to `effective`. Returns result plus per clause trace.

## Story

`MlopsStoryFragments.json`, lookup keyed by target, level, and trigger or attribute combination, most specific first. Generic per-level templates for components and edges are the fallback, and the loader requires them for every level. Coverage of target-specific fragments is reported by `missing_specific_fragments` and enforced as a content gate in [04](04-content-pipeline.md), scoped to tier 0. `StoryFactory` lives in `domain/story_factory.py` so config loading never imports the application layer.

## Persistence

Fresh alembic migration. Database disposable.

```python
class GraphOpLog(Base):
    id, user_name (idx), phase_index, challenge_template, challenge_loop_index,
    seq, ops (JSON), source_kind, source_id, time_stamp
```

`store.py`: `append_ops`, `load_state`, `load_knowledge`, `snapshot_at(phase, template)`.

## Steps

- [x] 1. Author `MlopsGraph.json` plus schema: stages, 34 components, edge skeleton with slack defaults, triggers, allowed levels. Content owner review pending, see Q20 in STATE.
- [x] 2. Domain models, factory mirroring `phase_factory.py`.
- [x] 3. `apply.py`: six op kinds, degradation, snapping.
- [x] 4. `effective.py`: topological effective levels, `capped_by` trace, DAG gate.
- [x] 5. `predicates.py` with trace, including edge, trigger, attr clauses.
- [x] 6. `stage_graph.py`: stage flows, maturity term. Pattern terms plug in from 03.
- [x] 7. `knowledge.py` fold.
- [x] 8. `story.py` plus fragment gate.
- [x] 9. Migration for `GraphOpLog`, `store.py`.
- [x] 10. Tests: max versus forced, broken below absent, capping on hard and soft edges, propagation after a break, feedback edges ignored by the DAG, knowledge stale after a world event, replay equals live fold.
- [x] 11. Seed on `handle_game_init`. No client payload yet.
- [x] 12. Addendum: `aliases` and `retired` in the graph config plus `tools/graph_refactor.py` (`refs`, `usage`, `check`, `rename`, `retire`), so graph edits after content exists stay cheap. Logged ops follow renames on replay.

## Done when

`pytest tests/test_graph_core.py` green, a fresh player seeds a full technical graph, breaking ingestion visibly caps downstream components in a test.
