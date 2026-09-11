# 02 Intel Taxonomy

Depends: [01](01-graph-core.md). Tracked in [STATE.md](STATE.md).

Replaces `requirement | negotiable_preference | personal_friction`. v2 Position / Evidence / Leverage is dropped: Leverage had no clear pitch effect, Evidence mixed facts and constraints.

## Taxonomy

| tag | about | question it answers | used by |
|---|---|---|---|
| **Driver** | a stakeholder | what do they want done, more is better? | card slot |
| **Boundary** | a stakeholder | what must happen, or must never be undone? | card slot, and checked automatically whether slotted or not, veto |
| **Trade-off** | a stakeholder | what would they accept, even though it costs them? | card slot |
| **Fact** | the environment | what is true about the system right now? | player knowledge, feasibility preview |
| **Language** | a stakeholder, profile level | how do they want to be convinced? | card section Framing, convincer fit |

Driver, Boundary, Trade-off and Fact are item tags, chosen per artifact in offline intel gathering. Language is one value per stakeholder, discovered through the existing convincer tagging (`tag_stakeholder_convincer_archetype`, `ConvincerVerificationDialog`). The dossier shows all five, Language as the profile header.

External limits such as budget or regulation are Boundaries, voiced by whoever owns them. Every constraint has an owner, which the veto needs anyway.

## One model for all stance items

Every stance item is an **action on the graph** plus **how much its stakeholder cares** about it. The tag is the importance:

```
Boundary   must happen, or must never be undone     violation vetoes (high power) or hard-objects (low power)
Driver     wanted, more is better                   coverage, buy-in
Trade-off  accepted, even though it costs them      no loss penalty from that stakeholder when the card includes it
```

The card takes 1 to 5 stance items in **any mix**, no quota per tag (D27). Facts are not slottable, they describe state, not actions.

## Distinguishing test

Order matters. Trade-off sentences usually name the Driver they trade for, so Trade-off is checked first.

```
1. Is anyone's wish, refusal or acceptance in it?
     no  -> Fact
2. Does it state something they would give up or accept losing?
     yes -> Trade-off
3. It states a need:
     would doing more than asked make them happier?
       yes -> Driver      direction, more is better
       no  -> Boundary    a line, crossing it means refusal
```

Phrasing rule for generation: Drivers as direction ("every point of accuracy matters to her"), Boundaries as refusal ("she will not ship anything under 95 percent"). Blind reclassification gate enforces it.

## Payloads

**Driver**

```json
{"metric_id": "model", "suggested": {"target": "model.evaluation", "level": 3}}
```

Coverage credit: full for the suggested target at level, partial for any other component or edge with positive `component_weights` on the same metric ([07](07-simulation-phase.md)). Several cards can satisfy one Driver, and Drivers from different stakeholders can be satisfied by the same change.

