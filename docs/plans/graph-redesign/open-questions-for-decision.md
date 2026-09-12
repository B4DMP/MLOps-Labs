# Open questions for decision

Analysis and proposals given verbally during the post-review follow-up session (2026-09-12) but
never written down — consolidated here so they're not lost. Written up as pending decisions;
**all five below were then decided and implemented the same session** — each section now carries
its resolution note. Kept as a record of the reasoning, not because anything is still pending.

## 1. `run_simulation` replay semantics

**Issue**: `application/graph_service/pipeline.py`'s `run_simulation()` has an idempotency guard
that skips **persisting** a repeat call for the same `challenge`/`challenge_loop_index`
(`store.has_batch(...)` check before `store.append_ops`), but it still **recomputes** `simulate()`
from the freshly-loaded `before` state every time. If a caller invokes `run_simulation` twice for
the same challenge (e.g. a retried websocket `simulation:run` after the first one already
persisted), the second call's `before` state already includes the first call's persisted ops, so
`simulate()` re-applies the card/world-events/grudges on top of an already-updated graph and
returns a `SimulationResult`/`DeltaReport` that doesn't reflect what's actually in the database.
Nothing corrupts the DB (the second append is correctly skipped), but the report shown to the
player on a replay could be wrong. No test exercises `run_simulation` at all — only the pure
`simulate()` is tested.

**Proposal — three options, ranked**:

- **A (recommended): persist the report alongside the op-log batch.** `run_simulation` already
  writes the op-log keyed by `source_id` in one atomic step. Extend that same write to also store
  the `DeltaReport` (or its serializable fields) keyed by the same `source_id`. On a repeat call,
  `has_batch()` returning true short-circuits to "load and return the stored report" instead of
  "recompute but skip persisting." Standard idempotency-key pattern (same as retried
  payment/webhook APIs: compute once, return the same response verbatim forever after). Needs: a
  small new store method + a JSON column next to the existing op-log row, no new table.
- **B: handler-level de-duplication.** The websocket handler tracks in-flight/completed
  `simulation:run` requests per `(username, challenge, loop_index)` and refuses a duplicate while
  the graph is unsettled. Simpler, but pushes the correctness burden onto every caller instead of
  the pipeline itself, which is where D39 says this responsibility belongs.
- **C: reject early instead of computing-then-discarding.** Same idea as A but check `has_batch`
  *before* running `simulate()` at all, short-circuiting to a stub "already applied" response with
  no report. Cheapest, but a caller replaying to get the report back (e.g. after a network hiccup)
  gets nothing useful.

Recommend **A** — fixes the actual bug (wrong-looking report on replay), not just the symptom.

**Decided and implemented (2026-09-12): option A**, with the explicit instruction to persist the
report's *values*, not any layout/HTML. `graph_op_log` gained a `report` JSON column (migration
`c9d0e1f2a3b4`) holding `DeltaReport.model_dump(mode="json")`. `run_simulation` now checks
`store.has_batch()` *before* touching `simulate()` at all: if the batch already exists, it loads
and returns the stored report plus the current live state verbatim, never recomputing. Verified
with a test that mutates the graph between two calls to the same `source_id` and asserts the
second call's report is byte-identical to the first (confirmed it fails without the fix, passes
with it). Full suite: 211 passed.

## 2. `veto_degradation_ops` — component-only vs. component+edge degradation

**Issue**: `pipeline.py`'s `veto_degradation_ops()` docstring says "everything they own drops to
the next allowed level down," and `graph.owner_of()` is edge-aware (falls back to the "to"
component's owner for an edge), but the implementation only iterates `graph.components`, never
edges.

**The actual ambiguity**: should a Veto Breaker punish the overridden stakeholder's owned **edges**
directly, or only **indirectly** (via effective-level capping once a fed-in component drops)?
Direct edge degradation would be a harsher, more visible penalty (edges plural show as broken too,
not just the one component). Indirect-only is gentler and arguably redundant with what capping
already does downstream. D38/D41 don't settle which is intended — "degrading what they own"
doesn't disambiguate components vs. edges. This is a tuning/severity call, not a correctness bug.

**Decision needed**: pick one of the two behaviors (or a hybrid — e.g. edges degrade only if the
stakeholder owns them AND no fed-in component degradation already caps them).

**Decided and implemented (2026-09-12): scoped hybrid.** A Veto Breaker degrades both components
*and* edges the overridden stakeholder owns ("hybrid" — `owner_of`/`allowed_levels` are already
edge-aware, so this fell out naturally), but only among the targets *this specific card's
simulation actually touched* (`card_targets`), never their whole area and never anything
upstream/downstream the card didn't touch. `veto_degradation_ops` now takes `card_targets` as a
parameter instead of scanning every owned component. The existing test asserting the old
whole-area behavior was rewritten to prove the new scoping: a target the stakeholder owns but the
card didn't touch survives untouched; one the card did touch and they own gets degraded. Full
suite: 211 passed.

## 8. `TechnicalGraph.instance_errors()` doesn't validate `links`

**Issue**: config-load validation (`GraphFactory.validate_graph`) checks that every *authored*
starting instance's `links` field points to a real instance id, once, at startup.
`TechnicalGraph.instance_errors()` — the check used when a runtime `instance_upsert` op creates a
**new** instance during play (from a world event or antipattern consequence) — doesn't re-run that
same `links` check.

