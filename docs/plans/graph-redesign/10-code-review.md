# Code review: graph-redesign vs main

Diff is 326 files, +43008/-9238 (`git diff --stat main...graph-redesign`). Reviewing that in one
pass is not useful — findings get shallow and nothing is traceable afterwards. This plan splits the
diff into batches by module, each independently reviewable, each run through `/code-review` (or
manual read for the smaller ones) at high effort, findings logged inline, fixes applied and checked
off before moving to the next batch.

## Scope filter

326 changed files split like this (numstat over `main...graph-redesign`, generated content excluded):

| Category | Files | Review depth |
|---|---|---|
| `game-api/src` + `game-api/tools` (excl. generated output) | 92 | Full |
| `game-ui/src` | 44 | Full |
| `game-api/tests` | 13 | Full (coverage + correctness of the tests themselves) |
| `gameConfig/*.json` (data) | 13 | Light — cross-check against schema + domain code, not line-by-line |
| `gameConfigSchemas/*`, `gameConfigUISchemas/*` | 11 | Light |
| `docs/plans/graph-redesign/*` | 16 | Skip — planning docs, not shipped code |
| `game-api/alembic/versions/*` | 7 | Full — migrations are hard to undo once merged |
| `tools/content_gen/work/out/**` (generated artifacts/objections/fragments) | 119 | Spot-check only, 3-5 samples per kind |
| CI/Docker/Makefile/misc docs | ~8 | Light |

Full + light review covers ~185 files; the 119 generated-content files are data produced by the
content harness in plan 04 and are gated by its own validators (`payload_errors`, hash ledger) —
spot-checking is enough unless a batch review turns up a generator bug that would taint all of them.

## Review criteria (apply to every batch)

1. **Correctness** — logic bugs, off-by-one, wrong invariant, race conditions in websocket handlers,
   state machine transitions that don't match the `D`-numbered decisions in `STATE.md`.
2. **Redundancy** — duplicated logic between old and new code paths (legacy screens were deleted in
   06/impl notes — check nothing dead still references them), duplicated logic across
   `pitch_debate_service` vs `graph_service`, repeated computation that belongs in one of the "pure"
   modules (`scoring.py`, `pipeline.py`) per D39.
3. **Efficiency** — anything O(n²) over components/edges/intel items that doesn't need to be,
   redundant DB round-trips in handlers, recomputation of effective levels instead of caching within
   a request.
4. **Consistency with decisions** — spot-check against `STATE.md`'s Decided table (D1-D46) for the
   area under review; flag anything that silently diverges.
5. **Test coverage** — does the batch's test file actually exercise the new branches, or just the
   happy path?

Findings go in the batch's own subsection below as a flat list: `file:line — issue — fix status`.

## Baseline (established 2026-09-12, before any review fixes)

Comparison point: tag `pre-code-review-2026-09-12` on `graph-redesign`. Diff any later state against
it to see exactly what the review changed; hard reset to it if a batch's fixes need to be discarded.

**Backend** — `docker compose up -d postgres api` (already running, code/tests are bind-mounted, no
rebuild needed unless `pyproject.toml`/`alembic.ini` change), then:
```
docker compose exec api sh -c "pip install -q pytest && python -m pytest tests -q"
```
Baseline: **193 passed, 0 failed.** This is the hard gate — no batch may leave this suite red.

**Frontend** — `game-ui` had no test tooling at all before this review. Added as prerequisite setup
(not a review finding): `vitest`, `@testing-library/react`, `@testing-library/user-event`,
`@testing-library/jest-dom`, `jsdom` as devDependencies, `npm test` → `vitest run --passWithNoTests`,
`vite.config.ts` test block, `src/setupTests.ts`. Verify with:
```
docker compose exec ui npm test    # vitest, jsdom + RTL
docker compose exec ui npm run lint
docker compose exec ui npx tsc -b --force
```
Baseline is **not clean**:
- `npm test`: 0 test files, passes (exit 0) with `--passWithNoTests`. No behavioral gate exists yet
  for frontend — batch D is expected to *add* focused tests for what it touches, growing this from
  zero rather than inheriting a suite to keep green.
- `npm run lint`: **292 pre-existing errors, 17 warnings** repo-wide (mostly `no-explicit-any` in
  `services/websocket/*` and elsewhere, not introduced by this branch). Whole-repo lint is not a
  usable gate. Batch D's goal is scoped: `npx eslint <changed files>` must not *increase* the error
  count on files it touches.
