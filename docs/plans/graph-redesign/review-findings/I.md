# Batch I: Generated content spot-check

**Update (2026-09-12), user asked to fix + regenerate**: implemented the generator fix
recommended below (defense-in-depth re-bracing in `common.tokenize_names` + a
`bare_stakeholder_id_errors` check-gate wired into both `ObjectionsStage.check()` and
`ArtifactsStage.check()`), added 3 regression tests, then `reject`ed the 6 affected items and ran
`content_gen run --stage objections`.

That run regenerated **all 41** objections, not just the 6 - `ledger.sync()` correctly detected
every item as stale because this session's earlier avatar-color fix (batch H /
`review-findings/H.md`) edited `gameConfig/GameStakeholders.json`, and each item's `input_hash`
incorporates the stakeholder config it was generated against. Not a bug, just a wider blast radius
than the 6-item fix alone would have caused - confirmed harmless: `content_gen validate` gates
pass, a scripted scan of the assembled `gameConfig/MlopsObjections.json`'s actual player-facing
`text`/`correction` fields (the metadata `stakeholder_id` field legitimately holds the raw id and
was excluded from the scan) finds **zero** remaining leaks across all 41, and the full backend
suite (209 passed) is unaffected. Approved and assembled into `gameConfig/MlopsObjections.json`.
Token cost: ~20k in / ~25k out for the regeneration (`content_gen status` before/after).

Scope: `game-api/tools/content_gen/work/out/{artifacts,objections,fragments}/`. Sampled 5 artifacts,
7 objections (spread across `data_quality_conflict`, `experiment_tracking_dispute`,
`inconsistent_data_labeling`, `registry_red_tape`, plus 2 `technical` kind), 5 fragments by hand, then
ran a script (read-only, via `docker compose exec api python3`, mirroring the stages' own `check()`
functions) over all 46 artifacts / 41 objections / 24 fragments to size any pattern found in the
hand-read sample precisely, per the batch instructions ("report it precisely ... so it can be routed
to a generator fix plus regeneration"). No files in `work/out/**` were edited.

## Findings

- `game-api/tools/content_gen/work/out/objections/objections__gen_data_quality_conflict_gov_compliance.json`
  (`output.objection`, `output.correction`) - the raw snake_case stakeholder id
  `requirements_reuben` appears as literal text (e.g. `"requirements_reuben mentioned governed data
  quality checks."`) instead of the `{requirements_reuben}` brace token or the rendered name. -
  deferred (generator bug, see below; not hand-patched per instructions).
- `game-api/tools/content_gen/work/out/objections/objections__gen_experiment_tracking_dispute_reuben_audit.json`
  (`output.objection`, `output.correction`, twice in `correction`) - same raw-id leak:
  `"requirements_reuben will not accept any solution..."`, `"requirements_reuben did not refuse
  anything. requirements_reuben insisted..."` - deferred (same root cause).
- `game-api/tools/content_gen/work/out/objections/objections__gen_experiment_tracking_dispute_reuben_comp.json`
  (`output.objection`, `output.correction`) - same raw-id leak: `"requirements_reuben proposed
  aligning experiment tracking..."`, `"requirements_reuben didn't just propose alignment."` -
  deferred (same root cause).
- `game-api/tools/content_gen/work/out/objections/objections__gen_inconsistent_data_labeling_ruth_governed_labeling.json`
  (`output.objection`, `output.correction`) - same raw-id leak, this time with
  `reliability_ruth`: `"reliability_ruth asked for fully governed data labeling."` - deferred
  (same root cause).
- `game-api/tools/content_gen/work/out/objections/objections__gen_inconsistent_data_labeling_ruth_trade_off.json`
  (`output.objection`) - same raw-id leak: `"reliability_ruth proposed a semi-manual approach for
  data labeling, but it takes more resources..."` - deferred (same root cause; the `correction`
  field on this one is clean, uses first person "I").
- `game-api/tools/content_gen/work/out/objections/objections__gen_registry_red_tape_reuben_registry.json`
  (`output.objection`, `output.correction`) - same raw-id leak: `"requirements_reuben wants the
  model registry to be governed."`, `"requirements_reuben did not say he would refuse."` -
  deferred (same root cause).

**Root cause and why this is a generator bug, not 6 typos to hand-patch:**
`ObjectionsStage.generate()` in `game-api/tools/content_gen/stages/objections.py:101-102` runs every
non-`line` output field through `tokenize_names()`
(`game-api/tools/content_gen/stages/common.py:105-132`), but that function only rewrites a
stakeholder's *rendered name* (`"Requirements Reuben"` or the bare given name `"Reuben"`) into the
`{id}` token — it has no rule for the case where the model emits the internal id itself
(`requirements_reuben`, all lowercase, underscored) as plain prose instead of using the name or the
brace token. `ObjectionsStage.check()` (`objections.py:104-111`) also has no rule against this: it
only runs `text_errors` (dash/markdown/word-count) and, for technical lines, checks for the
`{target}`/`{cause}` placeholders. So a record where the model writes the raw id straight through
passes the gate and gets marked `done`/`approved` with the leak baked in. Confirmed via
`persona_resolver.py:32` (`_TOKEN_RE = re.compile(r"\{([a-z0-9_]+)(\.first)?\}")`) that only the
braced form is ever substituted at render time — an un-braced `requirements_reuben` in
`MlopsObjections.json`'s `text`/`correction` (which `assemble.py:123-124` copies verbatim from
these `output.objection`/`output.correction` fields) would show up **literally in the pitch room
dialogue** the player sees, e.g. "requirements_reuben mentioned governed data quality checks."
instead of the stakeholder's name. This is a live, player-facing correctness bug reachable once
this content is assembled and played, not a cosmetic ledger artifact.

