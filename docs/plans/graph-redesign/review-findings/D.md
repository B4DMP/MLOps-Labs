# Batch D — Frontend components: findings

Scope: `pitch_phase.tsx`/.module.css, `StakeholderDossier.tsx`/.module.css, `PipelineView.tsx`,
`GraphDebug.tsx`, `PowerInterestMatrix.tsx`/.module.css, `ac_simulation.tsx`,
`offline_intel_gathering.tsx`/.module.css, `glossary/**`, and the branch-touched parts of `Game.tsx`.

Note on process: this batch's working tree already carried a substantial set of uncommitted fixes
(tsc-error cleanup across the 5-file baseline, plus a real correctness fix in `StakeholderDossier.tsx`
with a new regression test) from an earlier, interrupted run of this same batch — no findings file had
been written yet. This file covers that work (verified, not redone) plus the additional review and one
further fix made in this session.

## Verification at end of batch

- `docker compose exec ui npx tsc -b --force` → **0 errors** (down from the 30-error/5-file baseline).
- `docker compose exec ui npm test` → **4 passed** (`StakeholderDossier.test.tsx`), 0 failed.
- `docker compose exec ui npx eslint <all batch D files>` → 87 problems (72 errors, 15 warnings),
  all pre-existing patterns (see item 8 below) or accounted for by files added to the scoped run this
  session (`StakeholderDossier.test.tsx`: 0 new; `glossary/GlossaryProvider.tsx`: 3 pre-existing, not
  touched this session). No new error was introduced by any edit made in this batch; one pre-existing
  error was removed (item 4).

## Fixed

1. `game-ui/src/components/StakeholderDossier.tsx:274` (was line ~272 before the fix) — `phaseLabel`
   read `phases?.[phase]?.name`, but `PhaseData` has no `name` field (the real field is
   `phase_name`). Every note's "picked up in ..." phase label silently fell through to the numeric
   `phase N` fallback, so authored phase names never actually rendered anywhere in the dossier.
   Fixed to read `.phase_name`; regression-tested in the new
   `game-ui/src/components/StakeholderDossier.test.tsx` (4 cases: name present, missing phase index,
   out-of-range index, empty-string name). Fixed (pre-existing, verified this session).

2. `game-ui/src/Game.tsx` — several pieces of state and two whole functions
   (`getNextChallenge`, `requestNextChallenge`, `roundOverAnimActive`, `revealAc`, and the setters for
   `isExistingDebateSave`, `isChatEnabled`, `intelItems`, `dialogueOptions`, `last_ac`'s old
   `setLastAc`) were left over from the deleted `PitchDebate`/old `OnlineIntelGathering` screens
   (D37/D46 merged them away) with no remaining reader, which is exactly what was producing several
   of the 30 baseline tsc errors (unused/mismatched types) and would have been redundant code even
   where it still compiled. Trimmed to setter-only state where only the setter is still read, dead
   functions removed outright, each spot commented with why. Fixed (pre-existing, verified this
   session).

3. `game-ui/src/components/GraphDebug.tsx:114` — `Tbl`'s row type referenced the global `JSX.Element`
   namespace, which doesn't resolve under the current React/TS types (part of the tsc baseline).
   Switched to `type ReactNode` import. Fixed (pre-existing, verified this session).

4. `game-ui/src/components/PipelineView.tsx:350` — `e.level >= 3` compared a possibly-`undefined`
   number (part of the tsc baseline). Added an explicit `e.level != null` guard, matching the
   already-defensive style two lines above it. Fixed (pre-existing, verified this session).

5. `game-ui/src/components/pitch_phase.tsx` — `onPlayedCardIdsChange` / `onChatMsgsChange` /
   `onCardTargetedStakeholdersMapChange` were typed as plain setters (`(x: T) => void`), but
   `Game.tsx` actually passes its raw `useState` setters through and this component calls them with
   the functional-updater form (`prev => ...`) in several places — a real type/contract mismatch
   (part of the tsc baseline), not just a lint nit: had TS actually caught every call site, several
   `prev => ...` calls would have been type errors. Widened to
   `Dispatch<SetStateAction<T>>`. Also wrapped two `<Icon title="High power" />` usages in a
   `<span title="High power">` wrapper — `Icon` from `@iconify/react` doesn't accept/forward a
   `title` prop in the installed types. Fixed (pre-existing, verified this session).

6. `game-ui/src/components/offline_intel_gathering.tsx` — two lines of player-facing copy still said
   "Online Intel Gathering", the screen `plan 06 step 11` deleted under D37/D46. Reworded to "the
   pitch phase". Fixed (pre-existing, verified this session).

