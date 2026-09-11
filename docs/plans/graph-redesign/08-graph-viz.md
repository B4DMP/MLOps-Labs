# 08 Player Graph View

Depends: [01](01-graph-core.md). Tracked in [STATE.md](STATE.md).

Player sees the stage graph always and the technical graph through fog. Reference mock: `asmodiel.de/stakeholder-showdown/pipeline.html`.

## Placement

`PipelineTab` next to `MetricTab` in the top navbar, every loop step. Collapsed strip by default, expands to a modal.

## Strip: stage graph

`game-ui/src/components/PipelineView.tsx`.

- 5 pipeline stages left to right, Governance and Infra as a band underneath
- stage box tinted by health band, number or band per fog rules
- stage to stage flow line coloured by the weakest crossing pipeline edge
- feedback arcs from Monitoring and Ops back to Modeling and Deployment
- badges: active antipatterns, active design patterns

## Modal: technical graph of one stage

Click a stage to open its technical slice.

- components as boxes, internal pipeline edges as arrows, incoming and outgoing edges to neighbouring stages stubbed at the border
- component: nominal and effective level pips, shown separately only when they differ, with the cap named on hover
- edge: maturity level on the arrow, trigger as an icon (manual hand, clock, commit, data arrival, alert, approval)
- `broken` red and distinct from `absent`
- story fragment line per component and edge
- owner avatar per component via `StakeholderAvatarComponent`
- debt marked amber with the blocking stakeholder
- instances listed with their state
- patterns touching this stage with their story line
- before and after toggle, fed by the delta report from [07](07-simulation-phase.md)

Static SVG with a hand authored layout per stage in config (`x`, `y` per component). About 6 to 7 components per stage, no layout library needed.

## Fog of war

Rules in [00](00-overview.md#fog-of-war). Rendering:

| knowledge | component | edge |
|---|---|---|
| `unknown` | outlined box, no pips, "?" | dashed arrow, no trigger icon |
| `current` | pips and story line | solid arrow, level, trigger icon |
| `stale` | last seen pips, dimmed, "as of challenge N" | last seen, dimmed |

Topology is always drawn. Stage health with unknown or stale parts renders as a band. Investigate engagement card is reachable from the modal: "look into this stage".

## Data

`graph:state` event, pushed on init, after apply, on request. Filtered by knowledge on the server: an `unknown` target carries no level at all. Never filter in the client. Never send the op log.

```json
{"stages": [{"id": "model", "health": null, "health_band": [40, 65], "patterns": ["dp_reproducible_training"]}],
 "flows": [{"from": "data", "to": "model", "level": 2}],
 "technical": {"model": {
   "components": [{"id": "model.training_pipeline", "knowledge": "current", "nominal": 4, "effective": 2,
                   "capped_by": "e.fs_train", "owner_id": "model_monica", "story": "..."},
                  {"id": "model.hpo", "knowledge": "unknown"}],
   "edges": [{"id": "e.fs_train", "knowledge": "stale", "level": 2, "trigger": "manual_request", "seen_at": 3}]}},
 "system_health_band": [42, 58]}
```

## Steps

- [ ] 1. `graph:state` handler from store, effective levels, stage graph, knowledge, story.
- [ ] 2. Per stage layout coordinates in `MlopsGraph.json`.
- [ ] 3. Strip: stages, band, flows, feedback arcs, pattern badges.
- [ ] 4. Modal: technical slice, nominal and effective pips, edge levels and trigger icons.
- [ ] 5. Fog rendering per the table.
- [ ] 6. Navbar slot in `Game.tsx`.
- [ ] 7. Before and after toggle.
- [ ] 8. Responsive check at minimum width.

## Done when

Player always sees the stage graph, can open any stage, and can tell apart what they know, what they knew, and what they never looked at.
