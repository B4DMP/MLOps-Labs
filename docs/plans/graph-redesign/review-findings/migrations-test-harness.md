# Migration test harness (item 15, post-review follow-up)

Added `game-api/tests/test_migrations.py`: the repo's first migration tests, resolving the gap
batches F and J both flagged ("no migration test harness exists anywhere in the repo").

## What it does

Two tests, both against a throwaway `test_migrations_<uuid>` database created and dropped per
test on the same postgres server - **never** the shared dev database:

1. `test_upgrade_head_then_downgrade_base_round_trips_cleanly` - runs the full chain forward
   (`alembic upgrade head`) then back (`alembic downgrade base`), asserting every alembic-managed
   table is gone afterward.
2. `test_upgrade_head_is_idempotent` - `upgrade head` twice in a row must be a no-op, matching
   what a redeployed API with `AUTO_MIGRATE=True` does on every restart.

Skips gracefully (not a failure) if no postgres is reachable, so the otherwise DB-free backend
suite still runs standalone anywhere (a bare CI runner without a postgres service included).

## Two real bugs this immediately caught

1. **`c3d4e5f6a7b8_unify_intel_item_payload_shape.py`** crashed with `KeyError: 'stakeholder_id'`
   on the very first upgrade run against current content. It read
   `str(entry["stakeholder_id"])` unconditionally from `gameConfig/RequirementObjects.json`, but a
   Fact-type requirement's `stakeholder_id` is legitimately absent/null (plan 02: a Fact is about
   the environment, not a person - `StakeholderRequirement.stakeholder_id: Optional[str] = None`).
   This migration would have failed for anyone running it fresh against the current config.
   **Fixed**: `entry.get("stakeholder_id")`, stringified only if not `None`.
2. My own test harness bug, not the app's: `settings.POSTGRES_URI = str(sqlalchemy_url)` embeds a
   literal masked `"***"` password (SQLAlchemy's `URL.__str__` hides it by default), which made
   every migration connection attempt fail with a genuine-looking but misleading "password
   authentication failed" error. Fixed with `url.render_as_string(hide_password=False)`. Noting
   this since it cost real debugging time and is an easy trap for anyone else building a similar
   harness against this codebase.

## One real, unfixed gap this surfaced (not fixed here - needs a decision)

**`intel_data` is not alembic-managed at all.** No migration anywhere has an
`op.create_table('intel_data', ...)` - the table exists only because
`infrastructure/database/connection.py`'s `Base.metadata.create_all(bind=engine)` creates
whatever's in `Base.metadata` but missing from the database (the "populated but never stamped"
case `migrations.py`'s own docstring already documents as a known startup scenario). Consequences:
- A full `alembic downgrade base` cannot drop it (alembic has no record of creating it), which is
  why the round-trip test explicitly excludes it rather than asserting a truly empty schema.
- Any future *column* change to the `IntelData`-backed model (whatever class has
  `__tablename__ = settings.POSTGRES_INTEL_DATA_TABLE`) has no migration path at all -
  `create_all()` only adds missing tables, it never alters existing ones. A column add/rename/drop
  on this table today would need to be hand-written as a raw migration with no
  `create_table`/`drop_table` pair to follow as a model.

This is a real gap in schema-lifecycle coverage, but fixing it (writing the missing
`create_table` retroactively, and deciding whether to special-case its downgrade to preserve
existing installs' data) is a design decision outside a test-harness change - flagging here for a
maintainer, not fixed blind.

## Verification

`docker compose exec api python -m pytest tests/test_migrations.py -v`: 2 passed. Full suite:
207 passed, 0 failed (was 205 before this file). Confirmed no throwaway databases left behind
(`SELECT datname FROM pg_database WHERE datname LIKE 'test_migrations%'` returns nothing after a
clean test run).