7. `game-ui/src/components/PowerInterestMatrix.tsx:656` (new fix, this session) — the intro speech
   bubble's inline `style` object smuggled two CSS custom properties (`--intro-arrow-x`,
   `--intro-color`) past `React.CSSProperties` with `// @ts-ignore`. `@ts-ignore` is banned by this
   repo's eslint config (`@typescript-eslint/ban-ts-comment`) specifically because it silently does
   nothing if the following line isn't actually a type error at that exact position — a real footgun
   for a style object built from a ternary spread, where a later refactor could easily make the
   suppressed line error-free while a different line starts erroring instead, with no warning either
   way. Replaced with `as unknown as CSSProperties` (added a `type CSSProperties` import), the same
   escape hatch already used elsewhere for custom properties in this file, and verified with
   `tsc -b --force` (stayed at 0 errors) and a per-file `eslint` run (this file's problem count
   dropped from 6 to 5, all `no-explicit-any`/`set-state-in-effect` pre-existing noise, see item 8).

## Deferred

8. Pre-existing `@typescript-eslint/no-explicit-any` and `react-hooks/set-state-in-effect` /
   `exhaustive-deps` findings across `PowerInterestMatrix.tsx`, `StakeholderDossier.tsx`,
   `pitch_phase.tsx`, `offline_intel_gathering.tsx`, `glossary/GlossaryProvider.tsx`,
   `glossary/GlossaryPreview.tsx`, `glossary/GlossaryText.tsx`. These match the repo-wide pattern the
   review baseline already documented (292 pre-existing errors, mostly `no-explicit-any`) and mostly
   come from legitimate "derive UI state from an external input inside an effect" patterns (queued
   speech bubbles, animation timers, tab-change badges) rather than correctness bugs. Rewriting them
   to satisfy the newer React Compiler lint rules would risk changing observable timing behavior for
   no functional gain — out of scope for a review pass whose own mandate is "small, surgical fixes,"
   and the batch's own goal is "no new errors," not "zero errors." Left as is.

9. `game-ui/src/Game.tsx` / `ac_simulation.tsx` / `offline_intel_gathering.tsx` — `last_ac` and
   `showMetricValueChanges` are now fully inert. `showMetricValueChanges` is pinned to `false`
   forever (nothing sets it `true` since the old `PitchDebate` reveal sequence that used to was
   deleted under D37/D46), and `last_ac` is pinned to `actionCards[0]` at first mount with its setter
   gone too — in real (non-debug) play `actionCards` starts as `[]`, so `last_ac` is `undefined` for
   the whole game, always. Both are threaded all the way down into `MetricTab.tsx`, which declares
   `last_ac` in its props interface but never destructures or reads it at all. Harmless today (the
   branch that would consume it is permanently disabled), but it is dead weight and a trap for
   whoever next wires a real "show what the last card changed" feature back in and can't figure out
   why `last_ac` is always `undefined`. A full cleanup needs to also touch `MetricTab.tsx`, which is
   outside batch D's file list — deferring rather than reaching outside scope. Flagged in-code by a
   comment in `Game.tsx` pointing here.
   **Resolved post-review (2026-09-12), user asked for the dead props to be removed**: removed
   `last_ac`/`showMetricValueChanges` end to end from the live chain -
   `Game.tsx` (dropped the dead `actionCards`/`last_ac` state and the `showMetricValueChanges`
   state entirely, including the one `setActionCards([])` reset call site that had no reader),
   `ac_simulation.tsx`, `offline_intel_gathering.tsx`, and `MetricTab.tsx` (dropped both props;
   the `!showMetricValueChanges &&` conditional is now unconditional, since it was always true in
   practice - same rendered output, less dead code). While fixing the `tsc` fallout, found two
   **entirely orphaned files** with zero live callers anywhere in the app -
   `PerformanceDashboard.tsx` and `AcRevealPanel.tsx` (confirmed via
   `git diff --stat main...graph-redesign` that both predate this branch, unchanged by it).
   `PerformanceDashboard.tsx` still had to be patched to keep `tsc -b` green (it also called
   `MetricTab` with the now-removed props) but is not wired up anywhere - flagging both files as
   **proposed deletions** per the review's hard rule rather than removing them myself; see below.
   Full suite: `tsc -b --force` 0 errors, `npm test` 18 passed, backend suite unaffected (205
   passed - these are frontend-only files).

10. `StakeholderDossier.tsx:274` — exporting `phaseLabel` (needed so item 1's bug fix could be
    unit-tested directly) trips `react-refresh/only-export-components`, since the file now exports a
    non-component value alongside the default component export. Deliberate, small trade-off: one new
    lint warning-level item in exchange for a real regression test on a real bug (item 1). The clean
    fix — move `phaseLabel` into a small shared `dossierUtils.ts` — would create a file outside batch
    D's list; left as is and flagged for whoever next does a lint-zero pass on this file.

11. `GraphDebug.tsx` sections 6–8 (Intel index / Objections / Action cards) still render "Available in
    plan 05/06" placeholders. Cross-checked against the backend
    (`game-api/.../graph_service/debug.py`): it still sends `"intel_index": []`, `"objections": []`,
    `"action_cards": []` with `# plan 05` / `# plan 06` comments, so frontend and backend agree — not
    a frontend/backend contract mismatch. `STATE.md` now shows plans 05 and 06 as largely done,
    though, so this stub view is stale relative to the rest of the branch and worth a follow-up to
    actually populate these three debug sections. Out of scope for a surgical batch-D fix since it
    needs backend changes to `debug.py`, which belongs to batch A's file list, not this batch's.

