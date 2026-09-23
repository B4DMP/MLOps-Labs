# Remove the Governance/Infra stage from the MLOps graph — session handoff

## Context

The `gov` stage ("Governance and Infra") in `gameConfig/MlopsGraph.json` was a cross-cutting
"band" stage (always visible, no phase) with 6 components. No challenge ever targeted it —
pure eye-candy — so we're removing it entirely from the graph, the action-compose UI, and
every backend code path that special-cased it. Decision already made and approved: fully
remove the underlying `band`/`governs`-edge machinery too (not just the gov data), since gov
was the only thing using it and leaving it would be dead generic infrastructure.

The original plan lives at (this session's local plan file, not in the repo) — this doc is the
up-to-date state now that implementation is underway, since a good chunk of what actually
needed fixing wasn't visible until things broke.

**Important environment fact learned this session, not in the original plan:** despite
`docker-compose.yml`'s `additional_contexts` for gameConfig looking build-time-only, the `api`
service ALSO bind-mounts `./gameConfig`, `./gameConfigSchemas`, `./game-api/src/mlops_serious_game`,
and `./game-api/tests` live into the container. **No image rebuild is needed** for changes to
those paths — just `docker compose restart api` (or nothing at all if only tests changed; pytest
runs pick up edits immediately via the mount). Don't waste time on `docker compose build api`.

**Multi-session warning:** this repo's working tree was shared with 2-3 other concurrent Claude
Code sessions during this work (`mlops-labs-e3`, `mlops-labs-57`, `mlops-labs-bf`), which caused
real data loss earlier in the session (one session was repeatedly running
`git checkout -- gameConfig/` while debugging something unrelated, wiping in-progress edits
several times before we caught it via `ListAgents`/`SendMessage` and matching file-mtime
evidence). If you're a fresh agent picking this up, check `ListAgents` for other live sessions
and coordinate before touching shared files, especially anything under `gameConfig/` or
`game-ui/src/components/`.

## Done and verified

1. **`gameConfig/MlopsGraph.json`** — removed the `gov` stage, its 6 `gov.*` components, and the
   9 `governs`-kind edges touching them. Also dropped the now-dead `"band": false` field from the
   5 remaining stages (the field only ever mattered for `gov`). Verified: 5 stages, 28 components
   (was 34), 31 edges (was 40).
2. **`gameConfig/MlopsPatterns.json`** — removed 3 anti-patterns (`ap_cost_blindness`,
   `ap_shadow_it_access`, `ap_undocumented_handover`) and 4 design patterns
   (`dp_iac_everywhere`, `dp_least_privilege`, `dp_documented_promotion`, `dp_efficient_tuning`)
   whose triggers referenced `gov.*` components; dropped the `"gov"` key from
   `dp_versioned_lineage`'s `stage_effects` (its trigger didn't touch gov, so the rest of the
   pattern stayed).
   - **Then had to add 4 new trimmed-down design patterns back** (`dp_full_deploy_automation`,
     `dp_gateway_automation`, `dp_risk_gated_promotion`, `dp_automated_tuning`) because
     `tests/test_graph_patterns.py::test_patterns_cover_every_component_and_pipeline_edge`
     enforces that every real component/edge is referenced by at least one pattern, and the 4
     deleted design patterns had been the *only* coverage for 7 still-real targets
     (`deploy.containerization`, `deploy.orchestration`, `e.hpo_train`, `e.risk_acceptance`,
     `e.serving_gateway`, `model.hpo`, `req.risk_assessment`) alongside their gov triggers. The
     new patterns are functionally trimmed copies of the old ones minus the gov half — verified
     via `uncovered_targets(...) == []` and the pytest coverage test. **The names/stories are
     functional placeholders, not copy-polished** — worth a content pass.
3. **`gameConfig/GameMetrics.json`** — removed `gov.*` weight entries from the `automation`,
   `requirements`, `efficiency`, and `efficiency_intro` metrics.
   - **Design gap left behind:** the `efficiency`/`efficiency_intro` metrics are now very thin —
     only `model.hpo` (0.4) and `deploy.orchestration` (0.4). They used to be dominated by
     `gov.cost_monitoring`/`gov.compute_scheduling`/`gov.iac`. Someone should decide whether this
     metric needs new real-component weights or a redesign.