Confirmed via a scripted scan of all 46 artifact + 41 objection ledger records for any bare
occurrence of a known stakeholder id not immediately preceded by `{`: **6 of 41 objections files**
carry the leak (12 field-level hits total, all `stance`/`price` kind, i.e. never the `technical`
kind, which skips `tokenize_names` by design since its `{target}`/`{cause}` placeholders are
different). **0 of 46 artifacts** have the same leak (that stage's `check()` also doesn't guard
against it, but this generation pass happened not to trigger it there). Only `requirements_reuben`
and `reliability_ruth` ids were affected in this sample; likely coincidence of model sampling, not
an id-specific rule (both ids' name/given-name substitution paths are otherwise exercised
correctly in the many unaffected files, e.g. `objections__gen_registry_red_tape_reuben_automation.json`
still renders `{requirements_reuben}` correctly).

**Why deferred and not hand-patched:** the batch's own instructions are explicit that a structural
problem found in `work/out/**` is "almost certainly a bug in the generator... not a one-off typo to
patch" and should be "routed to a generator fix plus regeneration, not hand-patched." The actual
fix belongs in batch B's territory (`game-api/tools/content_gen/stages/objections.py` and/or
`stages/common.py`), specifically:
1. Add a check in `ObjectionsStage.check()` (and, for safety, `ArtifactsStage.check()`) that
   rejects output containing a bare stakeholder id (an id from `ctx.stakeholders` appearing as a
   whole word not immediately wrapped in `{...}`), forcing a regeneration attempt with feedback.
2. Optionally harden `tokenize_names()` to also catch and re-brace a bare id token as a
   defense-in-depth normalizer, so this failure mode self-heals instead of needing a full
   regeneration.
This is logged here for routing to batch B / a follow-up generator-fix pass; the 6 affected ledger
rows need their `status` reset (e.g. via `ledger.reject()`) and regenerated once the check is added,
not edited by hand.

## Checks that passed clean (no findings)

- Reclassification gate (`output.reclassified_as == requirement.type`): clean on all 46 sampled +
  scripted-checked artifacts.
- Word-count / dash / markdown `text_errors` gate: clean on all 111 files (artifacts, objections,
  fragments) per the stages' own thresholds.
- Technical objection `{target}`/`{cause}` placeholders: present exactly once each, in both
  hand-sampled files and the full scripted pass.
- No malformed brace tokens anywhere (e.g. `{Data_Dave}`, `{data dave}`) across all 87
  artifact+objection files - only well-formed `{id}` / `{id.first}` tokens (or the two literal
  `{target}`/`{cause}` placeholders) appear.
- No exact-duplicate `content` text across the 46 artifacts (no copy-paste laziness detected).
- No `refines_id` anywhere in `work/out/**` - consistent with D40 (tier 0 content carries no
  authored refinement chains yet; chains ship with the full content run in plan 04 step 9).
- Fragment levels consistently use the five-level vocabulary from D30 (`broken, absent, manual,
  automated, governed`), no stray `scripted` level anywhere sampled.
- Near-duplicate component naming consistent with D26 (`model.registry`,
  `data.training_drift_check` used, not legacy names).
- Blind-reclassification voice test (D-adjacent gate #1 in `content_gen/gates.py`): every sampled
  fact artifact reads cleanly as a fact (no wish/refusal/acceptance language slipping in), matching
  the intent behind D16/D18 (facts must not accidentally lift fog by reading as stance).

## Proposed deletions

None.