12. `game-ui/src/components/glossary/glossaryMatcher.ts` — real, non-trivial logic (regex
    construction from surface forms + aliases, plural-suffix handling, per-term match caps, a
    malformed-term guard) with zero test coverage. No bug was found in it during review (traced
    through by hand against several inputs), so there is nothing to fix, but it's exactly the kind of
    logic the review's test-coverage criterion is aimed at and the game has zero glossary tests.
    Flagged for a follow-up rather than adding tests now, since the batch's stated GOAL ties new tests
    to logic actually *fixed* in this pass, not any untested logic encountered along the way.
    **Resolved post-review (2026-09-12), user asked for test coverage**: added
    `glossaryMatcher.test.ts` (11 tests) covering the disabled/null matcher, exact match offsets,
    longest-alternation-wins ordering, plural-suffix matching, the "already ends in s" exclusion,
    the word-boundary guard against hyphenated compounds and longer words, `max_highlights_per_
    term_per_block`, alias matching, disabled-term exclusion, the malformed-term fallback, and
    `termById`. `npm test`: 18 passed, 0 failed.

## Proposed deletions — resolved (2026-09-12)

Two files with **zero live callers anywhere in the app** (`grep -rl` for `<PerformanceDashboard`
and `<AcRevealPanel` across `game-ui/src` found nothing), found while resolving item 9 above and
originally left as proposed deletions per the review's hard rule against deleting anything
without confirmation. The user reviewed both and asked for them to be actively merged and
removed:

- **`AcRevealPanel.tsx` — merged into `ac_simulation.tsx`, deleted.** Its "Action Card Played!"
  reveal (the card rendered via `ActionCardComponent` with `showValues`/`displayMetrics`) is now
  a section at the top of `ac_simulation.tsx`'s report card, sourced from a new `playedCard` prop
  (`Game.tsx`'s existing `pitchedActionCard` state, threaded through). The old full-screen overlay
  treatment is gone — reveal and delta report are one continuous screen now, matching how the
  merged pitch phase already treats everything else post-commit.
- **`PerformanceDashboard.tsx` — merged into the renamed `PipelineView.tsx` → `PerformanceView.tsx`, deleted.**
  Its two live sections (`PhaseOverview`, `MetricTab`) are superseded by a new `GameplayMetrics`
  panel inside the performance modal, reading live values from `MetricsContext` (kept current by
  the existing `game:state_update` websocket event); its third, never-filled "MLOps Project Graph"
  section is exactly what `PerformanceView`'s pipeline strip already was. The `[ Pipeline ]` dossier
  header button (`StakeholderDossier.tsx`) is now `[ Performance ]` (`ph:gauge-bold`), and every
  `onPipelineToggle`/`isPipelineOpen` prop across `Game.tsx`, `pitch_phase.tsx`,
  `offline_intel_gathering.tsx` and `StakeholderDossier.tsx` was renamed to
  `onPerformanceToggle`/`isPerformanceOpen` for consistency.

Both removals verified: `tsc -b --force` 0 errors, `npm test` 18 passed, repo-wide `eslint` at 287
problems (270 errors/17 warnings) — down from the 309-problem baseline this review documented, no
new errors introduced. Backend suite unaffected (209 passed, frontend-only change).

## Reviewed, no issue found

- `PowerInterestMatrix.tsx:125-173` — `categorized[quadKey]` falls back to the `"low-low"` bucket for
  an unrecognized power/interest combination, which looked like a possible silent-misclassification
  bug at first read. Checked against `gameConfigSchemas/GameProgression.schema.json`: `power` and
  `interest` are schema-enforced to the enum `["high", "low"]` only, so the fallback branch is
  unreachable with valid config — defensive code, not a bug.
- `ac_simulation.tsx` — clean and thin; renders exactly what `graph:delta_report` sends and does no
  client-side metric arithmetic, consistent with D39 (the pipeline alone owns metric numbers).
- `StakeholderDossier.tsx` D45/D43/D44 spot-check — the environment page is correctly excluded from
  the stakeholder tab strip (`if (st.is_environment) return null`) with a dedicated `[ System ]`
  header button toggling it, matching D45; the `CONTESTED` badge renders straight off the
  server-computed `item.contested` flag with no client-side re-derivation, so D43's strict scoping
  lives entirely on the backend as decided, and this component just displays it; `intel_total` per
  stakeholder (not a raw items-remaining count) backs the hollow "not found yet" pips, consistent
  with D44's server-side `intel_to_be_found_this_phase` decoupling.
- `glossary/GlossaryText.tsx`, `GlossaryPreview.tsx` — read fully, no correctness issues; `no-explicit-any`
  and `react-refresh/only-export-components` are pre-existing (see item 8).

(See "Proposed deletions — resolved" above — the two files this batch's own review found were
the only ones proposed, and both are now merged in and removed.)
