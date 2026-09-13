# Batch B — Content generation harness — review findings

Scope reviewed: `game-api/tools/content_gen/**/*.py` (cli.py, ledger.py, runner.py, context.py,
assemble.py, gates.py, llm.py, stages/{common,templates,items,artifacts,objections,fragments,__init__}.py,
__init__.py, __main__.py) and `game-api/tests/test_content_gen.py`. `scopes.json` (data, not `.py`)
was read for context only, not edited.

Baseline: `docker compose exec api python -m pytest tests/test_content_gen.py -q` → 13 passed before
this pass. After fixes: 14 passed (one regression test added), 0 failed.

## Fixed

- `game-api/tools/content_gen/stages/items.py:371` (`wrong_readings`) — matched an item to a
  requirement id with `requirement_id.endswith("_" + it["key"])`. If one item's key is a suffix of
  another's in the same challenge (e.g. keys `cost` and `extra_cost`), the id
  `gen_<slug>_extra_cost` also ends with `_cost`, so the first item in iteration order (`cost`) won
  the match and the wrong item's "wrong readings" (the distractor readings shown to a player who
  mis-tags the intel) were assembled into `OfflineIntelArtifacts.json`. Fixed to rebuild the exact
  id (`gen_{slug}_{key}`) and compare for equality instead of `endswith`; the function now takes an
  explicit `slug` parameter, and the one call site in `assemble.py:48` was updated to pass
  `ch["template_id"].removeprefix("ch_")`. Added a regression test,
  `test_wrong_readings_does_not_confuse_a_key_that_is_a_suffix_of_another`, which fails against the
  old `endswith` logic and passes now. — fixed

- `game-api/tools/content_gen/stages/fragments.py:12` — a local `LEVELS` list duplicated
  `common.LEVEL_NAMES` verbatim (`["broken", "absent", "manual", "automated", "governed"]`), and
  `common.LEVEL_NAMES` itself was never imported or used anywhere in `content_gen` — pure dead
  code shadowed by the duplicate. Redundancy per review criterion 2. Fixed: `fragments.py` now
  imports and uses `common.LEVEL_NAMES` directly, one source of truth for level names. — fixed

- `game-api/tools/content_gen/stages/artifacts.py:18` — `TAGS = ["driver", "boundary", "trade_off",
  "fact"]` was declared but never referenced anywhere in the file or imported elsewhere. Dead code.
  Removed. — fixed

## Deferred (logged, not fixed)

- `game-api/tools/content_gen/ledger.py:16` (`RUNNING_TIMEOUT_S = 15 * 60`) vs
  `game-api/tools/content_gen/llm.py:39` (`timeout_s: float = 2400`, i.e. 40 minutes per LLM call)
  and `runner.py`'s retry loop (`max_attempts=5` outer, `retries_on_error=3` inner) — a single item
  can legitimately still be in flight for far longer than 15 minutes if it needs several attempts
  (worst case is many multiples of 2400s). `Ledger.sync()` treats any `running` row older than
  `RUNNING_TIMEOUT_S` as abandoned and resets it to `pending`. Within a single `run` invocation this
  is safe (`sync()` runs once, before any item is claimed), but if a second `content_gen run`
  invocation is started concurrently against overlapping items (e.g. a different `--only` glob on
  the same stage) while the first is still working a slow item past the 15 minute mark, the second
  invocation's `sync()` call will incorrectly reclaim it as pending and a race begins: both
  processes can end up generating and writing the same item, and `Ledger.finish`/`fail` accumulate
  `tokens_in`/`tokens_out` (`row.tokens_in + tokens_in`), so the double-run also double-counts
  usage. Not fixed because there is no clean small fix: raising the constant to safely cover the
  worst case (attempts × retries × timeout, which can be several hours) works against its actual
  purpose of promptly detecting a genuinely killed process, and a proper fix (a per-item heartbeat,
  or documenting that concurrent overlapping invocations are unsupported) is a design decision, not
  a surgical patch. Flagging for a maintainer/design call.
  **Resolved post-review (2026-09-12)**: implemented the per-item heartbeat option, per the
  user's stated preference for "shorter runs with more frequent ticks" over one long timeout.
  Added `Ledger.heartbeat(item_id)` (bumps `updated_at` without touching status) and
  `runner._with_heartbeat()`, which wraps the `stage.generate(...)` call and ticks the ledger
  every `HEARTBEAT_INTERVAL_S` (30s) while it's still in flight, cancelling cleanly once it
  resolves. `RUNNING_TIMEOUT_S` dropped from 15 minutes to 90s (3 missed ticks) - a killed
  process is now detected in ~90s instead of up to several hours, while a legitimately slow (but
  alive) single call of any length never goes stale. 2 new tests added (ledger-level and
  `_with_heartbeat`-level); full suite: 205 passed, 0 failed.

