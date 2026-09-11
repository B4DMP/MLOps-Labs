# 03 Patterns and Challenge Selection

Depends: [01](01-graph-core.md). Tracked in [STATE.md](STATE.md).

Patterns are named graph shapes, good or bad, matched on the technical graph. They do two jobs: set stage health, and schedule challenges.

## Pattern config

`gameConfig/MlopsPatterns.json`, predicates only, evaluator from [01](01-graph-core.md#predicates), effective levels by default.

```json
{
  "id": "ap_silent_failure",
  "kind": "anti",
  "name": "Silent Model Failure",
  "when": {"all": [
    {"component": "deploy.serving", "op": "gte", "level": 4},
    {"component": "ops.drift_monitoring", "op": "lte", "level": 1}
  ]},
  "stage_effects": {"ops": -15, "deploy": -10},
  "story": "Predictions keep flowing. Nobody can tell whether they are still right.",
  "tags": ["monitoring", "reliability"]
}
```

```json
{
  "id": "dp_continuous_training",
  "kind": "design",
  "name": "Continuous Training",
  "when": {"all": [
    {"edge": "e.alert_retrain", "op": "gte", "level": 4},
    {"edge": "e.alert_retrain", "trigger": "eq", "value": "on_alert"},
    {"component": "model.training_pipeline", "op": "gte", "level": 4},
    {"component": "model.evaluation", "op": "gte", "level": 4}
  ]},
  "stage_effects": {"model": 12, "ops": 8},
  "story": "Drift raises an alert, the alert starts a retrain, the evaluation gate decides.",
  "tags": ["automation"]
}
```

Starter set, roughly 12 anti and 12 design. Anti: silent failure, training serving skew, glue code, pipeline jungle, manual deployment, undocumented handover, orphaned model, unversioned data, alert fatigue, no rollback, cost blindness, shadow IT access. Design: continuous training, reproducible training, gated promotion, canary release, feature reuse, data contracts enforced, observability first, IaC everywhere, least privilege, model cards on promotion, automated rollback, versioned lineage.

Edges make patterns expressive: "continuous training" is a statement about a trigger on a feedback edge, not about any single component.

## Health contribution

```python
stage_bonus(stage)   = sum(p.stage_effects[stage] for p in active if p.kind == "design")
stage_penalty(stage) = sum(-p.stage_effects[stage] for p in active if p.kind == "anti")
```

Plugged into the stage health formula in [00](00-overview.md#health). Active set recomputed every fold, never stored.

Gate: every component and every pipeline edge appears in at least one pattern. Otherwise raising it only moves the maturity term.

## Challenge templates

`GameProgression.json` challenges become templates:

```json
{
  "template_id": "ch_data_quality_crisis",
  "phase_id": 2,
  "priority": 60,
  "preconditions": {"any": [
    {"pattern": "ap_unversioned_data"},
    {"all": [{"not": {"pattern": "dp_data_contracts"}},
             {"component": "data.validation", "op": "lte", "level": 2}]}
  ]},
  "excluded_if": {"pattern": "ap_silent_failure"},
  "on_enter_ops": [
    {"kind": "set_to", "target": "e.ingest_validate", "value": 0, "reason": "nightly job died"}
  ],
  "stalemate_ops": [
    {"kind": "set_to", "target": "data.validation", "value": 0, "reason": "nobody owned it, it rotted"}
  ],
  "conflict": {
    "type": "soft",
    "target": "data.feature_store",
    "positions": [{"stakeholder_id": "data_dave", "wants": 5},
                  {"stakeholder_id": "efficiency_emilia", "wants": 2}]
  },
  "focus_stage_ids": ["data"],
  "repeatable": false
}
```

- `preconditions` reference patterns first. Both kinds: a missing design pattern is as good a reason for a challenge as a present antipattern. Raw level clauses allowed where no pattern fits.
- `on_enter_ops` move the world without the player, before intel gathering, so artifacts can mention it.
- `stalemate_ops` fire when the pitch ends in stalemate.
- `conflict.type`: `soft` means the losing side holds a Trade-off on the target, solvable by preparation. `hard` means the losing side holds a Boundary on it, someone loses or the player spends Escalation. Difficulty lever.

## Selection

```python
def select_challenge(state, phase_id, played, seed) -> ChallengeTemplate:
    pool = [c for c in phase_challenges(phase_id)
            if (c.template_id not in played or c.repeatable)
            and evaluate(c.preconditions, state)
            and not evaluate(c.excluded_if, state)]
    pool = pool or [fallback_challenge(phase_id)]
    return max(pool, key=lambda c: (c.priority, stable_hash(seed, c.template_id)))
```

Deterministic. Seed from player name. One fallback per phase with `preconditions: true`, lowest priority.

Coverage test walks a few hundred plausible graph states and asserts each phase reaches at least three templates.

## Steps

- [ ] 1. `MlopsPatterns.json` plus schema, about 12 anti and 12 design.
- [ ] 2. Pattern evaluation plus stage bonus and penalty in `stage_graph.py`.
- [ ] 3. Template schema: `template_id`, preconditions, `excluded_if`, `on_enter_ops`, `stalemate_ops`, `conflict` with type, priority, fallback.
- [ ] 4. `select_challenge` plus stable seeding in `phase_factory.py`.
- [ ] 5. Fire `on_enter_ops` at challenge start as `world_event`.
- [ ] 6. Store resolved `template_id` on `GameChallenge`.
- [ ] 7. Gates: fallback per phase, references exist, every component and pipeline edge in a pattern.
- [ ] 8. Selection coverage test.

## Done when

Two graph states give different challenges in the same phase, a missing design pattern can schedule a challenge, and completing a design pattern visibly lifts stage health.
