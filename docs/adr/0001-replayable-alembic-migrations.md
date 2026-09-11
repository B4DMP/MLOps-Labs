# 1. Migrations run on startup and must be replayable

Status: accepted, 2026-09-10

## Context

`init_db` calls `Base.metadata.create_all`. That creates missing tables. It never alters an
existing one. Nothing ran alembic, so a new column was silently absent on any database that
already existed.

Databases here start from three states: stamped, empty, or populated but never stamped. The third
is a schema built by `create_all` before alembic was adopted. `0001_initial_schema` cannot be
replayed over it, because it creates tables that already exist.

## Decision

The API applies migrations itself at startup, before `init_db`, in
`infrastructure/database/migrations.py`:

| State | Action |
|---|---|
| `alembic_version` present | `upgrade head` |
| Empty | `upgrade head` |
| Tables, no `alembic_version` | stamp `0001_initial_schema`, then `upgrade head` |

For the third case to work, **every revision after `0001` must be replayable against a database
that already satisfies it**:

- DDL guarded with `IF EXISTS` / `IF NOT EXISTS`, or wrapped in a `DO $$ ... END $$` block that
  checks `information_schema` first.
- Data migrations idempotent.

`0002`, `0003` and `8927ffa2e44b` were retrofitted with those guards. They target `game_data`,
renamed by `b2c3d4e5f6a7`, which a model-built database never had.

Failure raises and stops startup. `AUTO_MIGRATE=false` opts out.

## Consequences

- A new column reaches every database on the next restart. No manual step.
- New revisions carry the guard requirement. An unguarded revision breaks the third state only,
  which is the state that fails silently, so check it when writing one.
- `0001` stays the baseline. It creates tables; do not add table creation to a later revision
  without a guard.
- The Dockerfile copies `alembic.ini` and `alembic/` into the image, so migrating does not depend
  on the compose volume mounts.

## Verifying a new revision

Against the running stack, on a scratch database per state:

```bash
docker exec postgres psql -U mlops_labs -d postgres -c "CREATE DATABASE mig_test;"
docker exec -e POSTGRES_URI="postgresql+psycopg://mlops_labs:mlops_labs@postgres:5432/mig_test" \
  game-api python -c "from mlops_serious_game.infrastructure.database import run_migrations; run_migrations()"
```

Run it twice. The second run must be a no-op. For the third state, load a schema dump with
`alembic_version` stripped out. Drop the scratch databases afterwards.
