# Results screen

A rich end-of-game debrief that replaces the current thank-you `EndPage`, plus the run scoping
needed to let a player start a fresh game from it.

## Status

All nine steps are built on `feat/results-screen`.

Deviations from the plan as first written, each made deliberately:

- **`GameSession` is one row per run, not a chain read.** Escalation points refresh per game while
  grudges carry on a next iteration, and both live on one row, so "follows the chain" was
  incoherent. `game:new_run` creates the new run's row and copies forward what should carry:
  personas always, grudges only for a next iteration, escalation never.
- **Emotions and metric gauges carry through the run chain**, not through the session row. A next
  iteration opens with the gauges where the last run ended and the room as it left it; a fresh
  start opens neutral. `handle_game_init` reads this via `inherited_state`.
- **Spiral metric gains are measured from where the run began**, not from the start of the chain
  (`metric_summary(own_from=...)`), the same trap `pipeline_health` guards against.
- **Stakeholder charts use bars and lines, not a radar.** Six stakeholders compared on one measure
  is a magnitude comparison, which bars read far more accurately than a radar does.
- **Reloading is how a new run starts on the client.** `game:new_run_started` triggers a page
  reload, which re-runs the normal `game:init` and deals the first challenge, the same mechanism
  `settings:account_reset` already uses.
- **Two reads were missed in step 1 and found in step 7**, both fixed with regression tests:
  `handle_game_init` took the maximum progress index across every run (so a finished first game
  sent a replaying player straight back to the results), and `store_or_update_challenge` carried
  emotions forward from the latest row across every run.
- **The existing admin aggregates now describe each player's first run.** They were per player, not
  per run, so a replay would have double-counted challenge rows and questionnaire answers, and a
  player mid-way through game two would have read as "Completed". Every progression and challenge
  read in `admin_service` is scoped to `FIRST_RUN`; the new Results page covers runs explicitly and
  defaults to first runs only, with "all runs" one click away.
- **The playtest exclusion is one clause.** `get_valid_players_set` selects straight off `User` and
  is the chokepoint behind every admin aggregate, so leaving tainted accounts out is a single
  `.where()` there rather than a filter per aggregate.
- **Auto-pitch slots the card, it does not commit it.** It goes through the real `pitch:set_card`
  and the tester commits. Skip goes through the real commit, simulation and state-update handlers,
  which already send the same `game:state_update`/`game:progress_change` a normal "Proceed" click
  sends - the client picks that up on its own and reopens the briefing for whatever came next, no
  reload needed. Candidate changes are seeded from what the intel asks for: raising each target by
  one level alone found nothing the room would accept on five of six challenges.
- **From a neutral room the best a playtest card can be is a soft pass.** Low-power stakeholders sit
  at buy-in 0.2 against a 0.3 objection threshold, so a clean pass needs relationship work the tool
  does not do. The tool reports the outcome it actually got.
- **Each playtest button needs two presses**, because the taint is permanent. The armed state lives
  in a child of the modal, so it resets when the panel closes.

### Bug found and fixed: skip could not get past Model Deployment

"Skip this challenge" would refuse forever on `ch_shadow_deployment_contract` (118). The cause was
a real structural veto, not a search-algorithm gap: automation_alex's stance items on that
challenge carry no `branch_x`/`branch_y` atoms and no target, so `is_trade_off_satisfied` can never
return true and no card the search could ever build clears the veto - confirmed both by exhaustive
search and by a separate atoms-only structural check.

The fix restores the Veto Breaker (D15), a mechanic the game had before and lost in `9efb7f7`
("wip: rework intel items and pitch debate") - the pipeline-side machinery (`VETO_BROKEN`,
`veto_degradation_ops`, `grudges_created`) was never removed, only the pitch-layer link to it was.
Three Escalation Points per playthrough (refreshed on a fresh run, carried across a spiral, same as
before), spendable from the `VetoDialog` a human player sees or, as a last resort, by
`playtest:skip_challenge` itself once it proves no accepted card exists. Auto-card never spends one
on the tester's behalf.