**Boundary**: a predicate ([01](01-graph-core.md#predicates)) that must hold on the predicted post-card graph, plus the ops that make it hold.

```json
{"holds": {"component": "gov.audit", "op": "gte", "level": 3},
 "ops":   [{"kind": "raise_to", "target": "gov.audit", "value": 3}]}

{"holds": {"not": {"attr": "deploy.serving.hosting", "op": "eq", "value": "public_cloud"}},
 "ops":   [{"kind": "set_attr", "target": "deploy.serving.hosting", "value": "on_prem"}]}
```

Slotted: its ops go into the card, the card commits to it, buy-in bonus with its stakeholder. Not slotted: still evaluated against the predicted graph. A card that never touches what a prohibition protects satisfies it for free. A positive Boundary (something must reach a level) that nobody acts on is violated.

Violated Boundary of a high power stakeholder is an automatic veto. Of a low power stakeholder, a hard objection.

**Trade-off**: an action its stakeholder accepts, plus what it costs them.

```json
{"ops":      [{"kind": "set_attr", "target": "data.feature_store.sourcing", "value": "bought"}],
 "concedes": {"metric_id": "efficiency", "loss": 5}}

{"ops":      [],
 "concedes": {"target": "gov.cost_monitoring", "accepts_max_level": 2}}
```

Slotted: its ops apply, and that stakeholder no longer holds the named loss against the card. A card that causes the same loss without the Trade-off item draws a price objection. An empty `ops` list is a pure concession: nothing is built, the stakeholder just stops counting that loss. That is how compromises are built: by the player, from intel, never by a dialogue option.

**Fact**

```json
{"asserts": {"target": "e.fs_train", "level": 2, "trigger": "manual_request"}}
```

Correctly tagged, it emits an `observe` op for that target. Stays citable in the dossier as "last seen".

## What facts do in the pitch

Facts never forbid actions. They let the player see consequences.

1. **Feasibility preview.** Card builder predicts effective levels for every slotted item that raises something. Upstream known: exact prediction, with `capped_by` shown. Upstream unknown: `?`.
2. **Boundary preview.** A Boundary warning in the builder needs the current value of what it reads. Unknown means the warning shows as "cannot check".
3. **Technical objections.** When a slotted item will be capped, the owner of the capped component objects in OBJECT ([06](06-merged-phase.md)). Facts make these foreseeable. The fix is to add the upstream item, not to argue.

## Mis-tag consequences

| authored | tagged as | consequence |
|---|---|---|
| Driver | Boundary | over-prioritised: a slot spent protecting something that is only wanted, false veto warning in the builder |
| Driver | Trade-off | you treat something they want as something they would give up, strong objection |
| Boundary | Driver | no veto warning in the builder, so dropping it looks cheap: surprise veto |
| Boundary | Trade-off | you plan to give up their red line: veto |
| Boundary | Fact | no warning, surprise veto |
| Trade-off | Driver | you count a concession as a win for them, the loss still lands: price objection |
| Trade-off | Boundary | over-cautious: slots spent guarding something they would give up |
| Fact | any stance tag | filed under a person, so no `observe`, graph stays fogged, slot does nothing |
| stance | Fact | treated as environment, stakeholder's actual stance missing from the card |
| Fact | correct | `observe` emitted, preview improves |

Corrections surface in OBJECT as Concede Correction. The corrected item becomes verified in the dossier.

## Artifact types

Stakeholder artifacts: email, slack message, meeting notes, document. New technical artifact types for Facts: runbook, dashboard snapshot, incident ticket, CI log, architecture note. Technical artifacts may be authored by a stakeholder but state no stance.

## Model changes

`domain/requirement.py`: `IntelTag(Driver, Boundary, TradeOff, Fact)`, payload fields as above, `stakeholder_id` nullable for Facts. Delete `RequirementType` and the legacy upgrade shim. Database disposable.

`categorized_type` becomes `categorized_tag`. Correctness compares tag.

## UI

- `offline_intel_gathering.tsx`: four tag buttons. First question visually separated: person or system.
- dossier: stakeholder section (Language header, Drivers, Boundaries, Trade-offs), environment section (Facts by stage)
- new artifact type icons

## Steps

- [ ] 1. `IntelTag` and payloads in `domain/requirement.py`, delete legacy types and shim.
- [ ] 2. Schema and loader gate: payload matches tag, Boundary predicates parse, Fact targets exist.
- [ ] 3. Engagement cards filter by tag, add Investigate card (reveals N Facts of a stage for tokens).
- [ ] 4. Tag control in `offline_intel_gathering.tsx`, technical artifact types in `IntelArtifactViewer.tsx`.
- [ ] 5. Scoring in `correct_and_verify_intel_item`, Fact tagging emits `observe`.
- [ ] 6. Dossier split into stakeholder and environment sections.
- [ ] 7. Content regenerated under the new taxonomy in [04](04-content-pipeline.md).

## Done when

Every artifact resolves to exactly one tag, a correctly tagged Fact lifts fog on its target, and each tag is usable only through its own card section.
