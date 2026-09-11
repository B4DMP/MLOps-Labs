# 09 Admin Debug View

Depends: [04](04-content-pipeline.md). Tracked in [STATE.md](STATE.md).

Full graph dump for design and debugging. Tables, no drawing.

## Guard

Reuse the existing admin path: `infrastructure/routes/admin_routes.py`, `auth_service`, `Admin.tsx`. New tab inside the existing admin screen. Extra env gate `settings.ENABLE_GRAPH_DEBUG`, off in the production compose file. Player selector at the top, admins debug other sessions.

## Endpoint

`GET /admin/graph-debug?username=...`

```json
{
  "graph": {"nodes": [...], "components": [...], "attributes": [...], "instances": [...]},
  "state": {"levels": {...}, "attrs": {...}, "debt": [...], "health": {...}},
  "intel_index": [{"component_id": "...", "positions": [...], "evidence": [...],
                   "discovered": [...], "refines_chain": [...]}],
  "objections": [{"id": "...", "stakeholder": "...", "component": "...", "fired": true,
                  "answered_with": "cite_evidence"}],
  "action_cards": [{"id": "...", "template": "...", "components": {...},
                    "amendments": [...], "applied": true, "degraded": [...]}],
  "op_log": [{"seq": 1, "kind": "raise_to", "target": "...", "value": 4,
              "source_kind": "action_card", "source_id": "..."}],
  "challenges": {"played": [...], "eligible_now": [...],
                 "rejected": [{"template_id": "...", "failed_clause": {...}}]},
  "antipatterns": {"active": [...], "near_miss": [{"id": "...", "failed_clause": {...}}]},
  "orphans": {"components_never_targeted": [...], "positions_without_component": [...],
              "levels_without_story_fragment": [...], "objections_never_reachable": [...]}
}
```

`orphans` and `rejected` are the point. They catch content gaps the loader gate misses and explain why the player is stuck on a fallback challenge.

## UI sections

Plain tables, filter box per section, no charts.

1. Nodes: node, owner, health, component count, debt count
2. Components: id, ground truth level, player knowledge state and last seen level, allowed levels, attributes, who targets it, in which phases
3. Instances: id, kind, state, links
4. Intel index: component, requirement, category, subtype, discovered, status, chain
5. Objections: authored, fired, how answered
6. Action cards: card, template, components, amendments, applied, degraded
7. Op log: seq, source, before and after
8. Challenge selection: played, eligible, rejected with the failing clause
9. Antipatterns: active plus near miss with the failing clause
10. Orphans: red list

## Steps

- [ ] 1. Endpoint, admin guard, env flag.
- [ ] 2. Payload assembly from config plus store, including orphan detection.
- [ ] 3. Predicate trace surfaced for rejected challenges and near miss antipatterns.
- [ ] 4. `GraphDebug.tsx` with the ten tables and filters.
- [ ] 5. Tab into `Admin.tsx`.

## Done when

An admin opens one screen and can see every component, who asserts it, what set it, why the current challenge was chosen, and which content is orphaned.