- `game-api/tools/content_gen/llm.py:38-71` (`LangchainLLM.__init__`) — when the caller explicitly
  passes `--provider westai` or `--provider mistral` (a way to *force* a specific provider, per the
  class docstring) but that provider's API key is not configured, the fallback chain silently drops
  the forced choice and falls through to whichever of the other providers has a key, or to Groq,
  with no warning. A user who explicitly asked to force WestAI/Qwen (e.g. the Makefile's content-gen
  targets, per the docstring) would silently get a different model if `WESTAI_API_KEY` were unset,
  which is surprising and could quietly generate content with the wrong model. Not fixed: unclear
  whether the silent fallback is intentional convenience (so a dev without every key configured can
  still run something) or a genuine gap that should raise `SystemExit` instead — a product/design
  call, not obviously a bug to "just fix."

- `game-api/tools/content_gen/stages/templates.py:13` vs `game-api/tools/content_gen/stages/items.py:13`
  — both define a module-level `LEVEL_TALK` regex with the same name but different patterns
  (`templates.py` also matches decimals like `2.5`; `items.py` does not). Not true duplication
  (they are used against different kinds of text with different tolerances) but the identical name
  in two files inviting a future reader to assume they're interchangeable is a minor readability
  smell. Left as is — fixing would mean renaming one, which is cosmetic and carries some risk of
  missing a call site; deferred as low priority.
  **Resolved post-review (2026-09-12), user asked for a merge**: moved one shared `LEVEL_TALK`
  (the more inclusive, decimal-matching pattern) into `common.py`; both `templates.py` and
  `items.py` now import it instead of each defining their own. `items.py`'s validation becomes
  slightly stricter as a result (now also flags decimal mentions like "2.5" in facts, which it
  didn't before) - a superset of its old behavior, never fewer matches. `test_content_gen.py`:
  15 passed, 0 failed.

- `game-api/tools/content_gen/stages/common.py:105` (`tokenize_names`) — the "bare given name"
  replacement path assumes every stakeholder name has at least two words (a role word plus a given
  name, e.g. "Data Dave"), which matches every stakeholder in `gameConfig/GameStakeholders.json`
  today. If a future stakeholder were added with a single-word name, `given = st.name.split()[-1]`
  would equal the whole name, and both the full-name substitution and the given-name substitution
  would target the same word, which is at best redundant and at worst could double-replace in an
  unexpected order. Not exercised by current data (verified: every stakeholder name in
  `gameConfig/GameStakeholders.json` is two words), so no test can currently demonstrate a failure.
  Deferred as a latent edge case, flagged for whoever next edits the stakeholder roster.

- `game-api/tools/content_gen/gates.py` step 10 ("Selection") and `stages/templates.py`'s
  `damage_menu()` — both re-run the game's own graph evaluation (`ctx.evaluate`) once per sampled
  state (`O(phases × samples × seeds × quota)` calls to `select_in_phase`, `O(targets)` calls to
  `apply_ops`/`evaluate_graph` respectively). Fine at tier 0 scale (34 components, a handful of
  phases) and this is offline tooling, not a runtime hot path, so not fixed; worth a second look
  only if the "full" scope (D29/D36) turns out slow to validate once the rest of the content is
  authored.

- No direct unit tests exist for `cli.py`'s command functions (`cmd_status`, `cmd_review`,
  `cmd_try`, `cmd_diff`, `cmd_unstick`, etc.) — they are thin argparse-plus-print wrappers around
  `runner`/`ledger`/`assemble`/`gates`, which are otherwise well covered by
  `test_content_gen.py`. Not fixed: the wrappers have negligible independent logic (mostly
  formatting/printing), and adding tests for them would mostly test `print()` output rather than
  behavior. Logged as a known coverage gap rather than silently ignored, in case a future change to
  `cli.py` adds real logic that should be tested directly.

## Consistency with STATE.md D-decisions

Checked and found consistent (no divergence to report):
- D9 (resumable/cancellable CLI harness, sqlite ledger keyed by input hash) — matches `ledger.py`'s
  hash-keyed rows and `runner.py`'s resume-by-default `todo()`/`sync()` design.
- D36 ("content_gen freeze" pins the golden path) — matches `cmd_freeze`/`Ledger.freeze`.
- D39 (the simulation pipeline alone owns metric numbers) / standing rule ("nothing that affects
  score, buy-in, health or selection is produced at runtime by an LLM") — `TemplatesStage.to_challenge`
  hardcodes `"metric_changes": {}` for every generated challenge; content-gen authors intel and
  world events offline (validated by gates before ever reaching the game), it never computes or
  emits metric deltas, and nothing here calls the LLM at runtime. Consistent.
- D29 (tier 0 scope: 2 phases, 2 templates per phase) — matches `scopes.json`'s `tier0` scope
  (data file, out of this batch's edit scope, read only for cross-checking).
