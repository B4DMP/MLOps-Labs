# 03 Antipatterns and Challenge Selection

Depends: [01](01-graph-core.md). Tracked in [STATE.md](STATE.md).

Graph state picks the next challenge. Broken graph states get names and drag health.

## Antipatterns

`gameConfig/MlopsAntipatterns.json`, predicates only, evaluator from [01](01-graph-core.md).

```json
{
  "id": "ap_silent_failure",
  "name": "Silent Model Failure",
  "description": "Model serves live traffic with no drift detection.",
  "when": {"all": [
    {"component": "serving.live_endpoint", "op": "gte", "level": 4},
    {"component": "monitoring.drift_detection", "op": "lte", "level": 1}
  ]},
  "penalty": {"monitoring": 15, "serving": 10},
  "resolved_by": ["monitoring.drift_detection"],
  "story": "Predictions keep flowing. Nobody can tell whether they are still right."
}
```

Active set is recomputed on every fold, never stored. Starter set of 8 to 12, including glue code, silent failure, training serving skew, pipeline jungle, undocumented handover, manual deployment.

## Challenges become templates

`GameProgression.json` challenges gain:

```json
{
  "template_id": "ch_data_quality_crisis",
  "phase_id": 2,
  "priority": 60,
  "preconditions": {"any": [
    {"antipattern": "ap_data_rot"},
    {"component": "data.schema_validation", "op": "lte", "level": 1}
  ]},
  "excluded_if": {"antipattern": "ap_silent_failure"},
  "on_enter_ops": [
    {"kind": "set_to", "target": "data.ingest_automation", "value": 0, "reason": "nightly job died"}
  ],
  "stalemate_ops": [
    {"kind": "set_to", "target": "data.schema_validation", "value": 0, "reason": "nobody owned it, it rotted"}
  ],
  "conflict": {"component": "data.retention_policy",
               "positions": [{"stakeholder_id": "data_dave", "wants": 5},
                             {"stakeholder_id": "efficiency_emilia", "wants": 2}]},
  "focus_node_ids": ["data"],
  "repeatable": false
}
```

`challenge_id` as a positional index is gone. `template_id` is the content key. `GameChallenge.challenge_index` in the database stores the resolved template id per play.

`on_enter_ops` is how the world moves without the player. Something breaks, or a neighbouring team lands something that helps. Fires before intel gathering so artifacts can talk about it.

`stalemate_ops` fires when the pitch ends in stalemate, see [06](06-merged-phase.md). The problem does not wait for the meeting to finish.

`conflict` formalises the two stakeholder disagreement that already frames every challenge today. It is the same narrative beat, expressed as two opposing target levels on one component, which is what the Trade and Stonewall dialogue options read.

## Selection

```python
def select_challenge(graph_state, phase_id, played_template_ids, seed) -> ChallengeTemplate:
    pool = [c for c in phase_challenges(phase_id)
            if c.template_id not in played_template_ids or c.repeatable
            if evaluate(c.preconditions, graph_state)
            if not evaluate(c.excluded_if, graph_state)]
    if not pool:
        pool = [fallback_challenge(phase_id)]
    return max(pool, key=lambda c: (c.priority, stable_hash(seed, c.template_id)))
```

Deterministic. Same graph state plus same seed always gives the same challenge, so runs are reproducible and debuggable. Seed is derived from the player name.

Every phase needs exactly one fallback with `preconditions: true` and the lowest priority. Validation gate enforces it.

## Coverage of the precondition space

Risk: a graph state that matches nothing but the fallback every time, so the game feels static. Mitigation: a coverage test that walks a few hundred plausible graph states and asserts each phase reaches at least three distinct templates. Lives in `tests/test_challenge_selection.py`.

## Steps

- [ ] 1. `MlopsAntipatterns.json` plus schema, 8 to 12 rules.
- [ ] 2. Hook antipattern penalties into `node_health`.
- [ ] 3. Challenge template schema change: `template_id`, preconditions, `on_enter_ops`, `stalemate_ops`, `conflict`, priority, fallback flag.
- [ ] 4. `select_challenge` plus stable seeding in `phase_factory.py`.
- [ ] 5. Fire `on_enter_ops` at challenge start, log with `source_kind: world_event`.
- [ ] 6. Store resolved `template_id` on `GameChallenge`, migration.
- [ ] 7. Validation gate: one fallback per phase, all referenced components and antipatterns exist.
- [ ] 8. Selection coverage test.

## Done when

Two players with different graph states get different challenges in the same phase, the same player replaying a state gets the same challenge, and a challenge can break something on entry.