- `npx tsc -b --force`: **30 errors, all in 5 files**: `Game.tsx`, `GraphDebug.tsx`,
  `PipelineView.tsx`, `StakeholderDossier.tsx`, `pitch_phase.tsx`. The last four are net-new files on
  this branch (0 deletions in numstat) — these are real, in-scope findings for batch D, not noise to
  route around. `Game.tsx` predates the branch; confirm on `main` before attributing.

## Batches

| # | Batch | Files | Status |
|---|---|---|---|
| A | Graph core & domain | `domain/graph.py`, `graph_factory.py`, `graph_predicates.py`, `pattern.py`, `graph_service/{apply,effective,predicates,stage_graph,store,debug,graph_state_view,pipeline,view}.py`, `tools/graph_refactor.py` | TODO |
| B | Content generation harness | `tools/content_gen/**` (excl. `work/out`), `test_content_gen.py` | TODO |
| C | Pitch debate & intel services | `application/pitch_debate_service/{session,scoring,objections,store}.py`, `application/intel_handler.py`, `infrastructure/websocket/handlers/pitch_handler.py`, related handlers | TODO |
| D | Frontend components | `pitch_phase.tsx/.module.css`, `StakeholderDossier.tsx/.module.css`, `PipelineView.tsx`, `GraphDebug.tsx`, `PowerInterestMatrix.tsx/.module.css`, `ac_simulation.tsx`, `offline_intel_gathering.tsx/.module.css`, `glossary/**` | TODO |
| E | Domain models not covered above | `domain/requirement.py`, `domain/grudge.py`, any remaining `domain/*` diffs | TODO |
| F | Migrations | `alembic/versions/{a7b8c9d0e1f2,d4e5f6a7b8c9,e5f6a7b8c9d0,f6a7b8c9d0e1}_*.py` (new) + the 3 edited ones | TODO |
| G | Tests (cross-batch pass) | `game-api/tests/test_{graph_core,graph_patterns,simulation_pipeline,pitch_session,pitch_scoring,content_gen}.py` | TODO |
| H | Config data vs schema | `gameConfig/*.json` cross-checked against `gameConfigSchemas/*`, `gameConfigUISchemas/MLOpsGlossary.uischema.json` | TODO |
| I | Generated content spot-check | sample from `tools/content_gen/work/out/{artifacts,objections,fragments}/` | TODO |
| J | Infra/misc | `.gitlab-ci.yml`, `Dockerfile`, `Makefile`, `docker-compose.yml`, ADRs | TODO |

Order: A and B can run in parallel (graph core doesn't depend on content gen). C depends on A being
clean (pitch/intel consume graph state). D depends on C (frontend consumes the same contracts).
E and F are independent, can slot in anywhere. G runs alongside each of A-C as those land. H and I
last since they're light/spot-check. J whenever convenient.

## Autonomous execution (GOAL loop)

Each batch runs as one autonomous subagent with a fixed GOAL and an iteration budget, not a fixed
script — it reviews, fixes, re-verifies, and repeats until the GOAL holds or the budget is spent. It
does not stop to ask; anything it can't resolve goes to the Findings backlog with a reason.

**GOAL, per batch:**
1. Every criterion in "Review criteria" above has been checked against the batch's files and the
   relevant `D`-numbered decisions.
2. Every finding is either fixed, or logged to the backlog with why it wasn't (needs a design call,
   out of scope, etc.) — never silently dropped.
3. Backend batches (A, B, C, E, F, G): `docker compose exec api python -m pytest tests -q` still
   reports `193 passed` or more, 0 failed.
4. Batch D (frontend): `npm run lint` on the batch's touched files shows no new errors versus the
   baseline list above; `npx tsc -b --force` error count for the batch's files does not increase;
   any non-trivial logic fixed gets a focused Vitest/RTL test, growing `npm test` from its zero
   baseline.
5. Result written to this batch's own findings file (see below), status flipped to DONE in the table.

**Budget**: stop and report after ~40 tool-call iterations or if 3 consecutive fix attempts fail
verification — log the remaining state as BLOCKED with the specific failure, don't keep spending
without visible progress.

**Isolation to avoid write conflicts**: parallel batches never edit this file directly. Each batch
writes to `docs/plans/graph-redesign/review-findings/<batch>.md` (created fresh per batch); this file
gets the status table and the merged Progress log updated once a batch reports back.

**Commit discipline**: one commit per batch once its GOAL is met, scoped to the files it touched
(plus its own findings file). Never batch multiple review-fix commits together — keeps
`pre-code-review-2026-09-12...graph-redesign` bisectable per module.

## Progress log

Update after each batch: what was found, what was fixed, what was deferred and why.

- (empty — fill in as batches complete)

## Findings backlog

Anything found but deliberately not fixed now (out of scope, needs a design decision, etc.) goes
here with a reason, not silently dropped.

- (empty)
