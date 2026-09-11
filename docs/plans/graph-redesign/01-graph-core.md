# 01 Graph Core

Depends: [00](00-overview.md). Tracked in [STATE.md](STATE.md).

Backend only. Ships dark. Everything else builds on this.

## New files

```
gameConfig/MlopsGraph.json
gameConfig/MlopsStoryFragments.json
gameConfigSchemas/MlopsGraph.schema.json
game-api/src/mlops_serious_game/domain/graph.py
game-api/src/mlops_serious_game/domain/graph_factory.py
game-api/src/mlops_serious_game/application/graph_service/apply.py
game-api/src/mlops_serious_game/application/graph_service/health.py
game-api/src/mlops_serious_game/application/graph_service/predicates.py
game-api/src/mlops_serious_game/application/graph_service/story.py
game-api/src/mlops_serious_game/application/graph_service/store.py
game-api/tests/test_graph_core.py
```

## Config shape

```json
{
  "levels": ["broken", "absent", "manual", "scripted", "automated", "governed"],
  "nodes": [{
    "id": "data",
    "name": "Data Pipeline",
    "subtitle": "Ingest and ETL",
    "phase_id": 2,
    "weight": 1.0,
    "owner_role": "data_dave",
    "components": [{
      "id": "data.schema_validation",
      "name": "Schema validation",
      "weight": 1.0,
      "initial_level": 1,
      "allowed_levels": [0, 1, 2, 4, 5],
      "attributes": {
        "sourcing":  {"values": ["none", "custom", "open_source", "bought"], "initial": "none"},
        "tool":      {"values": ["none", "great_expectations", "deequ", "inhouse"], "initial": "none"},
        "cadence":   {"values": ["none", "on_commit", "nightly", "streaming"], "initial": "none"}
      }
    }]
  }],
  "instance_kinds": ["dataset", "feature", "model", "endpoint", "pipeline"],
  "instance_states": ["proposed", "active", "stale", "deprecated", "failed"],
  "edges": [{"from": "data", "to": "features"}],
  "thresholds": {"healthy": 75, "degraded": 45, "debt_penalty_per_entry": 6}
}
```

Budget: 7 nodes, 5 to 8 components each, under 50 components total. More than that and coverage scores turn to mush.

Attributes never touch health. They exist for [story.py](#story).

## Domain

```python
class Component:  id, node_id, name, weight, initial_level, allowed_levels, attributes
class GraphNode:  id, name, subtitle, phase_id, weight, owner_role, components
class Instance:   id, kind, node_id, name, state, attrs, links: list[str]
class GraphOp:    kind: Literal["raise_to","set_to","set_attr","instance_upsert","observe"]
                  target, value, source_kind, source_id, phase_id, challenge_id
class DebtEntry:  component_id, intended_level, applied_level, owner_id, challenge_id
class GraphState: levels: dict[str,int]
                  attrs: dict[str, dict[str,str]]
                  instances: dict[str, Instance]
                  debt: list[DebtEntry]
class Knowledge:  seen: dict[str, SeenEntry]   # component_id -> {level, seq, challenge}
                  # state per component derived: unknown | current | stale
```

`source_kind` in `intel`, `action_card`, `world_event`, `challenge_seed`, `admin`.

## Apply rules

- `raise_to` takes max of current and requested. Player actions never silently downgrade.
- `set_to` is forced, used by world events and by owner degradation. Can move down, including to `broken`.
- level must be in `allowed_levels`, otherwise snap down to the nearest allowed value and log it.
- owner degradation: `applied = previous_allowed_level_below(intended)` when `owner_buyin < debt_threshold`. A repair of a `broken` component that gets degraded stays `broken` and records debt.
- `set_attr` and `instance_upsert` are story only, no health effect, no validation beyond enum membership.

### Knowledge fold

Fog of war ([08](08-graph-viz.md)) needs a second fold over the same log.

```python
knowledge(ops) -> Knowledge
```

- `observe` ops record what the player learned and when. Sources: Evidence intel, objections naming a component, engagement card probes, the seeded initial graph, and the player's own card ops
- a `set_to` or degradation on an already seen component does **not** emit an `observe`, so the entry goes `stale`
- derived state: no entry means `unknown`, entry `seq` at or after the last change means `current`, otherwise `stale`

Ground truth and knowledge never mix. Scoring, health, antipatterns and selection always run on ground truth. Knowledge only filters what the player is shown.

All pure. No DB, no IO, no LLM.

## Predicates

One boolean tree evaluator, shared by antipatterns ([03](03-antipatterns-and-selection.md)) and challenge preconditions.

```json
{"all": [
  {"component": "serving.live_endpoint", "op": "gte", "level": 4},
  {"component": "monitoring.drift_detection", "op": "lte", "level": 1},
  {"instance": {"kind": "model", "state": "stale", "op": "exists"}},
  {"not": {"antipattern": "ap_silent_failure"}}
]}
```

Ops: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, plus `exists` and `count` for instances. Combinators `all`, `any`, `not`. Nothing else. Evaluator returns a result plus a per clause trace, used by the admin near miss view.

## Story

`MlopsStoryFragments.json` maps `(component_id, level, attribute combination)` to a sentence. Lookup, no generation.

```json
{"data.schema_validation": {
  "4|sourcing=bought|tool=great_expectations":
    "Great Expectations runs on every commit, licensed and maintained by the vendor."}}
```

Match most specific key first, fall back to level only. Validation gate: every reachable `(component, level)` pair needs at least a level fallback fragment.

## Health

```python
node_health(node)  = 100 * weighted_mean(level/5 for components) - 6*len(debt_on_node) - antipattern_penalty
system_health()    = weighted_mean(node_health, node.weight)
```

## Persistence

Fresh alembic migration. No backward compatibility, database is disposable.

```python
class GraphOpLog(Base):
    id, user_name (idx), phase_index, challenge_index, challenge_loop_index,
    seq, ops (JSON), source_kind, source_id, time_stamp
```

`store.py`: `append_ops`, `load_state`, `snapshot_at(phase, challenge)`.

Seed on `game:init`: one `challenge_seed` op batch from `initial_level` and `initial` attributes of every component.

## Steps

- [ ] 1. Author `MlopsGraph.json` plus schema. 7 nodes, component and attribute taxonomy agreed with content owner.
- [ ] 2. Domain models in `domain/graph.py`, factory mirroring `phase_factory.py`.
- [ ] 3. `apply.py` pure, all five op kinds, degradation, allowed level snapping.
- [ ] 4. `predicates.py` with trace output, unit tested.
- [ ] 5. `health.py`.
- [ ] 6. `story.py` lookup plus validation gate.
- [ ] 7. Alembic migration for `GraphOpLog`, settings key following the `POSTGRES_*_TABLE` pattern.
- [ ] 8. `store.py` fold and snapshot.
- [ ] 8b. Knowledge fold plus `observe` op emission from the seed.
- [ ] 9. Tests: idempotence, max versus forced semantics, broken below absent, degradation, health bands, snapshot replay equals live fold, predicate trace, knowledge goes stale on a world event.
- [ ] 10. Wire seeding into `handle_game_init`. No client payload yet.

## Done when

`pytest tests/test_graph_core.py` green, a fresh player seeds a full graph, nothing visible in the UI.
