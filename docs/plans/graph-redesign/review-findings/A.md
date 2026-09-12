# Batch A findings — Graph core & domain

Reviewed against `docs/plans/graph-redesign/10-code-review.md` criteria (correctness, redundancy,
efficiency, consistency with D1-D46, test coverage) and `STATE.md`'s decision log.

Verification after every fix: `docker compose exec api python -m pytest
tests/test_graph_core.py tests/test_graph_patterns.py tests/test_graph_refactor.py
tests/test_simulation_pipeline.py -q` — 80 passed throughout. Also re-ran the full suite
(`tests -q`) at the end: **193 passed**, baseline held. Also manually reloaded the real
`gameConfig/MlopsGraph.json` + `MlopsPatterns.json` (not exercised by unit tests, which use
inline fixtures) against the tightened validator to confirm no production content regresses.

## Fixed

- `game-api/src/mlops_serious_game/domain/graph_predicates.py:167-182` (`validate_predicate`) —
  the static validator never checked that an `"attr"` clause's `op` or an edge+`"trigger"`
  clause's `op` (the `"trigger"` key's value itself, e.g. `"eq"`/`"ne"`) was restricted to
  equality, even though `evaluate()` raises `PredicateError` at runtime for anything else
  (`attr clauses only support eq / ne`, `trigger clauses only support eq / ne`). A pattern,
  challenge precondition or Boundary predicate authored with e.g. `{"attr": ..., "op": "gte"}`
  would pass config-load validation (the gate content is supposed to be checked against) and
  only blow up later when actually evaluated during play. Fixed by adding the same `_EQUALITY`
  check to `validate_predicate` for both clause kinds. — **fixed**. No existing test exercised
  this gap (`tests/test_graph_core.py::test_unknown_clause_raises_and_validation_reports_bad_references`
  checks other malformed clauses but not a bad op on `attr`/`trigger`); flagging for batch G to
  add a case, since `tests/` is out of this batch's file list.

- `game-api/src/mlops_serious_game/application/graph_service/debug.py` (`build_graph_debug`,
  "orphans" section) — reimplemented its own predicate-tree walker
  (`_collect_predicate_targets`) to compute `targets_in_no_pattern`, duplicating
  `domain/pattern.py`'s `predicate_targets` (review criterion 2: redundant logic that belongs
  in one pure module) but with a subtle divergence: the debug walker didn't count `"attr"`
  clauses at all, so a component covered only through an attribute predicate (e.g.
  `{"attr": "a.mid.hosting", ...}`) was incorrectly reported to the admin debug view as
  "in no pattern" — a false positive in a tool whose whole job is to show designers what's
  really covered. Fixed by deleting the local walker and importing/using
  `domain.pattern.predicate_targets` instead, which already handles `attr`. — **fixed**.

- `game-api/src/mlops_serious_game/application/graph_service/graph_state_view.py` — the
  "is this stage reached yet" expression (`s.band or (current_phase_id is not None and
  (s.phase_id is None or s.phase_id <= current_phase_id))`, encoding D33) was written out
  twice verbatim, once for the `stages` list and once for the `technical` dict, in
  `build_graph_state`. Extracted into `_stage_reached(stage, current_phase_id)` and reused
  both places. — **fixed** (pure refactor, no behavior change).

## Deferred (logged, not fixed)

- `game-api/src/mlops_serious_game/application/graph_service/pipeline.py:533-578`
  (`run_simulation`) — idempotency guard re-runs `simulate()` from the freshly-loaded
  `before` state every call, and only skips **persisting** the result
  (`store.append_ops`) when `store.has_batch(username, source_id)` is already true. If a
  caller invokes `run_simulation` twice for the same `challenge`/`challenge_loop_index`
  (e.g. a retried websocket `simulation:run` message after the first one already
  persisted), the second call's `before` state already includes the first call's
  persisted ops, so `simulate()` re-applies the card/world-events/grudges on top of an
  already-updated graph and returns a `SimulationResult`/`DeltaReport` that does not
  reflect what's actually in the database (though nothing corrupts the DB itself, since
  the second append is correctly skipped). No test exercises `run_simulation` at all
  (`test_simulation_pipeline.py` only tests the pure `simulate()`); whether this is
  reachable depends on how batch C's websocket handler calls it (does it de-duplicate
  before calling, or rely on this guard?). Fixing properly means persisting/reconstructing
  the original report for a repeat call, which is a real design decision (what to do on
  replay: recompute from a pinned snapshot vs. store the report), not a surgical fix, and
  touches how batch C's pitch/simulation handlers call this function — flagging for
  cross-batch (A/C) design decision rather than guessing at one now.

