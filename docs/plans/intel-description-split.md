# Split intel descriptions into fact and reading

## Status

Implemented as part of the graph redesign ([graph-redesign/04](graph-redesign/04-content-pipeline.md)):

- `StakeholderRequirement` has `fact` and `reading`; `description` is their join, so nothing downstream changed.
- Re-tagging swaps only the reading; the dossier gets `fact` and `reading` as separate keys, bolds the fact and italicises the reading while unconfirmed.
- The content harness writes every new item split, and wrong-tag variants as readings only. Checks reject a reason in the fact and a reading that repeats it.
- Deviation: `categorized_description` keeps the whole sentence the player sees (fact plus their reading) rather than the reading alone, so the pitch and chat flows needed no change. The dossier derives the reading from it.
- Legacy content (no split) keeps its one sentence and the name-prefix rendering. No migration: gameplay data was wiped (D34) and legacy content is replaced by generated content.
- The old artifact generator (`generate_and_save_all_offline_intel_artifacts`) is superseded by the harness and was not changed.

The original design follows.

## Problem

Re-tagging an intel item swaps the whole sentence. Nothing visibly holds still, so the player
cannot see what changed or why.

The variants are written independently. Only the stakeholder name survives a swap. The dossier
bolds that name and italicises the rest, which is all the current data supports.

## Fix

Give every variant of a requirement the same literal first clause. Only the second clause varies.

Example:

- fact: `Monica wants a deep-learning model.`
- reading (driver): `She would take any gain in accuracy she can get.`
- reading (boundary): `She will not ship anything simpler.`
- reading (trade_off): `She could live with less if it saves the budget.`

## Config

`RequirementObjects.json`: split `description` into `fact` and `reading`. Update the schema.

`OfflineIntelArtifacts.json`: `wrong_descriptions` holds readings only. No fact. Update the
schema.

Keep `description` as a read-only property that joins `fact` and `reading`. Nothing downstream
that reads it has to change.

## Backend

`StakeholderIntelItem`: add `fact`. `categorized_description` holds the reading only.

`handle_intel_item_categorization`: assign the reading, not a whole sentence.

`retrieve_dossier_data`: ship `fact` and the reading as separate keys.

`create_wrong_intel_item_description` and its prompt: return a reading only. It must not restate
the fact.

Regenerate via `generate_and_save_all_offline_intel_artifacts`.

## Frontend

`StakeholderDossier.tsx`: drop the name-prefix guess in `noteSubject` / `noteReading`. Use the two
keys. Bold the fact. Italicise the reading while the item is unconfirmed.

## Rules for the copy

Fact is observable. It states what the stakeholder wants or did. It never says why.

Reading is the why. It is the only part the player is judging.

Both stay one short sentence.

## Migration

Persisted items hold a joined `description` and no `fact`. Fall back to the config through
`RequirementFactory`. Same fallback shape as `_is_public_record`.

## Test

- Re-tag an item three times. The fact does not move.
- Verify an item. Reading stops being italic.
- Load a save from before the split. Text still renders.
