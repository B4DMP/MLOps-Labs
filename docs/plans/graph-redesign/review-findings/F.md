# Batch F — Alembic migrations — findings

Scope: `game-api/alembic/versions/{a7b8c9d0e1f2,d4e5f6a7b8c9,e5f6a7b8c9d0,f6a7b8c9d0e1}_*.py`
(new) plus the three edited migrations (`0002_add_attention_tokens.py`,
`0003_replace_messages_column.py`, `8927ffa2e44b_added_emotion_values.py`).

## Chain verification (method)

Traced `down_revision` links by hand across every file in `alembic/versions/` (not just the
7 in scope, since the chain only makes sense read against its neighbors), then cross-checked
with `docker compose exec api python -m alembic history` (reads revision files only, no DB
connection/mutation). Result: one linear chain, one head.

```
<base> -> 0001_initial_schema -> 0002_add_attention_tokens -> 0003_replace_messages_column
       -> 8927ffa2e44b -> a1b2c3d4e5f6 -> b2c3d4e5f6a7 -> c3d4e5f6a7b8
       -> d4e5f6a7b8c9 -> e5f6a7b8c9d0 -> f6a7b8c9d0e1 -> a7b8c9d0e1f2 (head)
```

No forked history, no duplicate `down_revision`, `Create Date` values are monotonically
increasing along the chain. Model columns in `infrastructure/database/models.py`
(`GameSession.escalation_points/grudges/stakeholder_personas`, `GraphOpLog.*`) match the
columns/types/nullability/defaults each migration adds, and the env-var table names
(`POSTGRES_GAME_SESSION_DATA_TABLE`, `POSTGRES_GRAPH_OP_LOG_TABLE`, `POSTGRES_INTEL_DATA_TABLE`)
match `config.py` defaults.

## Findings

- `game-api/alembic/versions/0002_add_attention_tokens.py:11` — unused `import sqlalchemy as sa`
  left over from the pre-edit `op.add_column(...)` form; the guarded upgrade/downgrade now use
  raw `op.execute(...)` SQL strings only. Fixed — import removed, `py_compile` and
  `alembic history` re-verified clean.
- `game-api/alembic/versions/0003_replace_messages_column.py:11` — same unused `import sqlalchemy
  as sa`. Fixed — import removed.
- `game-api/alembic/versions/8927ffa2e44b_added_emotion_values.py:11-12` — unused `import
  sqlalchemy as sa` and `from sqlalchemy.dialects import postgresql`, same cause. Fixed — both
  imports removed.
- `game-api/alembic/versions/0002_add_attention_tokens.py` (upgrade, `DEFAULT 5`) vs
  `infrastructure/database/models.py:56` (`attention_tokens: ... default=8`) — the DB-level
  column default (5) has never matched the SQLAlchemy-level Python default (8) applied by the
  ORM on insert. Pre-existing on `main` (the diff here only wrapped the same literal `5` in a
  guarded `DO $$` block for idempotent replay, it did not introduce the mismatch). Deferred —
  out of scope for this batch (no line in the reviewed diff changed the value), and fixing it
  is a one-line judgment call on which number is actually right (game balance concern, not a
  migration-safety one) that belongs with whoever owns `attention_tokens` tuning, not a
  migration-chain review.
- `game-api/alembic/versions/f6a7b8c9d0e1_retag_intel_items.py:65-67` — `categorized_type`
  remapping uses the unconditional `GENERIC` dict (`"requirement" -> "boundary"`) rather than
  the refusal-language regex used for the ground-truth `type` field, so a legacy
  `categorized_type == "requirement"` always becomes `"boundary"` regardless of the item's
  actual description. Checked against the file's own docstring: this is explicit, documented
  behavior ("A wrong tag maps with the generic rule and may, in rare cases, now count as
  right; this only touches development data") and only affects a player's own (already
  possibly-wrong) guess on disposable dev data (D10/D34). Not a bug — no fix needed.
- `game-api/alembic/versions/f6a7b8c9d0e1_retag_intel_items.py:73` — `upgrade()` loads every
  `intel_data` row into memory and issues one `UPDATE` per changed row rather than batching.
  Fine for one-off dev-data migrations on the table sizes this game produces; not a hot path.
  Deferred — not worth the complexity for a migration that runs once per environment.
- `e5f6a7b8c9d0_add_graph_op_log.py` downgrade (`DROP TABLE IF EXISTS`) is a genuine full data
  loss of the append-only op log, which is the *only* stored representation of a player's graph
  state per the table's own docstring. Confirmed this is the correct call, not an oversight:
  D34 says gameplay data is wiped/disposable in dev, D10 says no backwards compatibility is
  needed, and a downgrade that undoes "create table" necessarily loses whatever only existed
  because of that table. No fix needed; noting it here since the review prompt asked to
  explicitly re-confirm D10/D34 applicability per file rather than assume it.
- `a7b8c9d0e1f2_add_escalation_points_and_grudges.py`, `d4e5f6a7b8c9_add_stakeholder_personas.py`
  — straightforward `ADD COLUMN ... DEFAULT ...` / `DROP COLUMN IF EXISTS` pairs. Defaults are
  `NOT NULL` with a concrete default value in both directions, safe for existing rows in
  `game_session_data`. No issues.
- No test coverage exists for any alembic migration in this repo (none of the other 4 migrations
  outside this batch have one either — no `tests/test_migrations*.py` file exists at all).
  Deferred as a pattern question rather than a batch-F-specific gap: adding a migration test
  harness is a repo-wide decision, not something to bolt onto one batch's review.
  **Resolved post-review (2026-09-12), user asked for migration test coverage**: added
  `tests/test_migrations.py` — see `review-findings/migrations-test-harness.md` for the full
  writeup. It immediately caught a real `KeyError` crash in `c3d4e5f6a7b8` against current
  content (fixed) and surfaced one genuine, unfixed gap (`intel_data` isn't alembic-managed at
  all, flagged for a maintainer). 2 new tests, both passing; full suite 207 passed, 0 failed.

## Verification performed

- Read every file in scope plus the 4 out-of-scope migrations needed to trace the full chain
  from `<base>` (`0001_initial_schema`, `a1b2c3d4e5f6`, `b2c3d4e5f6a7`, `c3d4e5f6a7b8`) —
  read-only, not edited.
- `git diff main...graph-redesign` on the 3 edited files to confirm the only substantive change
  is wrapping existing `op.add_column`/`op.drop_column` calls in guarded, idempotent raw SQL
  (`DO $$ ... IF EXISTS ...`) for replay-safety against a database created straight from
  `models.py` at head rather than migrated from base — not a behavior change to column
  types/defaults themselves (aside from the already-existing `5` vs `8` mismatch noted above).
  Diff and rationale check both fine.
- `docker compose exec api python -m py_compile <file>` on all 7 files in scope, before and
  after the import-cleanup fix — clean both times.
- `docker compose exec api python -m alembic history` before and after the fix — same single
  linear chain both times, head still `a7b8c9d0e1f2`.
- `docker compose exec api sh -c "python -m pytest tests -q"` — **193 passed, 0 failed**,
  matching the baseline gate in `10-code-review.md` (no live DB migration commands were run,
  per the batch's hard constraint — this is the existing pure test suite only).

## Status: DONE

All 4 review criteria applied (correctness, redundancy, efficiency, consistency with
D-decisions; test coverage noted as a pre-existing repo-wide gap, not batch-specific). Every
finding above is either fixed or logged with a reason. No proposed deletions.
