# Batch G findings — Cross-cutting test review

Scope: `game-api/tests/test_{graph_core,graph_patterns,simulation_pipeline,pitch_session,
pitch_scoring,content_gen,graph_refactor}.py`, reviewed together (not per-module) for shared
fixtures, assertion-style consistency, and coverage gaps only visible when the files are compared
side by side. Batches A, B, C, E had already reviewed these files for their own modules' concerns
and explicitly flagged three items below for this batch; the rest were found by the cross-module
comparison this batch is for.

This file list arrived with batches A/B/C/E's own fixes and regression tests already applied
(git showed these five files as already modified before this batch started), so the plan's 193
gate had already grown; see Verification for the number actually measured in this session.

## Fixed

- `game-api/tests/test_graph_core.py` — no test exercised `validate_predicate` rejecting a
  non-`eq`/`ne` op on an `attr` or edge+`trigger` clause, even though `evaluate()` raises
  `PredicateError` at runtime for exactly that (batch A's fix to
  `domain/graph_predicates.py:172-173,180-181`, flagged explicitly for this batch: "flagging for
  batch G to add a case"). Added
  `test_validate_predicate_rejects_non_equality_ops_on_attr_and_trigger_clauses`. — **fixed**.

- `game-api/tests/test_graph_patterns.py` — D42's chain-link validation gate
  (`requirement_factory.payload_errors`'s `refines_id` block: unknown parent, stakeholder
  mismatch, target mismatch, non-forward phase, invalid tag transition) had zero direct test
  coverage; batch E fixed/verified the gate but explicitly deferred the test to this batch
  ("test files are out of this batch's file list ... the plan explicitly routes test-coverage
  work for cross-cutting gates like `payload_errors` there"). Added
  `test_chain_gate_enforces_d42_parent_stakeholder_phase_and_tag_narrowing`, which builds an
  isolated fake `PhaseFactory.phases`/`RequirementFactory.requirements` (saved/restored, same
  pattern as the existing `test_payload_gate_rejects_mismatched_payloads`) and asserts all four
  `refines_id` error messages fire together. — **fixed**.

- `game-api/tests/test_pitch_session.py` — comparing this file against `test_pitch_scoring.py`
  and against batch C's fix log surfaced that the regression case for C's own fix
  (`session._boundary_target` falling back to `holds.component` when a Boundary carries no
  `suggested`/`ops` of its own — batch C: "no existing test exercised the fallback path so
  nothing needed updating") was never actually added anywhere. The existing
  `test_boundary_on_an_unknown_target_is_reported_as_uncheckable` sets `suggested` *and* `holds`
  together, so it exercises the `suggested`-based path, not the fallback. Added
  `test_a_pure_boundary_with_no_suggested_still_gets_a_fog_target_from_holds`, which omits
  `suggested`/`ops` entirely — this is exactly the shape production content already uses in 10/10
  cases per C's note, and would have failed before C's fix (target would resolve to `None`, the
  fog check would be skipped entirely, and the true violated/not state would leak). — **fixed**.

- `game-api/tests/test_pitch_scoring.py` — `objections.fire_objections`'s own docstring names
  five objection kinds fired in order: "boundary → technical → stance → price → correction".
  Comparing `TestFireObjections` here against `test_pitch_session.py`'s
  `test_objections_fire_for_uncovered_drivers_and_violated_boundaries` (also only exercises
  stance + boundary) showed that **two of five kinds — `technical` and `price` — had no test
  anywhere in the 200+-test suite**, a gap only visible by lining up every place `fire_objections`
  is exercised. Added `test_technical_objection_fires_on_a_capped_card_item` and
  `test_price_objection_fires_on_an_uncompensated_trade_off`. — **fixed**.

- `game-api/tests/test_graph_core.py`, `test_graph_patterns.py`, `test_graph_refactor.py` — these
  three had no module docstring while the other four in-scope files
  (`test_simulation_pipeline.py`, `test_pitch_session.py`, `test_pitch_scoring.py`,
  `test_content_gen.py`) each open with a one-line docstring naming the plan/module under test.
  Minor, but exactly the "reads as 7 unrelated files vs. one coherent suite" concern this batch
  exists to catch. Added a matching one-liner to each of the three. — **fixed** (pure
  documentation, no behavior change).

## Reviewed, no fix needed (shared-fixture concern already resolved)

- `game-api/tests/conftest.py` (new, untracked, not in this batch's file list) already
  consolidates the `config_dir`/`real` fixtures that `test_graph_core.py`, `test_graph_patterns.py`,
  `test_simulation_pipeline.py` and `test_pitch_session.py` all need — its own docstring says so
  ("copied near-verbatim into four test files ... this is the one place"). Confirmed by reading
  all four files: none defines a local `config_dir`/`real` fixture any more, all just take them as
  pytest fixture parameters. This is exactly the top-level "duplicated fixtures across files"
  finding this batch was asked to look for, and it was already fixed (by an earlier pass, not
  attributed to any batch's findings file) before this review started — nothing left to do here,
  and `conftest.py` is not in this batch's edit list regardless.

## Deferred (logged, not fixed)

- `game-api/tests/test_pitch_session.py:12-28` (`_item`) vs `game-api/tests/test_pitch_scoring.py:22-39`
  (`_item`) — two near-identical `SimpleNamespace` builders for a "minimal intel item stand-in",
  each in a file this batch is allowed to edit, but they carry different field sets: session's
  version adds `holds`/`ops` (needed by `session.boundary_checks`/`predictions_for`, which
  `test_pitch_session.py` exercises); scoring's version adds `intel_type=ConfidenceType.VERIFIED`
  (traced — unused by `scoring.py`/`objections.py`/`session.py`; only the legacy
  `pitch_debate_service/{nodes,service}.py` LangGraph stack reads `intel_type`, so it's vestigial
  here). Checked whether this is a dangerous silent-drift risk (the kind where a future required
  field lands in one file's fixture and not the other, hiding a real gap): traced every attribute
  each consuming function reads via `getattr(item, ..., None)` with a safe default, so today
  neither omission causes a false pass. Not fixed: a true single source of truth for this stand-in
  belongs in `conftest.py`, which is outside this batch's file list (see previous section); fixing
  it inside just these two files would mean picking one file's shape as canonical and duplicating
  it verbatim into the other, which doesn't remove the duplication the criterion is actually
  about. Flagging for whoever next touches `conftest.py`.
  **Resolved post-review (2026-09-12), user asked for it explicitly**: added `make_intel_item`,
  `make_target`, `make_concession`, `make_archetype` to `conftest.py` as one superset
  implementation (union of both files' field coverage, including the traced-vestigial
  `intel_type`), and both test files now `from conftest import make_X as _x` so every existing
  call site is unchanged. `_arch()`'s default was unified to `(2, 2, 2)` (the value
  `test_pitch_session.py`'s bare calls actually rely on; `test_pitch_scoring.py` never calls it
  bare, confirmed by grep). Full suite: 202 passed, 0 failed after the change.

- Assertion/structure style: `test_pitch_scoring.py` is the only one of the seven files organized
  as `unittest`-style test classes (`TestFit`, `TestCoverage`, `TestEmotionsNorm`, `TestLoss`,
  `TestBuyIn`, `TestOutcome`, `TestFireObjections`, `TestDialogueOptionsFor`); the other six use
  flat functions grouped under `# ---------- section ----------` comment banners. Genuinely
  inconsistent per the review criteria, but converting a 300-line file's structure either
  direction is a mechanical rewrite touching every existing test, not a surgical fix, and carries
  real risk of a copy-paste slip in a review pass whose job is to leave behavior untouched.
  Deferred; if it's ever touched, flattening `test_pitch_scoring.py` to match the other six is the
  lower-risk direction (nothing here uses class-scoped fixtures/setup that the flat style lacks).

- `_challenge(...)` is defined twice with the same name but different shapes and purposes:
  `test_graph_patterns.py:109-111` builds a real `domain.Challenge` model (for scheduler tests);
  `test_simulation_pipeline.py:33-39` builds a `SimpleNamespace` stub with only the four fields
  `simulate()` reads (`template_id`, `phase_id`, `on_exit_ops`, `stalemate_ops`). Not true
  duplication — different data, different consumers, same name is coincidence of both being "the
  test file's word for a challenge" — but the identical name across two files in the same suite
  invites a reader jumping between them to assume interchangeability. Same class of issue batch B
  already logged and left alone for `LEVEL_TALK` in `content_gen`; following that precedent,
  left as is rather than renaming one to avoid manufacturing an unrelated diff.

- Handler-level tests for `infrastructure/websocket/handlers/pitch_handler.py`'s five stage guards
  (added by batch C: `handle_pitch_object`, `handle_pitch_commit`, `handle_pitch_rebuild`,
  `handle_pitch_veto_breaker`, `handle_pitch_concede`) — batch C flagged this for "batch G
  (cross-batch test pass)". Confirmed: still no test file for `pitch_handler.py` exists, and this
  batch's given file list does not include one either (`test_pitch_session.py` only exercises
  `pitch_debate_service.session` directly, never the websocket layer). Not fixed: this needs new
  DB/websocket-layer test fixtures (a running `GameSession`/store, a fake websocket) that none of
  the seven in-scope files have today, which is infrastructure work, not a test-content addition
  to an existing file — and creating a brand new `test_pitch_handler.py` would be a file outside
  this batch's explicit scope list. Re-flagging as a genuine backlog item for whoever owns adding
  websocket-handler test infrastructure (or for the STATE.md maintainer to fold into a future
  batch), since it's now been deferred twice without a home.

- `test_pitch_scoring.py`'s `TestFit` covers perfect match, max distance, no-archetype-neutral, and
  "secondary used when closer"; it does not cover "secondary present but farther than main" (main
  should win, secondary should not help or hurt). Low-value edge case — `fit()`'s own logic is a
  straight `min` over two independently-computed distances, so this is unlikely to hide a real
  bug — but noted since it's the one asymmetry in an otherwise fairly exhaustive `TestFit`. Not
  added, to keep this pass's new tests targeted at gaps that trace to an actual fixed bug or an
  explicit cross-batch ask rather than padding coverage for its own sake.

## Consistency with STATE.md D-decisions

Checked across all seven files as a set (not just individually) for anything that reads
consistently in one file and inconsistently in another:
- D11 (fog of war) — `test_graph_core.py`'s knowledge/observation tests and
  `test_pitch_session.py`'s unknown-target/boundary-fog tests encode the same rule (unobserved →
  no reveal) the same way; the one gap found (pure-Boundary fallback) is fixed above.
- D35 (starved vs. broken health accounting) — only `test_graph_core.py` exercises this directly
  (`test_stage_health_counts_problems_not_maturity`); `test_simulation_pipeline.py`'s health tests
  (`test_a_design_pattern_gained_lifts_stage_health`) check health moves in the right direction
  but don't re-assert the starved/broken split, which is fine — it's the same `stage_graph()` code
  path already covered in the other file, not a gap.
- D39 (simulation pipeline alone owns metric numbers) — `test_simulation_pipeline.py`'s
  `test_metric_delta_is_the_weighted_sum_of_effective_changes` is the only place this is checked
  directly; consistent with D39 assigning this to `pipeline.py` alone, so one test file owning it
  is correct, not a coverage gap.
- D41 ("Let them have it") and D7/veto-breaker — both exercised in `test_pitch_session.py`
  (state-machine level) and `test_simulation_pipeline.py` (pipeline level:
  `test_veto_broken_applies_the_card_and_degrades_the_overridden_area`); the two layers test
  different concerns (session bookkeeping vs. graph/grudge effects) and agree with each other and
  with D41/D38's wording. No divergence found.

## Verification

`docker compose exec api python -m pytest tests -q` run once, after all 5 of this batch's new
tests (across `test_graph_core.py`, `test_graph_patterns.py`, `test_pitch_session.py` and
`test_pitch_scoring.py` x2) plus the 3 docstring-only additions: **202 passed, 0 failed**. Well
above the plan's 193-pass gate; no failures introduced.
