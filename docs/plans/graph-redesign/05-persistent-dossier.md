# 05 Persistent Dossier

Depends: [04](04-content-pipeline.md). Tracked in [STATE.md](STATE.md).

Intel survives phases. Later phases refine earlier items instead of replacing them.

## Problem today

`load_known_intel_items_for_challenge` filters by challenge. Items vanish when the challenge ends. Dossier groups by stakeholder inside one challenge.

## Target

Outer grouping is the graph node. Inner grouping is stakeholder. Items carry a refinement chain and a live status.

```python
class StakeholderIntelItem:
    ...
    refines_id: Optional[str]
    discovered_phase_id: int
    discovered_challenge_template: str
    source: Literal["artifact", "engagement_card", "objection"]
```

Status is computed, never stored:

```
open        target level not reached in the graph
addressed   graph level >= target
stale       a refinement of this item exists and is discovered
contested   the challenge conflict block puts another stakeholder on an opposing level
```

Nothing is ever removed. Addressed items grey out.

## Refinement chains

Authored in content generation. Later phase requirements on the same component point at the earlier one with `refines_id`. Validation gate: target exists, same component, earlier phase.

Objections also write into the dossier, as items with `source: objection` and `intel_type: verified`. That is the payout for the objection round.

## Backend

- `load_known_intel_items(username, up_to_phase)` replaces the per challenge loader
- `retrieve_dossier_data` returns node grouping, per item component, target level, current graph level, status, chain, conflict flag
- Evidence and Leverage items get their own sections, since they are not card slot candidates

## UI

`StakeholderDossier.tsx`:
- node filter row across the top, colors from [08](08-graph-viz.md)
- three sections per node: Positions, Evidence, Leverage
- item row shows component, target level pip, current level pip, status chip
- refinements nest under their parent, collapsed
- keep the stakeholder oriented view as a second tab

## Risk

By phase 5 the dossier holds 60 plus items. Default filter to the current challenge focus nodes, collapse addressed, add search.

## Steps

- [ ] 1. New fields on the model, computed status helper in `domain/graph.py`.
- [ ] 2. Replace the challenge filter in `intel_handler.py`.
- [ ] 3. Extend `retrieve_dossier_data` with node grouping, live level, conflict flag.
- [ ] 4. Objections write dossier entries.
- [ ] 5. UI node filter, three sections, level pips.
- [ ] 6. UI refinement nesting, search, collapse addressed.
- [ ] 7. Playtest two phases, verify a phase 1 item shows addressed in phase 3.

## Done when

An item found in phase 1 is still visible in phase 4 with correct status, and its later refinement nests under it.
