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
- component: nominal and effective level pips (0 to 4), shown separately only when they differ, with the cap named on hover
- edge: maturity level on the arrow, trigger as an icon (manual hand, clock, commit, data arrival, alert, approval)
- `broken` red and distinct from `absent`
- story fragment line per component and edge
- owner avatar per component via `StakeholderAvatarComponent`
- debt marked amber with the blocking stakeholder
- instances listed with their state and properties (for example model performance, dataset freshness)
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

Stages of phases not reached yet are not drawn beyond a locked placeholder: no health, no components (D33). Within a reached stage, topology is always drawn and health with unknown or stale parts renders as a band. Investigate engagement card is reachable from the modal: "look into this stage".

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

- [x] 1. `graph:state` handler from store, effective levels, stage graph, knowledge, story. (`graph_state_view.py`, `handlers/graph_handler.py`, registered as `graph:state_request`)
- [x] 2. Per stage layout coordinates in `MlopsGraph.json`. (`tools/scripts/add_layout_coords.py`; `Component.layout` field added to domain model; exposed in `graph_state_view.py`; SVG topology in `StageModal` with click-to-detail)
- [x] 3. Strip: stages, band, flows, feedback arcs (Q21: curved SVG arcs above strip, height scales with stage distance), pattern badges. (`PipelineView.tsx`)
- [x] 4. Modal: technical slice, nominal and effective pips, edge levels and trigger icons. (`PipelineView.tsx` — `StageModal` + `StageSvg` + `ComponentDetail`)
- [x] 5. Fog rendering per the table. (unknown/current/stale rendered in PipelineView)
- [x] 6. Navbar slot in `Game.tsx`. (floating toggle button, renders at progressionIndex === 2)
- [ ] 7. Before and after toggle. (depends on 07 — delta report)
- [x] 8. Responsive check at minimum width. (strip now scrolls horizontally, paddingRight=100 clears toggle button; modal has maxWidth=860 with scroll)

## Done when

Player always sees the stage graph, can open any stage, and can tell apart what they know, what they knew, and what they never looked at.