- `game-api/src/mlops_serious_game/application/graph_service/pipeline.py:163-186`
  (`veto_degradation_ops`) — docstring says "Everything they own drops to the next
  allowed level down" but the implementation only iterates `graph.components`, never
  edges, even though `graph.owner_of()` is defined for edges too (falls back to the "to"
  component's owner). Whether a Veto Breaker should also degrade edges the overridden
  stakeholder owns isn't settled by D38/D41 in `STATE.md` — those only say "degrading what
  they own" without disambiguating components vs. edges. Could be intentional (edges
  mostly get pulled down anyway via effective-level capping once their feeding component
  drops). Needs a design call, not a silent behavior change to game balance — logged for
  the user rather than fixed.

- `game-api/src/mlops_serious_game/domain/graph.py:55-66` and `:122-133` —
  `AttributeDef` and `InstanceProperty` are structurally identical Pydantic models (same
  fields, same `_initial_in_values` validator body) representing two conceptually distinct
  things (component story attributes vs. instance kind properties, per D21/D31). Genuine
  but low-value redundancy; unifying them would blur a real domain distinction the rest of
  the code leans on (attrs are "never read by health", instance properties are "read by
  patterns and challenge preconditions") for no functional gain. Deferred as a style-only
  finding, not fixed.

- `game-api/src/mlops_serious_game/application/graph_service/apply.py`
  (`GraphState.instance_errors` via `TechnicalGraph.instance_errors`, used from
  `_apply_one`'s `"instance_upsert"` branch) — `graph_factory.py`'s `validate_graph`
  separately checks that every `initial_instances[*].links` entry resolves to a known
  instance id at config-load time, but the same `Instance` model created at runtime via an
  `instance_upsert` op (world event / consequence op) is only checked with
  `graph.instance_errors(inst)`, which does not check `links` at all — so a runtime
  instance with a dangling link would be silently accepted. Currently dormant: no
  `gameConfig/*.json` content authors a runtime `instance_upsert` (`grep` found none, and
  D12 says action cards never create instances), so this can't fire today. Not fixed:
  doing so correctly requires deciding how to validate links against the *evolving* state
  (a batch that upserts instance B linking to instance A upserted earlier in the very same
  batch must not be rejected), which needs the caller's context, not just `graph`. Logged
  for whoever authors the first runtime `instance_upsert` content.

- `game-api/src/mlops_serious_game/application/graph_service/stage_graph.py:114-125`
  (`feedback_flows`) — the field lumps together every cross-stage non-pipeline edge,
  i.e. both `kind: "feedback"` **and** `kind: "governs"` edges (9 `governs` edges exist in
  `gameConfig/MlopsGraph.json`), under the name `feedback_flows`. The frontend
  (`PipelineView.tsx`, batch D) renders `feedbackFlows` as "curved feedback arcs" per Q21 in
  `STATE.md`, which reads as being about feedback edges specifically. Whether governance
  edges being drawn as feedback arcs is intended (governance also crosses stages and
  plausibly wants an arc) or a naming/scope drift is a call for whoever owns the visual
  design, and changing it means coordinating a field/behavior change with batch D — logged,
  not touched.

- Batch scope note (not a bug): the batch file list given for this review includes
  `game-api/src/mlops_serious_game/application/graph_service/predicates.py`, which does
  not exist. Per `STATE.md`'s revision log ("`domain/graph_predicates.py` (moved from
  application so config load can validate)"), this logic already lives at
  `game-api/src/mlops_serious_game/domain/graph_predicates.py`, which *is* in scope and was
  reviewed above. No action needed beyond noting the stale path in the batch list.

## Reviewed, no issue found

`domain/graph.py`, `domain/graph_factory.py`, `domain/pattern.py`,
`application/graph_service/apply.py` (replay/apply/degradation/debt logic),
`application/graph_service/effective.py` (propagation and capping), `store.py`
(op log persistence, idempotent seeding/enter), `pipeline.py`'s pure `simulate()` (step
ordering, grudge firing, metric deltas), `view.py` (`evaluate_graph`/`active_patterns`),
and `tools/graph_refactor.py` (rename/retire/refs/usage/check subcommands) were read in
full against the criteria above; no further correctness, redundancy, or efficiency issues
were found. Component/edge counts in this domain (~34 components, 40 edges, a handful of
stages) make the O(stages × targets) and O(V+E) computations here non-issues regardless.
