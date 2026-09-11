# 08 Player Graph View

Depends: [01](01-graph-core.md). Tracked in [STATE.md](STATE.md).

Player sees the pipeline and its health. Reference mock: `asmodiel.de/stakeholder-showdown/pipeline.html`.

## Placement

`PipelineTab` next to `MetricTab` in the top navbar, available in every loop step. Collapsed strip by default, expands to a modal.

## Component

`game-ui/src/components/PipelineView.tsx` plus module CSS.

Strip mode: 7 node boxes left to right, edges between, feedback edge from monitoring back to data and requirements. Box tinted by health band. Badge for active antipattern count.

Modal mode:
- per node: health number, owner avatar via `StakeholderAvatarComponent`, component list with level pips 0 to 5
- `broken` pips are red and distinct from `absent`, since broken is worse
- attribute line per component, rendered from the story fragment, not raw enums
- instances listed per node with their state
- debt rows marked amber with the blocking stakeholder
- active antipatterns under the graph with their story line
- before and after toggle after a pitch, fed by the delta report from [07](07-simulation-phase.md)

Static SVG or CSS grid. No layout library. Seven nodes do not need d3.

## Data

New ws event `graph:state`, pushed on init, after apply, and on request.

```json
{"nodes": [{"id": "data", "health": 62, "health_band": [55, 70], "owner_id": "data_dave", "debt": 1,
            "components": [{"id": "data.pii_masking", "level": 4, "story": "...", "knowledge": "current"},
                           {"id": "data.lineage", "knowledge": "unknown"}],
            "instances": [{"id": "dataset:crm_orders", "kind": "dataset", "state": "stale"}]}],
 "edges": [...], "system_health": 51, "antipatterns": [{"id": "ap_drift", "name": "...", "story": "..."}]}
```

Never send the op log to the player client. Admin only, see [09](09-debug-view.md). The payload is filtered by knowledge before it leaves the server, so an `unknown` component carries no level at all. Do not filter in the client.

## Fog of war

The player sees what they have observed, not ground truth. Knowledge state per component:

| state | shown as |
|---|---|
| `unknown` | grey slot, no level, node health shown as a band |
| `current` | exact level and story line |
| `stale` | last seen level, dimmed, with an "as of challenge N" marker |

Rules:
- the seeded initial graph is `current`. The game tells the player where they start, so nothing opens opaque
- a component the player's own card touched is `current`. You know what you did
- a world event or an owner degradation on a `current` component flips it to `stale`. The player finds out the next time they look
- Evidence System State intel, objections that name a component, and engagement cards that probe a node all set `current`
- node health with any `unknown` or `stale` component renders as a band, not a number. The uncertainty is the point

This is what makes Evidence items worth a card slot decision and turns the graph into something the player investigates rather than reads.

Admin view ([09](09-debug-view.md)) always shows ground truth, plus the player's knowledge state next to it.

## Steps

- [ ] 1. `graph:state` event and handler from `store.load_state`, `health.py`, `story.py`.
- [ ] 2. Strip mode, health colors, edges.
- [ ] 3. Modal mode, level pips, story lines, instances, owner avatars.
- [ ] 3b. Fog of war rendering: unknown slots, stale markers, health bands.
- [ ] 4. Navbar slot in `Game.tsx`, present in all loop steps.
- [ ] 5. Before and after toggle from the delta report.
- [ ] 6. Responsive check at minimum supported width.

## Done when

Player can see all 7 nodes at any time, inspect what they have observed per node, and tell apart what they know, what they knew, and what they have never looked at.
