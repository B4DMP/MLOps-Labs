# Migrate user/campaign relationships to numeric FKs with ON DELETE CASCADE

## Context

We found that `game-api`'s schema has **zero declared referential integrity**. `User.id` autoincrements but is never used: every per-user table (`GameProgression`, `GameChallenge`, `GameSession.player`, `IntelItem`, `GraphOpLog`, `GameEventRow`) links back to a user only via a bare `user_name` string column, and `User.campaign_key` links to `Campaign` the same way — no `ForeignKey` exists anywhere in `models.py` or any of the 14 Alembic migrations. This was discovered while debugging why the admin panel's "delete player"/"delete all players" actions work (they do, via a hand-maintained list of per-table deletes in `admin_service.py`), but `remove_campaign` was found to have a real gap: it skips `GraphOpLog`, `GameEventRow`, and the LangGraph checkpoint tables, unlike `remove_player` — a direct consequence of there being no DB-level cascade to fall back on.

Decision already made with the user: fix this **thoroughly**, not just patch the gap. That means real numeric FKs (`user_id` → `User.id`, `campaign_id` → `Campaign.id`) with `ON DELETE CASCADE`, replacing every string-based join across ~45 query sites in 12 files. The user was explicit: **never join on strings — always via integer PK/FK.**

Non-goals: `GraphOpLog.source_id` / `GameEventRow.subject_id` (polymorphic refs) are out of scope. The LangGraph `checkpoints`/`checkpoint_writes`/`checkpoint_blobs` tables aren't ORM-mapped and are keyed by a derived `thread_id` string (`MLOps_Convo_{player}` / `Online_Intel_{player}`) — they can't hold a real FK, so they stay app-level cleanup, just fixed to be consistent across all three admin delete paths.

## Target schema

Add real FK columns, keep the old string columns temporarily as a migration safety net (dropped in the final phase), never use the string columns for joins/filters again once the migration lands:

- `User`: add `campaign_id: Integer, ForeignKey("campaign_data.id", ondelete="CASCADE"), nullable=False, index=True`. Keep `campaign_key` **permanently** — it's the real external identity string used by the admin API/UI (`admin_routes.py`, `Admin.tsx`), not just denormalization.
- `GameProgression`, `GameChallenge`, `GameSession`, `IntelItem`, `GraphOpLog`, `GameEventRow`: add `user_id: Integer, ForeignKey("user_data.id", ondelete="CASCADE"), nullable=False, index=True` to each. Keep `GameSession.player` named as-is (no rename — unrelated cosmetic risk); its `user_id` column plays the same role as everywhere else.
- Drop `user_name`/`player` columns from all child tables in a final follow-up migration, once `user_id` is proven live in prod. Do not add `relationship()`s — every call site uses explicit `select`/`delete`, and mixing ORM-level cascade with DB-level `ON DELETE CASCADE` causes double-delete confusion.

File: `game-api/src/mlops_serious_game/infrastructure/database/models.py`.

## Migration strategy (Alembic, follow `0001_initial_schema.py`'s style)

Three migrations, run as separate deploys (see phasing below) — do not enforce constraints in the same migration that adds the columns, since old app code will still be writing string-only rows in between:

1. **`add_numeric_fk_columns`**: add all `user_id`/`campaign_id` columns as `nullable=True`. Backfill via `UPDATE ... FROM` joins on the existing string columns (`user_name`/`player` ↔ `User.user_name`, `campaign_key` ↔ `Campaign.campaign_key`). After backfill, assert zero `NULL`s remain per table (`_assert_no_orphans` helper) and **raise/abort the migration** if any are found — don't silently drop orphaned rows; a leftover orphan indicates a real data bug worth investigating by hand.
2. **`enforce_fk_constraints`**: re-run the backfill (idempotent, catches rows written by old code during rollout) and the orphan check, then `alter_column(nullable=False)`, `create_foreign_key(..., ondelete="CASCADE")`, and `create_index` for each new column.
3. **`drop_legacy_string_columns`** (later, separate deploy after prod bake-in): drop `user_name`/`player` from all child tables. Never drop `User.campaign_key`/`Campaign.campaign_key`.

Each migration's `downgrade()` mirrors `0001_initial_schema.py`'s explicit drop-index/drop-column style; downgrades are allowed to be destructive re: data (matches existing precedent in `test_migrations.py`).

## Application code changes

Introduce one shared, stateless helper rather than repeating username→id lookups ad hoc at 45 sites:

```python
# game-api/src/mlops_serious_game/infrastructure/database/user_lookup.py
def get_user_id(session: Session, username: str) -> int | None:
    return session.scalar(select(User.id).where(User.user_name == username))
```

Export it alongside `User`/`Campaign`/`get_session` from the `infrastructure/database` package (not `auth_service.py` — keeps it a peer of the ORM primitives rather than adding an application-layer dependency into every handler).

