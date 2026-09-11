# 09 Admin Debug View

Depends: [04](04-content-pipeline.md). Tracked in [STATE.md](STATE.md).

Full technical graph dump for design and debugging. Tables, no drawing.

## Guard

Existing admin path: `infrastructure/routes/admin_routes.py`, `auth_service`, `Admin.tsx`. New tab in the admin screen. Env gate `settings.ENABLE_GRAPH_DEBUG`, off in the production compose file. Player selector at the top.

## Endpoint

`GET /admin/graph-debug?username=...`

```json
{
  "stages": [{"id": "...", "health": 52, "maturity_term": 34, "pattern_terms": {...}, "debt": 1}],
  "components": [{"id": "...", "nominal": 4, "effective": 2, "capped_by": "...", "owner": "...",
                  "attrs": {...}, "knowledge": "stale", "seen_level": 3}],
  "edges": [{"id": "...", "from": "...", "to": "...", "kind": "pipeline", "level": 2,
             "effective": 2, "trigger": "manual_request", "knowledge": "unknown"}],
  "instances": [...],
  "patterns": {"active": [...], "near_miss": [{"id": "...", "failed_clause": {...}}]},
  "intel_index": [{"target": "...", "chains": [{"tag": "driver", "stakeholder": "...", "links": [...],
                   "discovered": [...], "status": "open"}]}],
  "objections": [{"id": "...", "kind": "technical", "stakeholder": "...", "target": "...",
                  "fired": true, "answered_with": "amend"}],
  "action_cards": [{"id": "...", "template": "...", "change": [...], "price": [...],
                    "amendments": [...], "outcome": "soft_pass", "degraded": [...]}],
  "op_log": [{"seq": 1, "kind": "raise_to", "target": "...", "value": 4, "source_kind": "action_card"}],
  "challenges": {"played": [...], "eligible_now": [...],
                 "rejected": [{"template_id": "...", "failed_clause": {...}}]},
  "orphans": {"targets_in_no_pattern": [...], "targets_never_in_a_driver": [...],
              "levels_without_story_fragment": [...], "objections_never_reachable": [...],
              "facts_on_nonexistent_targets": [...]}
}
```

`orphans`, `rejected` and `near_miss` are the point: content gaps and "why this challenge, why not that one".

## UI sections

Plain tables, filter box per section.

1. Stages: health broken down into maturity term, pattern terms, debt
2. Components: nominal, effective, capped by, owner, attributes, player knowledge next to ground truth
3. Edges: from, to, kind, level, effective, trigger, player knowledge
4. Instances
5. Patterns: active, near miss with failing clause
6. Intel index by target, chains with discovery state
7. Objections: authored, fired, how answered
8. Action cards: sections, amendments, outcome, degraded
9. Op log
10. Challenge selection: played, eligible, rejected with failing clause
11. Orphans

## Steps

- [ ] 1. Endpoint, admin guard, env flag.
- [ ] 2. Payload assembly including health breakdown and orphan detection.
- [ ] 3. Predicate traces for rejected challenges and near miss patterns.
- [ ] 4. `GraphDebug.tsx` with the eleven tables.
- [ ] 5. Tab into `Admin.tsx`.

## Done when

An admin sees every component and edge, ground truth next to player knowledge, why each stage has its health, and why the current challenge was chosen.
