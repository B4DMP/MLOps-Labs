# Batch E findings — Domain models not covered by batch A

Scope actually reviewed (per `git diff --stat main...graph-redesign -- game-api/src/mlops_serious_game/domain/`,
minus batch A's `graph.py`/`graph_factory.py`/`graph_predicates.py`/`pattern.py`): `requirement.py`,
`grudge.py`, `requirement_factory.py`, `Challenge.py`, `Phase.py`, `phase_factory.py`, `metric.py`,
`metric_factory.py`, `offline_intel_artifact.py`, `offline_intel_artifact_factory.py`, `persona.py`,
`persona_resolver.py`, `stakeholder.py`, `stakeholder_factory.py`, `prompts.py`, `gameConfigLoader.py`,
`glossary.py`, `glossary_factory.py`, `story_factory.py`.

Note on starting state: `requirement_factory.py`, `story_factory.py` (both in this batch's remit) and
`graph_predicates.py` (batch A's file, left untouched) already carried uncommitted working-tree changes
when this pass started — the D42 chain-validation gate below was already implemented, and
`story_factory.py` already had `_parse_key` reordered above `StoryConfigError`. Read as prior work on
this same batch; verified rather than redone.

## Findings

- `game-api/src/mlops_serious_game/domain/requirement_factory.py:79-139` — D42 ("chain link validation
  gate": enforce in `payload_errors` that a `refines_id` item matches its parent's target and
  stakeholder, sits in a strictly later phase, and only narrows tag: same tag, or Driver into Boundary)
  was not enforced anywhere before this pass. **Fixed** (present on disk when review started, verified
  correct): added `_payload_target()` helper plus a `refines_id` block in `payload_errors()` that checks
  parent existence, stakeholder match, target match (via `_payload_target`), strictly-later-phase (via
  a `challenge_id -> phase_id` map built from `PhaseFactory.phases`), and the Driver-to-Boundary-or-same
  tag transition. Self-reference (`refines_id == id`) is caught by the phase check since parent and
  child resolve to the same challenge/phase. Full suite still 193 passed after verifying.

- `game-api/src/mlops_serious_game/domain/story_factory.py:13-16` — dead-code smell: `_parse_key` sat
  after `StoryConfigError` in a way that read oddly next to its only call site. **Fixed** (present on
  disk when review started, verified correct): moved above `StoryConfigError`, purely cosmetic
  reordering, no behavior change, still used once in `load_dict`.

- `game-api/src/mlops_serious_game/domain/grudge.py:19` — `GRUDGE_LIFETIME = 2` is a hardcoded Python
  constant. D38 says "Decided after the first playtest, not before. Until then all of them live in
  config, not in code: emotion effect per dialogue option, Veto Breaker degradation, grudge lifetime."
  This is a direct divergence from D38 for the one number `grudge.py` owns.
  **Resolved post-review (2026-09-12)**: added `pitch_tuning.grudge_lifetime` to
  `gameConfig/EmotionValueConfig.json` (+ schema), a `PitchTuning` model in `domain/emotion.py`, and
  `EmotionFactory.get_pitch_tuning()`; `grudge.py` now reads `GRUDGE_LIFETIME =
  EmotionFactory.get_pitch_tuning().grudge_lifetime` (still a module constant, so `pipeline.py`'s
  import is unchanged) instead of a bare literal, falling back to `2` if the config key is omitted.
  Fixed together with the `session.py` constants below (same D38 gap). Original deferral reasoning
  kept below for context: **Deferred** — not fixed:
  (1) fixing it means threading a config-sourced value through `application/graph_service/pipeline.py`
  (`GRUDGE_LIFETIME` is imported and used there at lines ~33, 271), which is outside this batch's file
  list (batch A/C territory); (2) there is no existing config file/schema slot for it yet (checked
  `gameConfig/EmotionValueConfig.json` and friends — nothing named `grudge_lifetime` anywhere in
  `gameConfig/*.json`), so this is a small design task (add a config field + loader + schema), not a
  surgical one-file fix; (3) the same pattern already exists elsewhere on the branch outside this batch
  (`EMOTION_VETO_BREAKER = -0.40` is hardcoded in
  `application/pitch_debate_service/session.py:364`, also called out by D38 and also not in config),
  so this looks like a deliberate "decide after playtest" placeholder rather than an isolated miss in
  `grudge.py`. Flagging here so a human can decide whether to open a follow-up covering all three D38
  numbers at once rather than patching `grudge.py` alone.

- `game-api/src/mlops_serious_game/domain/requirement_factory.py:118-139` (the new D42 branch) — no
  direct unit test exercises `payload_errors()`'s `refines_id` validation itself: unknown parent,
  stakeholder mismatch, target mismatch, non-forward phase, or an invalid tag transition. `grep` across
  `game-api/tests/*.py` finds `refines_id` used only in `test_dossier_chains.py`, which exercises the
  dossier-display side (chain grouping/locked rows), not the config-gate function added here. **Deferred**
  to batch G ("Tests — cross-batch pass"): test files are out of this batch's file list, and the plan
  explicitly routes test-coverage work for cross-cutting gates like `payload_errors` there.
  **Resolved**: batch G added a `test_graph_patterns.py` case for this exact gap.

- All other reviewed domain files (`Challenge.py`, `Phase.py`, `phase_factory.py`, `metric.py`,
  `metric_factory.py`, `offline_intel_artifact.py`, `offline_intel_artifact_factory.py`, `persona.py`,
  `persona_resolver.py`, `stakeholder.py`, `stakeholder_factory.py`, `prompts.py`,
  `gameConfigLoader.py`, `glossary.py`, `glossary_factory.py`) were read against the same criteria
  (correctness, redundancy, efficiency, D1-D46 consistency, test coverage) — no further issues found.
  Notable consistency checks that passed: `Challenge`/`Phase`/`phase_factory.validate_templates` match
  D2/D3/D7/D8; `metric.py`'s `component_weights` replacing `metric_prompt` matches D39; `stakeholder.py`/
  `stakeholder_factory.py`/`persona.py`/`persona_resolver.py`'s persona/token-rendering system is
  internally consistent (seeded per-player-per-stakeholder draw, context-var-scoped rendering, graceful
  no-persona fallback); `prompts.py` correctly speaks Driver/Boundary/Trade-off/Fact throughout (old
  Requirement/NegotiablePreference/PersonalFriction language fully replaced, matching D16);
  `gameConfigLoader.py` wires the new graph/pattern/story/glossary factories and their validation gates
  in a sensible order (graph and patterns before `validate_templates`/`validate_payloads`; glossary
  load is wrapped so a broken glossary can't block game startup, matching its own docstring intent).

## Verification

`docker compose exec api python -m pytest tests -q` → **193 passed, 0 failed** (run twice during this
pass, both times clean; no regressions from the changes already on disk).