**Implication**: today, nothing bad happens — zero content anywhere creates a runtime instance
(confirmed by grep across `gameConfig/*.json`), and D12 says action cards never do either. The gap
is future, not present: the moment any world-event or antipattern `consequence_ops` starts using
`instance_upsert`, that whole content category is missing its safety net. A content author could
ship a dangling `links` reference and the game would accept it silently, only breaking later when
something reads that link (instance-property propagation, pattern matching). It's a live gap in a
currently-dormant code path, not a bug affecting anyone today.

**Decision needed**: fix now (add the same `links`-resolves check to `instance_errors`, handling
same-batch forward references — an instance upserted earlier in the same batch that a later
instance in the batch links to must not be rejected) vs. defer until the first content that
actually exercises `instance_upsert` with `links` lands, at which point it becomes a
correctness-blocking prerequisite rather than a latent gap.

**Decided (2026-09-12): defer, document concisely.** Not fixed — still dormant, no content
exercises it. Documented in two places so it isn't silently forgotten: a short comment directly
on `instance_errors` in `domain/graph.py` pointing here, and `STATE.md`'s Open Questions table
(Q22), tagged "needed by: first content using `instance_upsert`."

## 12. `stage_graph.py`'s `feedback_flows` bundles `governs` edges

**Issue**: `feedback_flows` lumps together every cross-stage non-pipeline edge — both
`kind: "feedback"` **and** `kind: "governs"` edges (9 `governs` edges exist in
`gameConfig/MlopsGraph.json`) — under one field name. The frontend (`PipelineView.tsx`, batch D)
renders `feedbackFlows` as "curved feedback arcs" per Q21 in `STATE.md`.

**What the plan actually says**: checked `docs/plans/graph-redesign/08-graph-viz.md` and
`STATE.md`'s Q21. The plan explicitly scopes feedback arcs as **"feedback from Monitoring and Ops
back to Modeling and Deployment"** — a specific backward-loop story. Nothing in the plan mentions
governance edges being part of this visual at all. Bundling `governs` edges into `feedback_flows`
isn't a documented decision — it reads as scope drift in the implementation, not an intentional
design choice.

**Decision needed**: split into two fields (`feedback_flows` / `governance_flows`) so the frontend
can draw them distinctly, or confirm governance edges genuinely should render as feedback-style
arcs too (plausible — governance also crosses stages — but then the name should say so, or the
docs should be updated to reflect the broader scope).

**Decided and implemented (2026-09-12): split, with more visualization, not less.**
`StageGraphView` now carries `feedback_flows` and `governance_flows` separately
(`stage_graph.py`), both threaded through `graph_state_view.py`'s websocket payload. The frontend
(`PerformanceView.tsx`) draws them as visually distinct overlays on the pipeline strip: feedback
arcs keep their existing health-colored, solid-triangle style; governance arcs are a fixed amber,
dash-dot line with a diamond marker in their own row, since oversight isn't "healthy/degraded" the
way a flow is. A small legend explains both when either is present. New backend test
(`test_feedback_and_governance_flows_are_kept_apart`) proves an edge lands in exactly one list
based on its `kind`. Full suite: 211 passed; frontend `tsc -b --force`: 0 errors.

## 15. `intel_data` table is not alembic-managed at all

(Discovered while building the migration test harness — full writeup in
`review-findings/migrations-test-harness.md`; summarized here for visibility alongside the other
open questions.)

**Issue**: no migration anywhere has an `op.create_table('intel_data', ...)`. The table exists only
because `infrastructure/database/connection.py`'s `Base.metadata.create_all(bind=engine)` creates
whatever's in `Base.metadata` but missing from the database — a documented fallback
(`migrations.py`'s own docstring describes the "populated but never stamped" startup case) that
happens to be the *only* thing that has ever created this specific table.

**Consequences**:
- A full `alembic downgrade base` cannot drop it (alembic has no record of creating it) — the new
  migration test explicitly excludes it from its "no tables left behind" assertion rather than
  treating this as a failure.
- Any future **column** change to the `intel_data`-backed model has no migration path at all —
  `create_all()` only adds missing tables, it never alters existing ones. A column add/rename/drop
  on this table today would need to be hand-written as a raw migration with no
  `create_table`/`drop_table` pair to follow as a model.

**Decision needed**: retroactively author the missing `create_table` (and decide how existing
installs — where the table already exists via `create_all` — should reconcile with a new
migration claiming to create it, without data loss), or explicitly document `intel_data` as a
permanently-`create_all`-managed exception and make sure nobody tries to write a normal
column-altering migration against it without accounting for that.

**Decided and implemented (2026-09-12): bring it under alembic management, unconditionally.**
Confirmed via `git log` that `IntelItem` predates this project's move to alembic entirely (added
in `de582b5`, well before `489a47f` introduced alembic/postgres) — it isn't a graph-redesign gap,
just one that had gone unnoticed until this review. New migration `b8c9d0e1f2a3` uses
`CREATE TABLE IF NOT EXISTS` (the same guarded-DDL idiom already used elsewhere in this chain), so
it's a real create on a genuinely fresh database and a safe no-op anywhere `create_all` already
made the table — verified both ways: the migration test's throwaway database (fresh) and this
session's own local dev database (already had it via `create_all`; `alembic upgrade head` ran
clean, `\d intel_data` confirms the right columns and index). Full downgrade-to-base now leaves
zero tables behind, closing the gap the migration test originally found.
