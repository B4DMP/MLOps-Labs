# graph-redesign: what changed

104 commits since `main`, grouped by functionality rather than by commit. `[screenshot]` marks
anything that touched the player- or admin-facing UI.

## Graph & simulation core

- Two-graph model: a technical pipeline graph (~34 components, typed edges, allowed levels) plus
  a derived stage view; patterns and precondition-driven challenge selection; typed instance
  properties; fog of war (facts, Investigate cards, and objections lift it — nothing else does).
- Stage health measures problems, not maturity: the game starts green, only root-cause breaks cost
  health, and a phase's stages stay hidden until reached.
- Simulation pipeline: a committed card runs through effective-level propagation, world events,
  grudges, and metric deltas in one deterministic pass — nothing here is computed by an LLM.

## Intel taxonomy & content pipeline

- Replaced the old intel tags with Driver / Boundary / Trade-off / Fact; split each item's wording
  into a fact (holds regardless of tag) and a reading (changes with the tag); every item now says
  where it came from — on the record, an artifact, an interview, or the pitch itself. `[screenshot]`
- Facts now reach the offline intel deck: up to two per challenge, voiced by a stakeholder in the
  room (usually the owner of what the Fact describes) and dealt in the same formats as stances, so
  "about the system" is a call the player has to make. A Fact tagged as a stance files on the
  narrator's dossier page instead of revealing itself on the System page. `[screenshot]`
- Built a resumable, hash-keyed content-generation harness (offline authoring tool, never touched
  at runtime) and generated and assembled the tier-0 challenge set through it.
- Added a `tier1` content-gen scope (2 templates per phase) to give phases 1, 4 and 5 a second
  generated challenge each, since they previously had only one hand-written challenge apiece:
  The Missing Baseline / The Missing Gate (phase 1), Exposed Model Endpoint / The Silent Shadow
  (phase 4), The Blind Spot / The Silent Drift (phase 5). Assembly now sets
  `challenges_per_phase=2` for those three phases, so they run longer. CI and `make
  content-validate-tier1` gate on it the same way tier-0 is gated.

## Persistent stakeholder dossier

- The dossier survives across challenges instead of resetting; discovered intel groups into
  refinement chains (newest reading headline, older ones stacked); filterable by phase and stage
  with a search dock; a dedicated System page for environment facts; on-record intel shown apart
  from what the player themselves confirmed. `[screenshot]`
- Many follow-on passes tightened the dock, note animations, and page layout (scrollbars, spine
  wrapping, phase tags on notes, filter icons).

## Merged pitch phase

- The four pitch beats — gather intel, build the case, face the room, decide — now live on one
  screen instead of separate phases; engagement cards and the stakeholder chat moved in; cards and
  notes are dragged directly from the dossier onto the card. `[screenshot]`
- A veto now has a way out ("Let them have it": drop your own card, accept the room's position)
  instead of only spending an Escalation Point or stalling out.
- A long iterative design pass on the room, card tray, dock sheets, dialogue spacing, and stage
  bar got the screen to its current shape. `[screenshot]`

## Player graph & admin views

- Player-facing pipeline view of the MLOps graph: stages, flows, curved feedback arcs, a detail
  card per component. `[screenshot]`
- Admin debug view for support: every stage's components, edges, and instances in one table.
  `[screenshot]`
- Simulation results are reported as what the card actually did (targets, world events, patterns,
  health) rather than restated from a prompt. `[screenshot]`

## Glossary & UI polish

- Hover explanations for MLOps terms across game text. `[screenshot]`
- Assorted polish: dossier tab and radar-chip layout, per-player stakeholder casts, phase-briefing
  reopen flow, non-interactive Slack artifact reactions. `[screenshot]`

## Code review & hardening (this session)

A systematic, batched review of the diff against `main` (`docs/plans/graph-redesign/
10-code-review.md`), followed by a round of decisions and fixes:

- **tests**: shared `config_dir`/`real` fixtures and intel item factories, replacing four
  near-duplicate copies.
- **frontend**: added vitest test infra (there was none) and coverage for the previously-untested
  glossary matcher.
- **content-gen**: fixed a generator bug that leaked a raw stakeholder id as plain text into 6
  objection records, added a per-item heartbeat so a slow generation never looks abandoned, and
  regenerated the affected content.
- **graph core**: closed a predicate-validation gap that let bad config crash at runtime; split
  feedback edges from governance edges so the pipeline view never draws one as the other.
  `[screenshot]`
- **migrations**: fixed a real crash (a Fact item with no `stakeholder_id` broke a migration) and
  brought a table that predates this app's use of alembic under management; added the repo's first
  migration tests.
- **simulation**: `run_simulation` now persists and replays the exact report on a retry instead of
  recomputing; a Veto Breaker degrades only what the card's own targets touched, never the
  stakeholder's whole area.
- **pitch/intel**: added server-side stage guards the pitch state machine was missing entirely,
  fixed a fog-of-war leak on Boundary items, and consolidated four diverging "find this item's
  target" helpers into one.
- **ci**: the pipeline built and shipped images without ever running the backend suite or any
  frontend check — both now gate deploys.
- **frontend**: merged the pipeline view, the old performance dashboard, and the action-card reveal
  screen into one Performance view with live gameplay metrics; retired the two screens it replaced
  along with an already-dead reveal panel. `[screenshot]`
- **frontend**: stakeholder avatars no longer fall back to one flat color for missing data — a
  deterministic per-stakeholder color everywhere, and the six authored colors now match the schema.
  `[screenshot]`
