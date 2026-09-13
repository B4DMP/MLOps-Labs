# Batch C review findings: Pitch debate & intel services

Scope: `pitch_debate_service/{session,scoring,objections,store}.py`, `intel_handler.py`,
`infrastructure/websocket/handlers/pitch_handler.py`. Reviewed against `10-code-review.md`
criteria and `STATE.md` D1-D46. Verified after every fix with
`docker compose exec api python -m pytest tests/test_pitch_session.py tests/test_pitch_scoring.py
tests/test_simulation_pipeline.py -q` then the full `tests -q` suite: 194 passed, 0 failed
throughout (baseline was 193 passed; the extra pass is from batch A's prior fixes, already on
this tree before I started).

## Fixed

- `infrastructure/websocket/handlers/pitch_handler.py:237` (`handle_pitch_object`) — no stage
  guard: could be called again after a pitch already reached COMMIT/DONE, resetting `stage` back
  to `OBJECT` on a card whose ops may already have been written to the graph. A follow-up
  `pitch:commit` would then pass the (now re-added) `state.stage == "OBJECT"` check and call
  `_apply_card` a second time for the same card, double-applying its ops/debt — violating the
  module's own "graph is written exactly once per pitch" invariant. Fixed: reject with an error
  unless `state.stage == "PREPARE"`.
- `infrastructure/websocket/handlers/pitch_handler.py:288` (`handle_pitch_commit`) — no stage
  guard: could be invoked straight from `PREPARE` (skipping the OBJECT round entirely) or a
  second time after the pitch was already `DONE`. Fixed: reject unless `state.stage == "OBJECT"`.
- `infrastructure/websocket/handlers/pitch_handler.py:313` (`handle_pitch_rebuild`) — no stage
  guard: callable from any stage, not just after a stood veto (D7). Fixed: reject unless
  `state.stage == "COMMIT"`.
- `infrastructure/websocket/handlers/pitch_handler.py:327` (`handle_pitch_veto_breaker`) — no
  stage guard: a client could call this from `PREPARE`/`OBJECT` and force `stage="DONE"`,
  `outcome="PASS"` for one Escalation Point with no actual veto standing (the frontend only
  renders the button when `outcome === "VETO"`, but nothing on the backend enforced it — D1/D7
  say the debate is terminal except through these specific veto responses). Fixed: reject unless
  `state.stage == "COMMIT"`.
- `infrastructure/websocket/handlers/pitch_handler.py:327` (`handle_pitch_concede`) — same gap for
  "Let them have it" (D41: "Available whenever a veto stands"), nothing checked that one actually
  stood. Fixed: reject unless `state.stage == "COMMIT"`.
- `pitch_debate_service/session.py` (`answering_item_ids`) — for a `correction`-kind objection,
  returned `{objection.item_id}` (the item already on the card, which is exactly why the
  objection fired). That made `dialogue_options_for`'s `no_answer` check false, so the builder
  offered "Amend" as available for a mis-tagged item. Since `answer_objection`'s only guard on
  "amend" is `item_id in card` (already true for that item), a player picking *any other* held
  item via the Amend picker would clear the correction — bypassing "Concede Correction" (D23),
  the only rule meant to make a mis-filed tag cost something. Fixed: return an empty set for
  `correction`, so "amend" is correctly reported unavailable and only "concede_correction" clears
  it.
- `pitch_debate_service/session.py` (`boundary_checks`) — the fog-of-war "is this target unknown"
  check used `_item_target_and_level(item)`, which reads `suggested`/`ops` only. A Boundary
  authored with only a `holds` predicate (no `suggested`/`ops` duplicating its `component`) would
  resolve to `target=None`, skip the unknown-target branch, and reveal the true violated/not
  state on a component the player has never observed — a real fog leak against D11. Currently
  masked in the live config (all 10 Boundary items with `holds` set in
  `gameConfig/RequirementObjects.json` happen to also carry a matching `suggested`/`ops`), but
  nothing enforces that pairing, so a future authored or generated Boundary item without it would
  silently leak. Fixed with a small `_boundary_target()` helper that falls back to
  `holds["component"]` when `suggested`/`ops` give nothing; used only inside `boundary_checks`, so
  `predictions_for`'s existing behaviour for Driver-style items is unchanged. No existing test
  exercised the fallback path so nothing needed updating, and `test_boundary_on_an_unknown_target_
  is_reported_as_uncheckable` (which sets both `holds` and a matching `suggested`) still passes
  unchanged.

## Deferred

