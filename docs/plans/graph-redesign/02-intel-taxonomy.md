# 02 Intel Taxonomy

Depends: [01](01-graph-core.md). Tracked in [STATE.md](STATE.md).

Replaces `requirement | negotiable_preference | personal_friction`. Those were keyword tagging for "need" versus "want" and carried no weight.

## Design rule

A tag is only worth asking for if a wrong tag costs the player something specific. So each category has its own mechanical consumer, and an item is only usable through that consumer.

## Categories

| main | sub | question the artifact answers | consumer |
|---|---|---|---|
| **Position** | Mandate | what must the system do, non negotiable | card slot, coverage, veto |
| | Preference | what would this person rather have | card slot, coverage, tradeable in objections |
| **Evidence** | System State | what is true about the environment today | reveals graph level, citable in objections |
| | Constraint | what external limit binds us | caps reachable levels, blocks options |
| **Leverage** | Motivation | what this person is measured on or afraid of | convincer fit bonus |
| | Alliance | how this person relates to another stakeholder | coalition effects |

## Distinguishing test

Applied when authoring and by the blind reclassification gate.

```
Is the sentence about the system, or about a person?
  system  -> is it a limit imposed from outside the team? Constraint. else System State.
  person  -> does it state something they want changed? 
               yes -> is refusal stated or implied? Mandate. else Preference.
               no  -> is it about another named stakeholder? Alliance. else Motivation.
```

Every authored artifact must pass this tree to exactly one leaf. Ambiguous artifacts are rejected, not patched.

## Mechanics per category

**Position.** Carries `component_targets: [{component_id, level}]`. Only Position items fill the 5 card slots. Mandate failure raises a hard objection and counts toward veto. Preference failure raises a soft objection and can be traded away in the objection round.

**Evidence.** Carries `asserts: {component_id, level}` or an instance assertion. Playing or holding it reveals that part of the graph to the player. In the objection round it can be cited to prove a component already sits at the required level, clearing an objection without spending a card slot. Constraint additionally carries `caps: {component_id, max_level}` or `forbids: [attribute value]`, which greys out card and dialogue options.

**Leverage.** Carries `archetype_hint` (Motivation) or `relates_to: {stakeholder_id, stance}` (Alliance). Motivation raises convincer fit when the matching profile is picked. Alliance enables coalition effects: satisfying A moves B, or angering A moves B the other way.

## Mis-tag consequences

| authored | player tagged | result |
|---|---|---|
| Mandate | Preference | left out of the card, hard objection, veto risk |
| Preference | Mandate | wasted card slot, small annoyance from the owner of a competing node |
| Evidence | Position | slot wasted on a fact, card proposes something already true |
| Position | Evidence | not available as a card slot, coverage gap |
| Leverage | anything | convincer fit bonus never applies, coalition never fires |

Wrong tags are corrected in the objection round, deterministically, and the corrected item stays in the dossier as verified. That is the teaching moment.

## Model changes

`domain/requirement.py`:

```python
class IntelCategory(str, Enum):  POSITION, EVIDENCE, LEVERAGE
class IntelSubtype(str, Enum):   MANDATE, PREFERENCE, SYSTEM_STATE, CONSTRAINT, MOTIVATION, ALLIANCE
```

`StakeholderRequirement` gains `category`, `subtype`, and the per subtype payload fields above. `RequirementType` and the legacy upgrade shim in `requirement.py` are deleted. Database is disposable.

`categorized_type` on `StakeholderIntelItem` becomes `categorized_subtype`. Correctness check compares subtype, and partial credit is given for the right main category with the wrong subtype.

## UI

`offline_intel_gathering.tsx`: tag control becomes two steps, pick main category, then subtype. Six flat buttons is too many at once and hides the distinction the game is teaching.

Dossier and verification dialogs updated to the new labels and colors. Suggested colors: Position blue, Evidence grey, Leverage amber.

## Steps

- [ ] 1. Enums plus payload fields in `domain/requirement.py`, delete `RequirementType` and the legacy shim.
- [ ] 2. Update `RequirementObjects.schema.json` and the loader validation gate.
- [ ] 3. Update `EngagementCard.allowed_requirement_types` to filter on category or subtype.
- [ ] 4. Two step tag control in `offline_intel_gathering.tsx`.
- [ ] 5. Partial credit scoring in `correct_and_verify_intel_item`.
- [ ] 6. Dossier and verification dialog labels and colors.
- [ ] 7. Regenerate content under the new taxonomy. Handled by [04](04-content-pipeline.md).

## Done when

An artifact resolves to exactly one subtype, the tag control teaches the distinction, and each subtype is only usable through its own consumer.