4. **`gameConfigSchemas/MlopsPatterns.schema.json`** and **`GameProgression.schema.json`** —
   dropped `"gov"` from the stage-id enums.
5. **`game-api/src/mlops_serious_game/domain/graph.py`** — removed `Stage.band` field; narrowed
   `EdgeKind` from `Literal["pipeline", "feedback", "governs"]` to `Literal["pipeline", "feedback"]`.
6. **`application/graph_service/stage_graph.py`** and **`graph_state_view.py`** — removed
   `StageView.band`, `StageGraphView.governance_flows`, and the `governs`-kind cross-stage-edge
   computation (simplified `_cross_stage_weakest` into a feedback-only inline block); removed the
   `stage.band` early-return from `_stage_reached`; removed `"band"`/`"governance_flows"` from the
   `graph:state` payload. **`debug.py`** — dropped `"band"` from its debug dump.
   - **Left alone on purpose:** `_stage_band()` / the `health_band` field in the payload. That's
     an unrelated, pre-existing concept — a fog-of-war min/max health range computed for *every*
     stage from player knowledge. Same word, different thing. Don't touch it.
7. **Scattered `"gov"`-keyed special-casing removed:**
   - `domain/emotion.py`: dropped `"gov"` from `SUBSYSTEM_SENSITIVITIES`.
   - `component_investigation_service/service.py`: dropped `"gov"` from `STAGE_TO_DEFAULT_OWNER`
     and the `stage_id == "gov"` owner-fallback branch.
   - `component_investigation_service/chains.py`: dropped the 4 `gov.*` fact-template entries
     (plus a stray `gov.compliance_tracking` entry that didn't correspond to any real component).
   - `pitch_debate_service/gather.py`: dropped the `gov.*` entries from
     `STAKEHOLDER_DOMAIN_COMPONENTS`'s `efficiency_emilia`/`emilia` lists (now empty — see gap
     below); `get_allowed_stages_for_phase` no longer unions in `"gov"`.
   - `websocket/handlers/gather_handler.py`: `phase_prefixes` no longer includes `"gov"` in any
     phase's allowed set; simplified the rejection error message.
   - `websocket/handlers/pitch_handler.py`: `get_allowed_targets` no longer force-includes
     `stage_id in ("gov", "infra")` components (that branch always contributed zero for `"infra"`
     anyway, since it was never a real stage id).
   - `application/intel_handler.py`: the `alt_target` fallback that defaulted to `"gov.audit"` now
     falls back to `"req.acceptance_criteria"`.
   - **Design gap left behind:** `efficiency_emilia`/`emilia` now have an *empty* domain-component
     list in `gather.py`, and there is no longer any component anywhere in the real graph with an
     explicit `owner_role` override (all 6 such overrides were on the removed `gov.*`
     components) — everything now falls back to its stage owner. This means `efficiency_emilia`
     has no component she "owns" for fallback-targeting purposes. Not exercised by any real
     challenge content today (verified), but worth a design decision if that stakeholder is meant
     to keep a concrete domain.