- `pitch_debate_service/session.py` and `scoring.py` — the tuning constants (`EMOTION_STONEWALL`,
  `EMOTION_REFRAME`, `EMOTION_ADDENDUM`, `EMOTION_CONCEDE`, `EMOTION_VETO_BREAKER`,
  `EMOTION_CONCEDE_WIN/LOSE`, `SECONDARY_MALUS`, `VETO_THRESHOLD`, `OBJECTION_THRESHOLD`,
  `LOSS_W`) are Python module constants, not config. D38 is explicit that "emotion effect per
  dialogue option, Veto Breaker degradation, grudge lifetime" must live in config, not code, once
  decided.
  **Resolved post-review (2026-09-12), user explicitly requested it despite the numbers still
  being pre-playtest**: added `pitch_tuning` to `gameConfig/EmotionValueConfig.json` (+
  `gameConfigSchemas/EmotionValueConfig.schema.json`) holding all twelve values plus
  `grudge_lifetime`, a `PitchTuning` pydantic model in `domain/emotion.py`, and
  `EmotionFactory.get_pitch_tuning()`. `scoring.py` was deliberately left untouched (it states "no
  factory calls here" and is meant to be pure/testable without config) — its own module constants
  stay as pure-function fallback defaults. `session.py` (itself documented "Pure over its inputs",
  but with no stated no-factory-imports rule, and precedented by `pipeline.py` already importing
  `PatternFactory`) now reads `_TUNING = EmotionFactory.get_pitch_tuning()` once at module level,
  keeps the same `EMOTION_*` names sourced from it (so existing usages and the tests that import
  `session.EMOTION_VETO_BREAKER` etc. directly are unchanged), and explicitly passes
  `secondary_malus`/`loss_w`/`veto_threshold`/`objection_threshold` into the `fit`/`buy_in`/
  `outcome` calls instead of relying on `scoring.py`'s own hardcoded defaults. Full suite: 202
  passed, 0 failed after the change (was 194 before it). Original deferral reasoning kept below
  for context — the "provisional pending playtest" concern still applies to the *values*
  themselves (still the same numbers, unchanged), just not to where they live anymore:
  this is already tracked as open work in `STATE.md` itself (plan 06's
  own status row: "Open: playtest (12), numbers into config (14)"), it needs a config
  schema/loader addition that reaches beyond this batch's files (and likely
  `gameConfigSchemas/*`, batch H's territory), and the numbers are explicitly provisional pending
  playtest — moving them to config now would just relocate constants that are still expected to
  change. Recommend picking this up as plan 06 step 14 once playtest numbers are settled, not as
  a review-pass fix.
- Redundant "find this item's graph target" logic exists in at least four places with slightly
  different field coverage: `session._item_target_and_level` (suggested → ops), `objections.
  _target_id_for` (suggested → asserts → concedes), `intel_handler.item_target` (asserts →
  suggested → ops), and `domain/requirement_factory._payload_target` (asserts → suggested →
  concedes → ops; that last one is outside this batch's scope, in `domain/`). None of the four
  agree on priority order or field coverage, and (as the fixed finding above shows) none of them
  read `holds.component` either — I only patched a local fallback for the one call site that had
  a real fog consequence. Consolidating these into one shared helper in `domain/requirement.py`
  (already imported by every module that has its own copy) would remove the duplication review
  criterion #2 asks about, but touches files outside this batch (`objections.py` is in-scope,
  `intel_handler.py` is in-scope, but `requirement_factory.py` is domain/batch-E territory) and
  is a refactor, not a surgical fix — deferring to a follow-up rather than doing a cross-batch
  rename under this review's budget.
- No handler-level tests exist for `infrastructure/websocket/handlers/pitch_handler.py` at all
  (criterion #5) — every existing test exercises `pitch_debate_service.session`/`scoring`/
  `objections` directly, never the websocket handlers, so none of the five stage guards added
  above have direct test coverage; they're only indirectly exercised via the full-suite green
  run (nothing currently calls these handlers out of order). Adding handler-level tests needs
  DB/websocket fixtures this test file doesn't have today. Flagging for batch G (cross-batch test
  pass) rather than building fixture infrastructure inside this review pass.
- `pitch_debate_service/store.py` `_emotion_row()` walks every `GameChallenge` row for a user
  (`.all()`, then a Python-side scan) to find the newest one with non-empty `emotion_values`,
  rather than a single query with the emptiness check pushed into SQL. Bounded by one player's
  total challenge-row count (tens, not thousands, for this game), so not flagged as a real
  efficiency bug — noting only because criterion #3 asks about redundant round-trips.
- `intel_handler.retrieve_dossier_data` fetches `_archived_items(username, curr_challenge.
  phase_id)` (all items up to and including the current phase) and separately
  `retrieve_intel_items(curr_challenge, ws)` (items scoped to this specific challenge); the two
  sets overlap on this challenge's own items and are merged by id, so there's no correctness bug,
  just a redundant read of this challenge's rows once as part of the broader archive scan and
  again on their own. Negligible at tier-0 content volumes; not fixed to keep this pass surgical.
- `handle_pitch_answer` has no stage guard (unlike the five fixed above): after a commit, `state.
  objections` still holds whatever was open at commit time, and nothing stops a stray
  `pitch:answer` call from mutating `state.emotion_deltas` post-commit. Traced through: nothing
  downstream re-applies those deltas (the DB write already happened at commit/veto_breaker/
  concede), the frontend never renders the OBJECT panel once `stage` is COMMIT/DONE, and the next
  challenge starts a fresh `PitchState`, so this has no observable effect on score, buy-in,
  health or persisted state. Left alone rather than adding a sixth guard for a transition that
  cannot actually do anything once it fires.

## Proposed deletions

None from this batch's own files. (Not evaluated: the older LangGraph-based
`pitch_debate_service/{service,graph,nodes,edges,chains,tools,prompts,state}.py` modules, which
`intel_handler.py` still imports from for artifact-content generation and which
`game_handler.py`/`chat_handler.py` still call into for the stakeholder chat — those files are
outside this batch's scope and still have live callers, so nothing here reads as dead code to
propose for deletion.)
