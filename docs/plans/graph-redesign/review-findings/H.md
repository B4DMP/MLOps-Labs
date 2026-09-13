# Batch H: Config data vs schema — findings

Method: `jsonschema` (already a transitive dependency in `game-api/uv.lock`, importable in the
running `api` container) run against every changed `gameConfig/*.json` file paired with its
`gameConfigSchemas/*.schema.json`, plus `python -m content_gen --scope tier0 validate` (the repo's
own content gate, which loads every config file through `GameConfigLoader.initialize` and the
domain factories — the real cross-file consistency check for stakeholder/component/pattern/metric
references) and `docker compose exec api python -m pytest tests -q` (193 passed, 0 failed — baseline
held) as the verification loop. No new validator tooling was added to the repo; a throwaway script
was used only in `/tmp` inside the container for this pass.

## Findings

- `gameConfig/MlopsObjections.json` (new file on this branch, 271 lines) — no paired
  `gameConfigSchemas/MlopsObjections.schema.json` existed at all, unlike every other content-gen
  assembled config (`OfflineIntelArtifacts.json`, `RequirementObjects.json`, `MlopsPatterns.json`,
  `MlopsStoryFragments.json` all got schemas alongside their data). Consequence: the admin config
  editor (`ConfigEditor.tsx` / `admin_service.load_json_schema`) silently falls back to `{}` for this
  file (see `admin_service.py:519-520`) so nobody editing it there gets field validation or the
  react-jsonschema-form UI, and there was no structural gate on `assemble.py`'s output shape for this
  file. **Fixed**: added `gameConfigSchemas/MlopsObjections.schema.json`, describing the `stance`
  array (`intel_id`, `stakeholder_id`, `kind` enum `stance|boundary|price`, `text`, `correction` —
  matching `content_gen/assemble.py:116-124` and `content_gen/stages/objections.py`'s
  `KIND_FOR_TAG`) and the `technical` array (`component_id`, `stakeholder_id`, `text`). Verified: the
  data now validates cleanly against the new schema (0 errors) and `content_gen validate` / the
  pytest suite are unaffected (193 passed).

- `gameConfig/GameStakeholders.json` stakeholders `0`-`5`, field `avatar.clothingColor` (e.g.
  `data_dave` uses `"0d6efd"`) vs `gameConfigSchemas/GameStakeholders.schema.json`
  `properties.stakeholders.items.properties.avatar.properties.clothingColor.enum` (Open Peeps
  palette: `e78276, ffcf77, fdea6b, 78e185, 9ddadb, 8fa7df, e279c7`) — all 6 stakeholders' clothing
  colors are Bootstrap brand hexes (`0d6efd`, `198754`, `ffc107`, `0dcaf0`, `d63384`, `fd7e14`), none
  of which are in the schema's enum, so every stakeholder record fails schema validation on this
  field. **Deferred, not fixed** — confirmed via `git show main:gameConfig/GameStakeholders.json` and
  `git show main:gameConfigSchemas/GameStakeholders.schema.json` that both the data values and the
  enum are byte-identical to `main`; this mismatch predates `graph-redesign` entirely and nothing in
  this branch's diff touched the `clothingColor` field or its schema entry. It is also not a runtime
  bug: `game-ui/src/assets/openPeepsAvatar.ts` and `StakeholderAvatarComponent.tsx` pass the hex
  straight through to the Open Peeps renderer, which accepts arbitrary hex, so the game itself
  renders fine — only the admin JSON-forms editor's dropdown for this field is out of sync with the
  actual palette in use. Fixing it needs a design call outside this batch's remit: either widen the
  schema enum to include the Bootstrap palette actually in use, or decide the six colors should be
  migrated to genuine Open Peeps swatches (a visual change to every stakeholder's look) and update
  the data instead. Recommend routing this to whoever owns stakeholder visual design, not silently
  changing it here.
  **Resolved post-review (2026-09-12), user chose "match the enum"**: all 6 stakeholders' hex
  values changed to distinct, valid Open Peeps enum colors (verified: `python -c` cross-check
  against the schema's enum, all 6 now `OK`). A visual change to every stakeholder's avatar
  color, accepted by the user. Also addressed the follow-up "how do we stop needing to hand-pick
  a color in the JSON at all" question: added `OPEN_PEEPS_CLOTHING_PALETTE` +
  `colorForStakeholderId(id)` (a deterministic hash, same id always gets the same color) to
  `game-ui/src/types/StakeholderAvatar.ts`, wired in as `StakeholderAvatarComponent`'s
  last-resort fallback via a new optional `stakeholderId` prop - so a stakeholder config entry
  can omit `clothingColor` entirely and still render a distinct, stable color. Not done: wiring
  `stakeholderId` through the 8 existing call sites of `StakeholderAvatarComponent` (several
  outside this branch's scope entirely, e.g. `ActionCardCardComponent.tsx`,
  `ConfigEditor.tsx`) - the mechanism is in place and opt-in, but making every caller use it (so
  `clothingColor` can actually be dropped from `GameStakeholders.json`) is a separate, broader
  frontend change with no automated UI verification available in this environment; left for a
  follow-up rather than touching 8 files blind. 3 new Vitest tests added
  (`StakeholderAvatar.test.ts`); frontend suite: 7 passed, 0 failed; `tsc -b --force`: 0 errors.

## Spot checks (no issues found)

- No duplicate ids: `MlopsObjections.json` `stance[].intel_id`, `MlopsPatterns.json`
  `patterns[].id`, `GameEngagementCards.json` `engagement_cards[].id`, `MLOpsGlossary.json`
  `terms[].id` — all unique.
- No dangling references: `MlopsObjections.json` `stance[].stakeholder_id` /
  `technical[].stakeholder_id` all resolve into `GameStakeholders.json`; `technical[].component_id`
  all resolve into `MlopsGraph.json` components; `MlopsPatterns.json` pattern `when` predicate
  targets all resolve into graph component/edge ids; `MlopsStoryFragments.json` `targets` keys all
  resolve into graph ids.
- `MLOpsGlossary.json` `terms[].category` values and `categories[].id` values are exactly the same
  set as each other and as the schema's hardcoded `category` enum (10 categories, no drift).
- `gameConfigUISchemas/MLOpsGlossary.uischema.json` — every `scope` JSON-pointer
  (`#/properties/settings/properties/...`, `#/properties/terms`, `#/properties/categories`)
  resolves to a real property in `MLOpsGlossary.schema.json`; no stale references.
- All other changed configs validate cleanly against their paired schema as-is:
  `EmotionValueConfig.json`, `FullGameProgression.json`, `GameEngagementCards.json`,
  `GameMetrics.json`, `GameProgression.json`, `MLOpsGlossary.json`, `MlopsGraph.json`,
  `MlopsPatterns.json`, `MlopsStoryFragments.json`, `OfflineIntelArtifacts.json`,
  `RequirementObjects.json`.
- `content_gen --scope tier0 validate` gates all pass (only a pre-existing `WARN orphans` about
  deploy/gov/ops/req-stage components having nothing asking for them in tier-0 generated content —
  expected per D36/D29, tier 0 deliberately covers only the data/model stages; not a batch H
  finding, belongs to the content-generation batches if revisited).

## Not touched

- `gameConfigSchemas/FullStakeholders.schema.json` and its `.uischema.json` — not in the changed-file
  list for this branch (`git diff --stat main...graph-redesign -- gameConfigSchemas/` does not
  include it), so left alone per scope.
- No files were deleted or proposed for deletion in this batch.