Rewrite pattern applied uniformly:
- `select(X).where(X.user_name == username)` → resolve `user_id` (via the helper, or reuse an already-fetched `User.id` when one's already in scope — several call sites in `game_handler.py` already fetch `User` to read `campaign_key` and can just use `user.id`/`user.campaign_id` directly, which also turns the three existing `Campaign.campaign_key == user.campaign_key` lookups into plain `Campaign.id == user.campaign_id` equality joins) → filter on `X.user_id == user_id`.
- Row constructors (`GameProgression(...)`, `GameChallenge(...)`, etc.) get `user_id=user.id` added alongside the existing `user_name=username` argument during the dual-write phase.

No per-connection `User` cache — sessions are opened fresh per handler call already (confirmed pattern across `game_handler.py`), and `user_name` is uniquely indexed, so a cache would add invalidation complexity for no measured win.

Files to update (all 45 sites, same pattern throughout — representative list, not exhaustive line-by-line):
- `application/services/admin_service.py` (collapses — see below)
- `infrastructure/websocket/handlers/game_handler.py` (heaviest: `handle_game_init`, `store_or_update_challenge`, the 3 `Campaign` lookups)
- `application/intel_handler.py`, `application/graph_service/store.py`, `application/pitch_debate_service/store.py`, `application/event_log_service/store.py`
- `application/services/auth_service.py` (`authenticate_user`, `register_user`)
- `infrastructure/websocket/handlers/pitch_handler.py`, `chat_handler.py`, `gather_handler.py`, `intel_handler.py`
- `infrastructure/routes/admin_routes.py`

No `game-ui` changes — the REST/WS API contract stays username/campaign_key-based at the boundary; only internal DB joins change.

## `admin_service.py` simplification

Once cascade is enforced (post `enforce_fk_constraints`), collapse `remove_player`/`remove_all_players`/`remove_campaign` through one shared helper so the checkpoint-cleanup gap in `remove_campaign` can't recur:

```python
def _cleanup_and_delete_user(session, user: User) -> None:
    _delete_checkpoints_for_threads(session, _player_thread_ids(user.user_name))
    session.delete(user)  # cascades every FK child table
```

- `remove_player`: look up the `User`, call `_cleanup_and_delete_user`.
- `remove_all_players`: loop all `User` rows through the same helper (keep `_delete_all_checkpoints` for the bulk checkpoint case).
- `remove_campaign`: loop the campaign's `User` rows through the same helper (fixes the missing GraphOpLog/GameEventRow/checkpoint cleanup), then delete the `Campaign` row. Per-table `delete(GameProgression).where(...)` etc. all get removed — cascade handles them.

Deploy this only after cascade constraints are actually live in prod (section below) — running it earlier would silently under-delete.

## Rollout phasing (each phase has an independent rollback path)

1. **Phase A** — deploy `add_numeric_fk_columns` only. Old app code keeps working unchanged (nullable columns, nothing reads them yet). Rollback = plain `alembic downgrade`.
2. **Phase B** — deploy the `models.py` diff + `user_lookup.py` + all call-site rewrites (dual-write: both `user_id` and the legacy string column populated on every insert). No new migration. Test in staging first. Rollback = revert the app-code deploy; schema is untouched since columns are still nullable.
3. **Phase C** — deploy `enforce_fk_constraints`, only after Phase B has run in prod long enough to trust backfill (no orphan-check failures in staging, spot-checked prod counts). Rollback = `alembic downgrade` (drops constraint/NOT NULL only).
4. **Phase D** — deploy the `admin_service.py` simplification. Must come after Phase C (relies on cascade actually being enforced).
5. **Phase E** — deploy `drop_legacy_string_columns`, after Phase C/D have baked in prod. Rollback re-adds nullable columns (no attempt to restore string values — trivially re-derivable via join if ever needed).

## Verification

`game-api/tests/` currently has no coverage of `admin_service.py`, `auth_service.py`, or `game_handler.py` — only `test_migrations.py` (Alembic chain) and domain-logic tests (graph/pitch/intel/simulation). So:

- **Write fresh integration tests** for `remove_player`/`remove_all_players`/`remove_campaign`, using the real-Postgres fixture pattern already in `test_migrations.py` (create DB, migrate to head, exercise ORM, drop DB) — assert zero rows remain in every child table (including checkpoint tables) after each delete path. This directly closes the loop on the `remove_campaign` gap.
- **Extend `test_migrations.py`**: after `upgrade("head")`, assert the FK constraints/`NOT NULL`/indexes exist via `information_schema`; add a backfill test that seeds string-only pre-migration rows plus one deliberately orphaned row, and asserts the orphan aborts the migration while valid rows backfill correctly.
- Run via the project convention: `docker compose exec api pytest tests/ -q` (or `docker exec game-api pytest tests/ -q`); rebuild via `docker compose build api` first if `pyproject.toml` gains new deps (none expected here).
- **Manual smoke test** (staging, before promoting Phase B/C to prod): register a user → play a full challenge loop → confirm every child table's `user_id` matches `User.id` → delete that player via the admin panel → confirm every table (incl. checkpoints, via `SELECT * FROM checkpoints WHERE thread_id LIKE '%<username>%'`) is empty → repeat with a multi-user campaign delete → confirm cascade covers all users' data and the campaign row is gone.

### Critical files
- `game-api/src/mlops_serious_game/infrastructure/database/models.py`
- `game-api/alembic/versions/0001_initial_schema.py` (style reference for new migrations)
- `game-api/src/mlops_serious_game/application/services/admin_service.py`
- `game-api/src/mlops_serious_game/application/services/auth_service.py`
- `game-api/src/mlops_serious_game/infrastructure/websocket/handlers/game_handler.py`
- `game-api/tests/test_migrations.py`