8. **Content fix:** `gameConfig/RequirementObjects.json` — the
   `gen_loyalty_data_deployment_block_emilia_cost_control` requirement item (challenge 115) had 3
   references to the removed `e.cost_serving` edge (`ops[0].target`, `branch_x.target`,
   `branch_y.target`). Retargeted all 3 to `deploy.orchestration` (thematically closest surviving
   target, and matches the new `efficiency` metric's remaining weights). This was **not** caught
   by the original investigation (which only checked challenge/pattern references, not
   `RequirementObjects.json`'s intel-item ops/branches) — it surfaced as a real
   `ConfigLoaderError` on container startup. **Worth grepping `RequirementObjects.json` once more
   for any other stray `gov.` or removed-edge references** as a final check.
9. **Tests fixed** (all passing now):
   - `test_graph_core.py`: component/edge counts (34→28, 40→31), stage-id set (dropped `"gov"`),
     replaced the governance-vs-feedback-flow-splitting test with a simpler feedback-only test
     (the `governs` edge kind and `governance_flows` field no longer exist), replaced the
     `gov.iam`/`e.iam_gateway` generic-story-fallback assertions with `e.alert_retrain` (a real
     edge confirmed to have no authored story fragment).
   - `test_gather.py`: swapped synthetic `"gov.cost_monitoring"` placeholder targets for real
     `"ops.alerting"`; dropped a `resolve_component_owner("gov.cost_monitoring", ...)` assertion
     (no longer resolvable — see design gap above); dropped the
     `test_is_component_allowed_for_phase` assertions about gov being allowed in every phase
     (that behavior no longer exists).
   - `test_veto_breaker.py`: the veto-worthy fixture card used `gov.audit` as "a legal target
     nobody strongly owns" — this exploited the old *always-allow-gov* rule, which is exactly what
     we removed, so the card would now be rejected outright as an illegal target. **This is a
     structural consequence, not a typo fix**: `get_allowed_targets` can no longer surface a
     cross-stage target at all (it's now strictly confined to the current phase's own stage plus
     whatever the challenge's own intel already references). Retargeted to `deploy.serving`,
     which challenge 118 (`gen_shadow_deployment_contract`) already references via its own
     authored intel, so it stays legal. Updated docstrings/comments accordingly. All 13 tests in
     this file pass with the swap (the exact capped level, 1, happened to match).
   - `test_simulation_pipeline.py`: `real.owner_of("gov.cost_monitoring") == "efficiency_emilia"`
     no longer has any real-graph equivalent (see design gap above — no component anywhere has an
     explicit owner override now). Split into two tests: kept the stage-fallback half on the real
     graph, and added a new small synthetic-graph test
     (`test_owner_resolution_prefers_the_components_own_owner`) to keep covering that
     `owner_of()` precedence logic in isolation.
   - `test_emotion_dynamics_simulation.py`: dropped `"gov"` from a locally-duplicated copy of
     `SUBSYSTEM_SENSITIVITIES` (this file doesn't import the production dict, it mirrors it).

## Session 2 update (fresh agent, coordinated with the original author over ListAgents/SendMessage)

The original author (`mlops-labs-a3`) turned out to still be mid-task, not handed off — ran out of
tokens partway through finishing point 10 itself. A fresh agent picked this doc up, coordinated
live with a3 and 3 other peer sessions sharing this tree (mlops-labs-57/e3/bf were on unrelated
work — auth rate-limiting, session-persistence/CSRF, a dossier hover-UI feature) to avoid
clobbering, stood down while a3 kept editing, then a3's session ended (ran out of tokens). This
agent verified what a3 had actually finished vs. not, finished the remainder, and did the
verification passes.

**Point 10 (frontend) — now fully done**, split across who did what:
- Done by a3 before running out of tokens: `ComposeActionProposalModal.tsx` /
  `.module.css` (removed the `sId === "gov" || "infra"` special case and `isGov` tab styling, incl.
  the stale `"...in your current phase and in Governance and Infra."` reason string this agent
  flagged), `EngagementCardTargetModal.tsx` (removed the 6 `gov.*` `MLOPS_COMPONENTS` entries, the
  `"Governance"` group/type-union member, and the `comp.group === "Governance"` filter half),
  `StakeholderDossier.tsx` (removed the `gov` stage label/color entry only — the rest of that
  file's uncommitted diff is unrelated hover-UI work from another session, left untouched as
  instructed), `PerformanceDashboard.tsx` (removed `band`, `governance_flows`, the `"governance"`
  variant of `StageConnector`/flow helpers, the cross-cutting layout branch, and the legend
  section — `health_band` correctly left alone), `Results/tabs/PipelineTab.tsx` (removed the
  `band`/`cross` split, renders one list now).
- Finished by this agent: `game-ui/src/components/GraphDebug.tsx` (dropped `StageDebug.band` and
  the `"band"` table column — note there is no separate `dev/GraphDebug.tsx`, it's this one file
  directly under `components/`) and `game-ui/src/components/dev/resultsFixtures.json` (removed the
  3 `"id": "gov"` fixture stage entries and every now-orphaned `"band": false` field from the
  remaining stage entries, so fixtures match the real payload shape; verified still valid JSON).
- `utils/stageCanvas.test.ts` needed no change — its one `"band"` hit is prose in an unrelated test
  name ("holds every real stage within a narrow band of the reference node size"), not the gov
  concept.

**Point 11 (final sanity sweep) — done, and it found one real remaining bug**: despite the
session-1 note saying `get_allowed_stages_for_phase` "no longer unions in `gov`",
`pitch_debate_service/gather.py:202-211` still literally `return {stage_id, "gov"}` (the docstring
even still said "current phase's stage + 'gov'"). Fixed: now returns just `{stage_id}`, docstring
updated. No test had pinned the old behavior, so nothing else needed updating. Everything else the
repo-wide case-insensitive grep for `gov`/`governance` (excluding
`game-api/tools/content_gen/work/out/*`, confirmed-dead) turned up was prose/unrelated, as
predicted: the `"governed"` maturity level name, GRC/data-governance-officer persona flavor text
under `game-api/data/stakeholder_extraction_data/`, a domain-glossary line about "governance
stakeholders", and `game-api/tools/scripts/add_layout_coords.py` — a one-off, already-run migration
script with stale `gov.*` entries in its coordinate table; it's not loaded by the running game and
extra unused dict entries are harmless, so left as-is.

**Point 12 (frontend tests) — done**: `docker compose exec ui npm test` → all 13 files, 190 tests
pass, including `stageCanvas.test.ts` and `Results.test.tsx` (which exercises `PipelineTab.tsx`).

**Point 13 (backend suite re-run) — done, confirms both open questions from session 1**:
- `test_pitch_debate_cme.py` flakiness confirmed unrelated to gov removal: ran
  `test_gather.py` + `test_pitch_debate_cme.py` together, saw the *same two* tests fail
  (`test_pitch_debate_initial_turn_and_option_selection`,
  `test_pitch_debate_action_card_kickoff_and_refutation`) with the OPIK "max spans reached (402)"
  quota error plus the same unawaited-coroutine warning — reproducible, external-service flakiness.
- Full suite (`docker compose exec api python -m pytest tests/ -q`): **567 passed, 9 failed** (was
  568/8 in session 1). The auth-table failures from session 1 (`test_admin_service.py`,
  `test_auth_routes.py`, `test_profile_management.py`) are gone — that session's work must have
  progressed. But 9 *new* failures appeared, all in dossier/intel-handler tests
  (`test_dossier_chains.py` ×2, `test_intel_categorization.py`, `test_offline_intel_deck.py`,
  `test_pitch_debate_cme.py` ×2, `test_stakeholder_dossier_debug.py` ×2,
  `test_stakeholder_dossier_intel_total.py`), all with the same
  `ValueError: No valid player session on this websocket connection` from
  `intel_handler.py:48`. Confirmed this is **not gov-removal fallout**: `git status` shows
  `intel_handler.py`, `auth_service.py`, and every `websocket/handlers/*.py` file still uncommitted
  and actively being reworked by the concurrent session-persistence/cookie-auth/CSRF session
  (per its own description of its in-progress scope). Re-run the full suite once that session's
  auth/websocket work lands to get a clean baseline attributable only to the gov removal.

**Point 14 (final diff review) — done**: `git diff --stat` over every gov-removal file confirms
scope matches this doc (gameConfig, gameConfigSchemas, the graph/pattern/component-investigation
backend modules, the 7 frontend files above). The wider repo diff also contains substantial
unrelated changes (auth rework, session-persistence, a dossier hover-UI feature) from the other
concurrent sessions — not part of this task, not touched by this agent. **Nothing has been
committed.** Commit only if/when the user asks, and probably only the gov-removal-specific files
(the rest belongs to the other sessions' own commits).

## Verification commands used this session

```
docker compose exec api python -m pytest tests/ -q          # full backend suite
docker compose exec api python -m pytest tests/test_veto_breaker.py -q   # one file
docker compose exec ui npm test                              # not yet run — do this
```

No image rebuild needed for gameConfig/backend changes (see bind-mount note above). If the `api`
container's already-running process needs to pick up a change to code that runs once at import
time (like `GameConfigLoader.initialize()`), `docker compose restart api` is enough — no build.
