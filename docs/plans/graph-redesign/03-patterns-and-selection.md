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
    {"component": "deploy.serving", "op": "gte", "level": 3},
    {"component": "ops.production_drift_monitoring", "op": "lte", "level": 1}
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
    {"edge": "e.alert_retrain", "op": "gte", "level": 3},
    {"edge": "e.alert_retrain", "trigger": "eq", "value": "on_alert"},
    {"component": "model.training_pipeline", "op": "gte", "level": 3},
    {"component": "model.evaluation", "op": "gte", "level": 3}
  ]},
  "stage_effects": {"model": 12, "ops": 8},
  "story": "Drift raises an alert, the alert starts a retrain, the evaluation gate decides.",
  "tags": ["automation"]
}
```

Shipped: 14 anti, 17 design (v3.2 added underperforming model live, stale training data, trusted data, which read instance properties). Starter list below. Anti: silent failure, training serving skew, glue code, pipeline jungle, manual deployment, undocumented handover, orphaned model, unversioned data, alert fatigue, no rollback, cost blindness, shadow IT access. Design: continuous training, reproducible training, gated promotion, canary release, feature reuse, data contracts enforced, observability first, IaC everywhere, least privilege, model cards on promotion, automated rollback, versioned lineage.

Edges make patterns expressive: "continuous training" is a statement about a trigger on a feedback edge, not about any single component.

## Health contribution

```python
stage_bonus(stage)   = sum(p.stage_effects[stage] for p in active if p.kind == "design")
stage_penalty(stage) = sum(-p.stage_effects[stage] for p in active if p.kind == "anti")
```

Plugged into the stage health formula in [00](00-overview.md#health): 100 plus design bonuses minus antipattern penalties, targets broken in themselves (D35) and debt. Design patterns buffer damage, they cannot lift a stage above 100. Active set recomputed every fold, never stored.

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
    "positions": [{"stakeholder_id": "data_dave", "wants": 4},
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

The 5 original hand-written challenges for phases 1 to 5 (`ch_platform_choice`, `ch_data_instability`,
`ch_entanglement`, `ch_automation_risk`, `ch_accuracy_drop`) are now flagged `"retired": true` in
`GameProgression.json` since tier 1 content gave each of those phases two generated challenges that
are always eligible from a fresh graph. A retired challenge is still the phase's structural fallback
(`validate_templates` only checks that exactly one `fallback` entry exists per phase, not that it is
usable), but `select_in_phase` skips it, fallback or not, so it is never dealt. This reopens the gap
`fallback_challenge` exists to close: if a phase's generated challenges ever both fail their
preconditions (an unusual prior-choice sequence), that phase now deals nothing for that pick instead
of falling back to retired content. TODO: generate a proper tier1-style fallback replacement for each
of these 5 phases so the safety net is real content again, then either un-retire or delete the old ones.

## Steps

- [x] 1. `MlopsPatterns.json` plus schema, about 12 anti and 12 design.
- [x] 2. Pattern evaluation plus stage bonus and penalty in `stage_graph.py`.
- [x] 3. Template schema: `template_id`, preconditions, `excluded_if`, `on_enter_ops`, `stalemate_ops`, `conflict` with type, priority, fallback.
- [x] 4. Selection plus stable seeding in `application/graph_service/scheduler.py` (not `phase_factory.py`: it needs predicates and graph state). Wired into `handle_state_update_request` as `select_next_challenge`, falls back to sequential order if the graph cannot be read.
- [x] 5. Fire `on_enter_ops` at challenge start as `world_event`.
- [x] 6. No new column: challenge int ids are unique and map 1:1 to `template_id`, so `GameChallenge.challenge_index` already identifies the template. The graph log stores `template_id`.
- [x] 7. Gates: fallback per phase, references exist (on config load). Pattern coverage of every component and pipeline edge is asserted by `tests/test_graph_patterns.py`.
- [x] 8. `reachable_templates` utility plus fixture test. The real-content assertion (three templates per phase) moves to the tier 0 gates in [04](04-content-pipeline.md): today's content has one challenge per phase.

## Done when

Two graph states give different challenges in the same phase, a missing design pattern can schedule a challenge, and completing a design pattern visibly lifts stage health.
