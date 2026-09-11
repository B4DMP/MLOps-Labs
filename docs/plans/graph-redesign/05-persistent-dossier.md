# 05 Persistent Dossier

Depends: [04](04-content-pipeline.md). Tracked in [STATE.md](STATE.md).

Intel survives phases. Later phases refine earlier items instead of replacing them. Refinement chains display as one item.

## Problem today

`load_known_intel_items_for_challenge` filters by challenge. Items vanish when the challenge ends.

## Model

```python
class StakeholderIntelItem:
    ...
    refines_id: Optional[str]
    discovered_phase_id: int
    discovered_challenge_template: str
    source: Literal["artifact", "engagement_card", "objection"]
```

Status, computed never stored:

```
open        Driver target not reached (effective level)
addressed   Driver target reached
violated    Boundary predicate currently false
stale       Fact whose target changed since it was seen
contested   the challenge conflict puts another stakeholder on the opposing side
```

Nothing is ever removed.

## Refinement chains

Authored in content generation. A later item on the same target and same stakeholder points at the earlier one with `refines_id`. Gate: target exists, same target, same stakeholder, earlier phase, same tag or Driver refining into Boundary.

Facts chain too: a newer Fact on the same target refines the older one.

### Display: one item, not a list

A chain renders as **one larger dossier card**:

```
+--------------------------------------------------------------+
| DRIVER  model.evaluation            phase 3   [addressed]    |
| "Monica needs evaluation gated on a held-out drift set."     |  <- newest refinement, headline
|--------------------------------------------------------------|
|  phase 2  "Monica wants a proper evaluation harness."        |  <- earlier layers, smaller, stacked
|  phase 1  "Monica cares about accuracy above all."           |
+--------------------------------------------------------------+
```

- headline is the newest discovered link, older links stack underneath, smaller, in phase order
- card height grows with chain length, so depth is visible at a glance
- undiscovered later links show as a locked row ("more to learn in phase 4"), matching the existing "how much intel is still out there" indicator
- in the card builder the whole chain is one selectable item, using the newest payload

Objections write into the dossier as `source: objection`, `intel_type: verified`, attached to the chain they belong to.

## Backend

- `load_known_intel_items(username, up_to_phase)` replaces the per challenge loader
- `retrieve_dossier_data` returns chains, not flat items: per chain tag, target, links in order, status, conflict flag, locked link count
- stakeholder section and environment section, per [02](02-intel-taxonomy.md#ui)

## UI

`StakeholderDossier.tsx`:
- stakeholder view: Language header, then Driver, Boundary, Trade-off chain cards
- environment view: Fact chain cards grouped by stage, stale marker where the fog fold says so
- stage filter row, colors from [08](08-graph-viz.md)
- default filter to the current challenge focus stages, collapse addressed, search box

## Steps

- [ ] 1. New fields, computed status helper.
- [ ] 2. Replace the challenge filter in `intel_handler.py`.
- [ ] 3. Chain assembly in `retrieve_dossier_data`, locked link counts.
- [ ] 4. Objections write dossier entries onto chains.
- [ ] 5. Chain card component, headline plus stacked layers, locked rows.
- [ ] 6. Stakeholder and environment views, stage filter, search.
- [ ] 7. Card builder treats a chain as one item.
- [ ] 8. Playtest two phases: a phase 1 item grows a phase 3 layer and reads as one card.

## Done when

An item found in phase 1 is still there in phase 4, and its refinements read as one growing card.