Escalation is a fallback, not the fix for the content gap. `RequirementObjects.json`'s three
`gen_shadow_deployment_contract_*` Trade-offs now carry real `branch_x`/`branch_y` (target
`deploy.shadow`, level 4 or 2), matched to the graph rather than invented from narrative: both
levels already existed in this same challenge - 4 is the governed level Ruth's boundary and
Reuben's driver ask for, 2 is automation_alex's own stated position in the challenge's `conflict`
block. A card that clears Ruth's boundary now clears Alex too, and ch118's own search finds it
without ever reaching for an Escalation Point (`test_skip_no_longer_needs_the_fallback_on_ch118`).
The Veto Breaker's own tests no longer lean on ch118 staying broken: they exercise a deliberately
weak card/search result instead, so they will not need rewriting the next time a content gap is
closed.

The same empty-`branch_x`/`branch_y` shape existed on every Trade-off in `RequirementObjects.json`
- not just ch118's. Five other challenges (110, 111, 114, 115, 117) had it too; none were an
unconditional veto like ch118 (each high-power stakeholder there also has a satisfiable Driver
alongside the broken Trade-off), but the search still had to work around dead content on every one
of them. All fifteen items across those five challenges now carry real branches, each target/level
pair pulled from something already authored for that same challenge - the challenge's own
`conflict` block, a sibling Driver's `suggested` level, a Boundary's `holds` level, a Fact's
`asserts` level, or an edge's own `initial_level` in `MlopsGraph.json` - never invented. One item
(ch117's `monica_reproducibility`) needed its target moved off `model.registry` entirely:
`requirements_reuben`'s Boundary there is a ceiling (`holds: lte 2`), directly opposed to
`model_monica`'s own Driver wanting `model.registry` at 4, so a Trade-off on the same node would
have reproduced ch118's exact bug in a new challenge. It now resolves on
`model.experiment_tracking` instead (a real, adjacent graph node matching "would accept a manual
logging process" far more literally than the contested registry node), with the item's own `ops`
field populated so that target is legally reachable ( `get_allowed_targets` only opens a target
once something in the challenge's intel already points at it).

Verified against the real search (`auto_card.search_card`, the same algorithm both the room UI and
the playtest tools use), not just the config validator: all five now return `PASS` or `SOFT_PASS`
- `test_search_finds_a_non_veto_card` in game-api/tests (removed after the check, per this repo's
scratch-file convention) parametrized over all five and printed each outcome and min buy-in.

### Bug found and fixed: graph-driven metric deltas were never persisted

`DeltaReport.metric_deltas` (what the simulation actually did to each gauge, per
`pipeline.metric_deltas`) was computed and shown on the simulation screen, but
`handle_state_update_request`'s "proceed to next milestone" step - the only place `metric_values`
is ever advanced - read the delta from `action_card["metric_changes"]` on the **client's own
request payload**, and `handleAcSimulationContinue` in `ac_simulation.tsx` never sends that key
(it sends `challenge_loop_index` and the metric values as they stood, nothing else). So the
graph-driven number was computed, shown to the player, and then silently dropped; only the static
per-challenge config delta (almost always zero in `FullGameProgression.json`) ever landed. The
in-game gauges did not move with the graph, and the results Metrics tab would have read flat for
every real run.

Fixed: `handle_simulation_run` now writes the deltas onto the challenge's own row
(`pitch_store.set_metric_changes`, idempotent - a replay of an already-simulated challenge writes
the same stored report's deltas back), and `handle_state_update_request` reads from that row
instead of trusting the payload for this one field. An explicit payload value, if a caller ever
sends one, still wins over what was persisted. Covered by `test_metric_persistence.py`, including
an end-to-end run through the real pitch/commit/simulate chain and a mutation check confirming the
regression test fails against the reverted code.

## What already exists

- Progression is `0` intro questionnaire, `1` briefing, `2` gameplay, `3` outro questionnaire,
  `4` `EndPage` (`Game.tsx`). **The outro questionnaire is already asked before the end screen**,
  and `EvaluationQuestions.json` already repeats all seven knowledge questions in
  `outro_questions`. Nothing new is needed to "re-ask the questionnaire", only the delta read.
- `calculate_intro_percentage` / `calculate_outro_percentage` in `admin_service` already score a
  player's knowledge answers.
- Source data for statistics is all present: `GameEventRow` (typed event log), `GraphOpLog`
  (ops plus the `DeltaReport` per simulation), `IntelItem` (`is_correct()` compares the player's
  tag against the true tag), `GameChallenge` (per-challenge metrics, action card, emotions,
  attention tokens), `GameSession` (personas, escalation points, grudges).
- `chart.js` + `react-chartjs-2` and `@mui/x-charts` are already dependencies. No new packages.

## Decisions

| # | Decision |
|---|---|
| D1 | Add `run_index` to every per-user table and scope live reads to the current run. |
| D2 | Grade is a composite of four pillars, each also shown on its own. |
| D3 | The player sees their knowledge delta as numbers only, never the answers. Every run's answers are stored so later runs extend the delta series. |
| D4 | "New game" is gated behind a new per-campaign flag, like `use_questionnaire`. |
| D5 | Epilogue prose comes from authored templates in `gameConfig`, not an LLM. |
| D6 | Admin gets a new **Results** subpage with campaign aggregates and a per-player, per-run drill-down. |
| D7 | Missed intel is shown as counts and coverage only, never its text. |
| D8 | Screenshot support is layout only. No image export, no new dependency, no social links. |
| D9 | Playtest tools (skip phase, auto-pitch) extend the existing `SettingsPanel`, gated by one server-side `.env` flag in the `ENABLE_RESET_USER` mould. |
| D10 | Using a playtest tool taints the whole **user account**, not just the challenge or run, and tainted accounts leave the research aggregates by default. |
| D11 | New game offers two modes: **Fresh start** (clean slate) and **Next iteration** (the spiral: back to requirements carrying the system you built). A run records which it was via `seeded_from_run`. |
| D12 | The epilogue delivers a grade-based verdict on Lindenmarkt in the setting's own business terms (availability, waste, residual stock, override rate), never literal disaster. |

## Assumptions

Stated rather than asked. Change any of these and the plan follows:

- The results screen **replaces** `EndPage` at `progressionIndex 4`. When replay is off for the
  campaign, the existing "please do not play again" notice folds into its footer.
- Run 2 does **not** re-ask the intro questionnaire. Run 1's outro is run 2's baseline, so the
  delta series is `intro -> outro(run 1) -> outro(run 2) -> ...`.
- Campaigns with `use_questionnaire = false` get the whole screen minus the knowledge panel.
- The scheduler's played-challenge set stays **cross-run** so a new game deals unseen challenges.
  Everything else (graph, intel, emotions, grudges, escalation) scopes to the current run chain:
  that is the current run alone for a Fresh start, or the whole spiral chain for a Next iteration
  (D11).
- Grade thresholds and pillar weights live in config so they can be tuned without a deploy.

---

## 1. Run scoping and the two new-game modes (D1, D4, D11)

Migration `add_run_index`:

- `run_index INTEGER NOT NULL DEFAULT 1` on `GameProgression`, `GameChallenge`, `IntelItem`,
  `GraphOpLog`, `GameEventRow`, `GameSession`. Existing rows backfill to `1`.
- Composite index `(user_id, run_index)` on each.
- `Campaign.allow_replay BOOLEAN NOT NULL DEFAULT FALSE`.

A single helper, `current_run_index(session, user_id)`, returns the max `run_index` on
`GameProgression`. Every store read side gains a `run_index` filter:
`graph_service/store.load_log`, `event_log_service/store.load_events`,
`get_discovered_intel_items`, `get_or_create_game_session`, and the challenge writes in
`handle_state_update_request`.

The one deliberate exception: `select_next_challenge` keeps reading `GameChallenge.challenge_index`
across **all** runs for its `played` set, which is what makes a new game deal new challenges with
no extra bookkeeping.

### The two new-game modes (D11)

`GameProgression` also gains `seeded_from_run INTEGER NULL`: null means a fresh run, otherwise it
names the run this one continues. That one nullable column is the whole difference between the
modes.

**Fresh start.** Clean slate. Seeds `seed_ops` and a new `GameSession`, exactly as a first-time
player.

**Next iteration (the spiral).** Back to phase 1 carrying the system already built, with its
maturity, its technical debt and its active anti-patterns intact. This is what an MLOps cycle
actually looks like: the second iteration does not rebuild the pipeline, it revisits requirements
against the one that exists.

The implementation is one predicate rather than any state copying, because the graph is a pure
fold over an append-only log and **every** read goes through `graph_service/store._rows(username)`
(`load_log`, `load_state`, `snapshot_at`, `has_graph` all sit on it). So:

- `_rows` gains a run filter that resolves the **run chain**: walk `seeded_from_run` back from the
  current run and include every run in that chain. Fresh run, chain of one. Spiral run, the chain
  it continues. Runs 1 fresh, 2 spiral, 3 fresh, 4 spiral gives run 4 the chain `{3, 4}`.
- The same chain predicate governs `get_discovered_intel_items` and `event_log_service.load_events`,
  so the dossier and the log carry forward with the system that explains them.
- `seed_if_empty` is a no-op on a spiral run, because `has_graph` already sees the chain.
- Player knowledge carries for free: `replay()` derives it from the same log, and a team knowing
  its own system is the correct reading.

Two emergent properties worth keeping. `next_challenge` takes its `ctx` from the carried graph and
its `played` set is cross-run, so a spiral run deals challenges that are both unseen **and**
appropriate to a matured system, with no extra scheduling work. And a fresh run after a spiral run
correctly starts clean, because the chain stops at the fresh one.

Open, listed rather than decided:

- **Emotions and grudges.** Carried in full by default, since `GameSession` follows the chain.
  Time passing between iterations arguably warrants a decay toward neutral. A config knob
  (`spiral_emotion_decay`, default `0`) rather than a structural choice.
- **Escalation points.** Three per game and never regenerated (D15). A new iteration plausibly
  earns a fresh budget. Defaulting to refresh, since the alternative makes a long spiral chain
  unplayable.
- **Metric baselines.** `handle_state_update_request` computes each challenge's `metric_values`
  cumulatively from the previous challenge's, so on a spiral run they continue from the inherited
  figures. Correct for the HUD, and it carries the same caveat as Pipeline health: the Metrics
  section must show the spiral run's own movement alongside the running total, or a late
  iteration reads as a triumph on the back of earlier work.

### Neither mode deletes anything

Both modes are pure inserts: a new `GameProgression` row, a new `GameSession`, and for a fresh
start a new seed batch. Every earlier run keeps its `run_index` and every row it ever wrote, so
`GameChallenge`, `IntelItem`, `GraphOpLog`, `GameEventRow` and each run's cached `GameResult`
all survive both modes intact. A fresh start is a new chain, never a reset.

This is load-bearing for the whole plan: the admin aggregates, the per-run drill-down and the
cross-run knowledge-delta series all read history that only exists because nothing on this path
removes it.

Two hazards to hold to that:

- **Do not call `graph_service/store.clear_graph()`.** It deletes a user's entire `GraphOpLog`
  with no run scoping, and it currently has zero callers, which makes it exactly the function an
  implementer reaches for when wiring "fresh start". Fresh start starts a new chain by
  `run_index`; it never clears. Either delete `clear_graph` as part of this work or give it a
  docstring saying so.
- **Every `delete()` in the API stays on an admin or reset path.** `remove_player`,
  `remove_all_players`, `remove_campaign` and `reset_player` are the only ones, and none is
  reachable from the results screen. `game:new_run` must not grow a cleanup step.

One coupling to be aware of, since it is not obvious: the idempotency keys `has_batch` and
`load_report` use `source_id` (`enter:{template_id}`) scoped per user, not per run. That is safe
only because the cross-run `played` set means a challenge template is never dealt twice to the
same user. If challenge repeats across runs are ever allowed, those two need the run chain too,
or a spiral run would silently skip a challenge's `on_enter_ops`.

### The event

New websocket event `game:new_run`, taking `mode: "fresh" | "spiral"`. Inserts a `GameProgression`
row at `run_index + 1` with `game_progress_index = 2` and `seeded_from_run` set per mode, seeds a
`GameSession` (fresh, or carried per the knobs above), then replies with the normal init payload so
the client re-enters phase 1. Rejected when the campaign has `allow_replay = false`.

## 2. Results computation (D2, D3, D7)

New `application/results_service/`:

- `compute.py`: pure functions over already-loaded rows, so they are testable without a DB.
- `service.py`: loads one run's rows once and calls them.

**Pillars**, each normalised to `0..1`:

| Pillar | Derived from |
|---|---|
| Pipeline health | mean stage `health` from `build_graph_state`, weighted over stages reached. **On a spiral run, the improvement over the inherited baseline**, not the absolute value, or the run grades itself on work the previous run did |
| Stakeholder relations | final per-stakeholder emotion means from the last `GameChallenge.emotion_values`, weighted by power x interest, minus a penalty per fired grudge |
| Intel accuracy | `is_correct()` over tagged items, times gathered/available coverage |
| Decision quality | `outcome` events across challenges, `PASS` 1.0, `SOFT_PASS` 0.5, `VETO` 0.0, minus escalation points spent |

`overall = sum(weight_i * pillar_i)`, weights from config. Grade bands map `overall` onto letters
with a deliberately generous curve, also from config, since no run can realistically max the graph.

**The `GameMetrics` gauges are deliberately not a fifth pillar.** Every metric carries
`component_weights` and moves with the graph rather than with any judgement of the proposal
(`domain/metric.py`), so a metric is a differently-weighted read of the same components the
Pipeline health pillar already scores. Grading both would count that work twice, and would let a
metric whose weights happen to overlap several stages dominate the grade. They get their own
detail section instead, where they are what the player actually watched all game.

**Detail sections**, all read off existing rows:

- Intel: gathered vs available per stakeholder, tagged correct vs wrong per tag type, items
  corrected by a stakeholder during objections (`objection` events), verified vs inferred split.
- Stakeholders: per stakeholder final mood as bars, a mood trajectory per challenge as lines, and
  the number of grudges that fired.
- Decisions: per challenge, the action card played, its outcome, attention tokens spent,
  escalation used, and the resulting `DeltaReport` headline.
- Pipeline: what the Performance Dashboard shows, frozen at the end. Per stage, `health`,
  `status`, `maturity`, `debt`, `broken` and `starved` counts, all already on
  `build_graph_state`; plus `system_health`, the active patterns split into anti and design,
  components left capped by an upstream bottleneck, and components never discovered or left on a
  stale snapshot. The last two are a coverage read as much as a health one: a component the
  player never looked at is a different failure from one they looked at and broke.
- Metrics: the eight `GameMetrics` gauges the player watched on the dashboard's `MetricTab` rail
  all game, so the screen closes the loop on the HUD rather than introducing a scoring language
  the player has never seen. Final value against `max_value` per metric, plus the per-challenge
  trajectory, which `GameChallenge.metric_values` already stores as a list aligned with
  `MetricFactory.get_available_metrics()`. `admin_service.calculate_metric_sum_per_challenge` and
  `calculate_metric_sum_per_challenge_increase` already compute exactly this shape for the admin
  charts and are reused rather than reimplemented. `efficiency_intro` and `model_intro` are
  tutorial-phase metrics and stay out of the headline.
- Timeline: the `GameEventRow` stream grouped by phase, reusing the existing `EventLog` component.
- Knowledge (D3): intro correct-count, each run's outro correct-count, and the deltas, broken down
  by Bloom taxonomy from `Question.taxonomy`. Numbers only, never per-question answers.

Results are computed on demand and cached into a new `GameResult` row (`user_id`, `run_index`,
`payload JSON`, `time_stamp`) on first request, so the admin aggregates and any later revisit read
one row rather than replaying the whole log.

## 3. Epilogue content (D5, D12)

New `gameConfig/EndgameEpilogue.json` with a matching schema, loaded by a
`domain/epilogue_factory.py` in the same shape as `story_factory.py`: deterministic keyed lookup,
a generic fallback per key plus more specific overrides, and prose in the terse concrete voice
`MlopsStoryFragments.json` already uses.

Three parts.

### `verdict`: what became of Lindenmarkt (D12)

One passage per grade band, telling the chain's outcome in the fiction rather than praising the
player. `Briefing.json` already promises the criteria: *"Availability, waste, residual stock and
how often store managers ignore the system are what you will be judged on."* The epilogue returns
a verdict on exactly those four, which turns the briefing into a setup and this into its payoff.

At the top band Shelfcast is the thing the chain plans around: the morning order window passes
without anyone noticing it, buyers size a middle aisle week off the allocation instead of
instinct, and the override rate has fallen far enough that store managers arguing with the
forecast is news rather than routine.

At the bottom band nothing explodes. The failure register stays mundane, in-domain and expensive,
which is what `Setting.json`'s `current_pain` already describes and what makes it land: the
forecast job misses the morning window and stores order blind that day, the override rate climbs
back past where it started, garden furniture sits on pallets in the warehouse after the promotion
week closed, and an advertised article is gone by the first morning in half the estate. The
project is not cancelled. It is merely back to being half trusted, having cost a year.

**No literal disaster.** No fire, no collapse, no ruin. The setting's own failure modes are
better storytelling than catastrophe, and a serious game about a forecasting platform loses its
credibility the moment the supermarket burns down.

### `scoreboard`

Four short lines per grade band, keyed to the briefing's four criteria (`availability`, `waste`,
`residual_stock`, `override_rate`), so the hero card can show the business read beside the grade.
`override_rate` carries the most weight in the prose, being the one `Setting.json` calls "the
team's proxy for trust" and the one the player's stakeholder handling most directly earns.

### `beats`

Unchanged from the mechanical side: fragments keyed by a predicate over the computed results (a
stakeholder ended hostile, a pipeline stage ended broken, a grudge fired, intel accuracy above or
below a threshold), each with a `priority`, top three shown. Where `verdict` says what became of
the chain, `beats` say which of the player's specific choices got it there.

Text uses the existing `#marker#` persona syntax and goes through `personalize()`. Company and
system names are written literally, as `Briefing.json` already does.

**On a spiral run** (D11) the verdict is framed as the state at the end of this iteration, not the
end of the project, since the player is being offered another cycle on the same system. One
alternate phrasing per band, selected on `seeded_from_run` being set.

## 4. Frontend (D8)

`game-ui/src/components/Results/`:

- `ResultsScreen.tsx`: the route at `progressionIndex 4`, replacing `EndPage`.
- `ResultsHero.tsx`: the screenshot target. One fixed-aspect card, no scroll, holding the grade
  badge, the run's headline numbers, four pillar meters, the epilogue `verdict` and the four
  `scoreboard` lines. Sized to fit a single viewport so an OS screenshot captures it whole. The
  verdict is what makes the card worth screenshotting: "B, and here is what happened to
  Lindenmarkt" travels, a bare grade does not.
- `ResultsTabs.tsx`: the detail sections above as tabs (Intel, Stakeholders, Decisions, Pipeline,
  Metrics, Knowledge, Timeline), charts via `react-chartjs-2` matching the existing dashboard
  styling. The Pipeline and Metrics tabs reuse `PerformanceDashboard`'s own vocabulary -
  `healthBucket`/`HEALTH_BUCKET_WORD`, `LEVEL_LABELS`, the metric colours and icons from
  `GameMetrics.json` - so the debrief reads as the dashboard at rest, not a second design.
- Footer actions when `allow_replay` is set: **Next iteration** and **Fresh start**, presented as
  a choice rather than one button with a mode toggle, each with a line saying what carries over.
  Next iteration leads, being the one that teaches the spiral. The existing close-the-tab notice
  otherwise.

`EndPage.tsx` and its CSS are deleted.

## 5. Admin (D6)

- `GET /api/admin/results?campaign=&player=` in `admin_routes`, backed by
  `admin_service.get_results_dashboard_data`.
- Campaign aggregates: grade distribution, mean and spread per pillar, intel accuracy
  distribution, outcome mix, mean knowledge delta with the per-run series, completion and replay
  counts, most and least gathered intel items, most vetoed challenges.
- Per-player drill-down: a run picker, then that player's results payload rendered with the same
  tab components the game uses.
- New `"results"` value in `Admin.tsx`'s `activeSubpage` union, with its nav tab and subtitle.
- Campaign manager gets an `allow_replay` toggle next to the questionnaire toggle.


## 6. Playtest tools: skip phase and auto-pitch (D9, D10)

Both exist to manufacture completed runs cheaply, so the results screen and the admin aggregates
have data to render. Neither is a player feature.

Everything this needs already exists as of `feat/player-settings-and-tts`
([player-settings-and-tts.md](player-settings-and-tts.md)). This section adds one config field,
one payload field, one panel section and two events. No new plumbing.

### The flag, following `ENABLE_RESET_USER` exactly

`ENABLE_PLAYTEST_TOOLS: bool = False` in `config.py`, next to `ENABLE_GRAPH_DEBUG`,
`ENABLE_DOSSIER_DEBUG` and `ENABLE_RESET_USER`, read from `game-api/.env`.

`settings_handler._send_settings_data` already merges `can_reset_account` off the flag into every
`settings:data` payload; it gains `can_playtest` the same way. `SettingsProvider` already tracks
`can_reset_account` off that payload, so it gains `canPlaytest` alongside it. The two new events
re-check `settings.ENABLE_PLAYTEST_TOOLS` server-side before doing anything, exactly as
`handle_settings_reset_account` does, because the flag is the only thing between a crafted
websocket frame and a fabricated run.

Deliberately not a `VITE_` variable: the `ui` service has no `env_file` in `docker-compose.yml`,
Vite inlines env at build time, and a client-side flag can be flipped in the bundle.

### The panel section

`SettingsPanel.tsx` gains a **Playtest** section rendered only when `canPlaytest`, in the same
shape as its existing Account section: **Skip this challenge** and **Auto-pitch a card**. The
panel is already mounted in `Game.tsx` outside the `progressionIndex` switch, with a floating gear
plus `onSettingsToggle` on all three gameplay screens and the dossier header, so both buttons are
reachable from anywhere without touching any entry point.

### Skip challenge

New event `playtest:skip_challenge`. Runs the challenge to completion server-side: auto-gather the
challenge's intel (mark every `RequirementFactory` item for it discovered and correctly tagged),
run the auto-pitch below, commit, run the simulation, advance through the normal
`select_next_challenge` path.

Auto-gather is not optional. `handle_pitch_set_card` rejects any target whose
`knowledge.state_of(target)` is `"unknown"`, so skipping the gathering steps without it leaves the
pitch builder with an empty legal target set.

### Auto-pitch

New event `playtest:auto_card`. `card_view()` is pure and LLM-free and `MAX_ATOMIC_CHANGES` is 3,
so this is a small enumeration, not an optimisation problem:

1. Candidate targets: `get_allowed_targets(...)` filtered to those the player knows.
2. Candidate changes per target: the legal `kind`/`value` range for that component.
3. Enumerate subsets up to size 3, score each with `card_view`, partition by `outcome`.
4. Pick uniformly at random from `PASS`, falling back to `SOFT_PASS`, then to the highest minimum
   buy-in found. Seeded from `(username, run_index, challenge_id)` so a run is reproducible.

**No guarantee of a non-veto set exists.** `buy_in = 0.6 * norm_align + 0.4 * emotions`, and a
boundary violation by a high-power stakeholder vetoes regardless of score, so a room with worn-down
emotions or conflicting boundaries may have no clean card. The event reports the outcome it
actually achieved rather than claiming a pass.

The chosen set is replayed through the normal `pitch:set_card` -> `pitch:evaluate` ->
`pitch:commit` path, never written straight to the store, so every emotion delta, objection,
`GameEventRow` and `GraphOpLog` entry is produced exactly as in a human play. That is what keeps
the resulting statistics calculatable.

### Keeping synthetic data out of the research set

The taint is **account-level, not per challenge**. `User` gains
`playtest_tainted BOOLEAN NOT NULL DEFAULT FALSE`, set true the first time either tool fires and
never cleared.

Per-challenge would be the wrong unit, because contamination does not stay inside the challenge
that caused it:

- Within a run, graph state, emotions and grudges carry forward, so a hand-played challenge after
  an auto-played one started from a fabricated world state.
- Across runs, the played-challenge set is deliberately cross-run (section 1), so auto-play in
  run 1 changes which challenges run 2 deals.
- The knowledge-delta series spans runs, so one tainted run poisons the readings on both sides
  of it.

Consequences:

- `admin_service.get_valid_players_set` gains a `playtest_tainted == False` filter. It selects
  straight off `User` and is the single chokepoint behind every existing aggregate (questionnaire
  averages, player totals, metric sums, questionnaire results, and `get_finished_players_set`
  which derives from it), so this is one `.where()` clause and tainted accounts drop out
  everywhere at once. One visible "include playtest accounts" toggle overrides it.

  This is also cheaper than the per-challenge alternative would have been: none of those
  aggregates join `GameChallenge`, so a per-challenge filter would have needed adding separately
  to each one.
- `GameResult.payload` carries `playtest_tainted`. The results hero shows a "playtest account"
  ribbon on every run once tainted, not only the auto-played one, which is the honest reading.
- `GameChallenge.auto_played BOOLEAN NOT NULL DEFAULT FALSE` stays in the same migration, but
  purely as a debugging breadcrumb for "which challenge did I skip". Nothing filters on it.

### Interaction with the existing account reset

`settings:reset_account` (`admin_service.reset_player`) wipes every row for the player and
re-inserts a bare `User`, which is **not** what "New game" does. Under D1, New game adds a
`run_index` and keeps history; reset destroys it, including the cross-run played-challenge set and
every past `GameResult`. Both stay, doing different things, and the results screen's New game
button calls `game:new_run`, never the reset. Worth a line in the reset confirmation copy saying
progress from earlier runs goes too.

Reset also clears the taint, because it deletes the `User` row and re-inserts a bare one. That is
the right outcome rather than a loophole: the reset deletes every row the account had, so there
is no synthetic data left to keep out of the aggregates. It does mean a tainted player can
legitimately rejoin a study by resetting, which is the same guarantee the reset already gives.


---

## Steps

1. Migration plus `run_index` filters in every store read side, and the `allow_replay` column.
2. `results_service` with pure `compute.py` and its unit tests.
3. `GameResult` cache row and the `results:get` websocket event.
4. `EndgameEpilogue.json`, its schema, and `epilogue_factory`.
5. `ResultsScreen` and `ResultsHero`, wired at `progressionIndex 4`, `EndPage` removed.
6. `ResultsTabs` detail sections.
7. `game:new_run` with both modes, the `seeded_from_run` chain predicate in `_rows` and its
   intel/event-log counterparts, and the two footer buttons.
8. Admin route, service aggregates and the Results subpage.
9. `ENABLE_PLAYTEST_TOOLS`, the `SettingsPanel` Playtest section, `playtest:auto_card` and
   `playtest:skip_challenge`, and the `auto_played` flag. Could move ahead of step 5: it needs
   only the run scoping from step 1, and it is the fastest way to generate data for steps 5 to 8.

## Testing

Backend via `docker compose exec api pytest tests/ -q`. New tests cover each pillar function on
hand-built rows, grade banding at band edges, epilogue beat selection, and that a second run sees
none of run 1's graph ops, intel or events while still skipping run 1's challenges. Frontend via
`npm test` in the `ui` container for the hero card's grade rendering and for the knowledge panel
with the questionnaire disabled. The auto-pitch search gets a test that it never returns a change
set the pitch handler would reject, and one on a deliberately unwinnable room asserting it reports
the veto rather than looping. `SettingsPanel.test.tsx` and `test_user_settings.py` already exist
and are extended for the Playtest section and the flag gate rather than duplicated.
