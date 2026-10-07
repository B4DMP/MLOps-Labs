# Shorter playthrough and a grade that can spread

Two linked problems. A playthrough is too long (6 challenges including the demo, plus two
questionnaires), and the grade barely moves: simulated play of every quality lands on C or E.
Playing 2-3 random challenges per run is only safe once the grade means the same thing for a short
run as for a long one, so both are planned together.

## Status

| Step | State |
|---|---|
| Playtest profiles (perfect / medium / bad) in `skip_challenge` and `auto_card` | built, no UI picker yet |
| Simulation harness `game-api/tests/sim_grades.py` | built |
| Grudge penalty per distinct grudge | built |
| `prefer="best"` search for the perfect profile | built |
| Mood sign fix (proposal 1) | built |
| Content gate and `par_outcome` (proposals 2, 3) | built; PASS authored into 114, 115, 119, 120; 116 and 118 stay par SOFT_PASS (hard conflicts) |
| Make amends (proposal 4), time heals (5) | built |
| "Table it" exit (6), room hint in the veto dialog (8) | built |
| `flawless` profile | built |
| Relations from the whole run (proposal 7) | built (mean of per-challenge moods, last counted twice) |
| Pipeline pillar = damage won back per challenge | built; replaces "final graph health", and by construction ignores skipped phases (D3) |
| Seven drivers still pinned by unreachable edges | open, listed in `tests/test_room_par.py::KNOWN_UNREACHABLE` |
| Pipeline health over played stages only | not started |
| Run subset (`challenges_per_run`) | not started |
| Gate 7 and next iteration over a subset | not started |
| UI and admin counters | not started |

## Evidence: what the grade does today

`docker compose exec -e SIM_SEEDS=4 api python -m pytest tests/sim_grades.py -s -q`. Each run is
the real handlers end to end (gather, pitch commit, simulation, state update) on a throwaway DB,
then `build_results`. Profiles (`playtest_service/profiles.py`):

- **perfect**: every note found and tagged right, aims for a PASS.
- **medium**: 80% of notes found, 75% of those tagged right, aims for a SOFT_PASS.
- **bad**: 50% found, 45% right, aims for a VETO and breaks it with an Escalation Point (3 per run).

| Profile | Grade (4-6 runs) | Overall | Pipeline | Relations | Intel | Decisions |
|---|---|---|---|---|---|---|
| perfect, grudge per fire (before) | C C C C C C | 0.56 | 0.78-0.82 | **0.00** | 1.00 | 0.60 |
| perfect, grudge per distinct (now) | B B B B | 0.59-0.61 | 0.78-0.82 | 0.11-0.13 | 1.00 | 0.60 |
| medium, before | C C C C C C | 0.46-0.49 | 0.72-0.81 | **0.00** | 0.61-0.74 | 0.50 |
| medium, now | C C C C | 0.48-0.51 | 0.75-0.82 | 0.05-0.15 | 0.61-0.71 | 0.50 |
| bad, before | E E D E E E (one run stuck in a veto) | 0.24-0.38 | 0.50-0.87 | 0.00-0.15 | 0.33-0.46 | 0.00-0.05 |
| bad, now | E E E E | 0.24-0.29 | 0.50-0.58 | 0.00-0.12 | 0.36-0.40 | 0.05 |

What this says:

1. **Grades did spread by play quality (B / C / E), but the top is unreachable.** Perfect play
   cannot reach A (0.72), let alone S (0.85).
2. **The relations pillar is the cause.** It is 0.00 in nearly every run before the fix, and about
   0.1 after. Room mood sits near 0.5 whatever the player does, and each grudge takes 0.08. Even
   perfect play writes ~5 grudges in 5 challenges because the best card the search finds is a
   SOFT_PASS in 4 of 5 rooms (a PASS in one). So 0.5 - 5 x 0.08 leaves about 0.1.
3. **The fix so far moves perfect play from C to B.** Not enough on its own: the pillar still
   carries 30% of the grade and almost never leaves the floor.
4. **A bad run can get stuck.** Once the 3 Escalation Points are gone a veto cannot be passed (one
   run stayed on challenge 4 for 10 attempts). That is real player behaviour, not a tool bug.

## Results after authoring, the new pipeline pillar and proposal 7

`SIM_SEEDS=4`. Pipeline is now the share of each challenge's damage that was won back, relations
the mean mood over the run with the last counted twice, four rooms have a PASS.

| Profile | Grade | Overall | Pipeline | Relations | Intel | Decisions |
|---|---|---|---|---|---|---|
| flawless | A A A A | 0.73 | 0.61 | 0.55 | 1.00 | 0.90 |
| perfect (best for the room) | B B B B | 0.68 | 0.34 | 0.57 | 1.00 | 1.00 |
| medium | C C C C | 0.47-0.54 | 0.2-0.4 | 0.51-0.55 | 0.63-0.74 | 0.60 |
| bad | E D E D | 0.24-0.35 | 0.1-0.41 | 0.29-0.40 | 0.33-0.47 | 0.15 |

- Grades now track play quality: A, B, C, D/E. The room-versus-pipeline compromise is worth a full
  band (perfect B, flawless A): the card the room likes best wins back a third of the damage, the
  grade-optimal card three fifths.
- Flawless sits on the A line (0.73 against 0.72). S needs 0.85 and the pipeline pillar is the cap:
  a challenge's own consequences (antipatterns, baseline sweeps) land after the card and cannot be
  predicted by the search, so the grade-optimal card still scores 0 on some challenges.
- A flawless run now ends with no grudges at all, since four of five rooms are passed cleanly.
- Earlier tables below are kept as the history of how each change moved the grade.

## Results after proposals 1 to 6 and 8

`SIM_SEEDS=4`, same harness. Grudge penalty is now 0.03 per distinct grudge, recovery 0.25.

| Profile | Grade | Overall | Pipeline | Relations | Intel | Decisions |
|---|---|---|---|---|---|---|
| flawless | A A A A | 0.81 | 0.87 | 0.49 | 1.00 | 1.00 |
| perfect (best room acceptance) | B B B B | 0.70 | 0.68 | 0.32 | 1.00 | 1.00 |
| medium | B B B B | 0.65-0.69 | 0.78-0.82 | 0.29-0.39 | 0.63-0.74 | 0.90 |
| bad | D D D C | 0.37-0.46 | 0.63-0.82 | 0.18-0.29 | 0.33-0.47 | 0.25 |

Read-out:

- **Flawless beats perfect by 0.10.** Same intel and the same decisions, so the whole gap is the
  room-versus-pipeline compromise: the room's favourite card leaves pipeline health at 0.68, the
  grade-optimal card at 0.87, and relations follow (0.32 vs 0.49). Playing for the room alone is
  a B.
- **A is reachable, S is not.** The best mood the flawless run ends with is neutral (0.51), so
  relations cannot pass about 0.5, and S needs about 0.6 there. A PASS is what lifts mood, and
  flawless got one in five rooms. S therefore waits on authoring PASS into the six par-SOFT rooms
  (the blockers are listed under R2).
- **Bad is still D, not E.** The bad profile still builds a healthy pipeline (pushed-through cards
  still apply) and still collects some intel. What separates it is intel (0.4 vs 1.0) and decisions
  (0.25 vs 1.0), 40% of the grade. To reach E, pipeline health has to depend more on what the
  player did and less on what happened to them, or the bands move; both are tuning decisions, not
  bugs.
- **Medium sits too close to perfect.** The same two pillars (intel, decisions) are all that
  differs, and decisions are par-adjusted so a soft pass in a par-soft room is full marks.
- **No more soft-locks.** No run stopped early; the bad profile tables a room once its points are
  spent.
- **Not a free lunch:** the seed graph's stage health is 0.93 before any challenge has broken
  anything, so the pipeline pillar reads damage taken and repaired during the run, not progress
  from zero.

## Authoring: rooms with a PASS

A room had no PASS for one of two reasons, both found with `tests/sim_near.py` and
`tests/sim_stances.py` (cards that cross no boundary, and every stance with whether the player may
touch its target):

1. **Stances on targets the room does not offer.** A room only lets the player touch its own
   stage's components and the edges between them, but boundaries and drivers named cross-stage
   edges (`e.contracts_ingest`, `e.acceptance_eval`, `e.registry_cicd`, `e.alert_retrain`...).
   A boundary nobody can satisfy is violated for good, a driver nobody can act on is unmet for good.
2. **More boundaries than the 3-change cap can pay for.** A governance raise on a component that is
   not implemented yet costs two changes (implement, then govern).

What was changed, per room (requirement, offline artifact, wrong descriptions and objection text
all rewritten to match; no em dashes):

| Room | Before | After | The clean card |
|---|---|---|---|
| 114 Loyalty consent gap | two low-power boundaries on cross-stage edges | Emilia: data contracts check must keep a person in the loop (automation at most 2); Ruth: acceptance criteria checked automatically (at least 2); Emilia's concession now concerns the risk review | data contracts automation 2 and governance 3, acceptance criteria automation 2 |
| 115 Loyalty data deployment block | Reuben's driver, Ruth's driver and most of Alex's driver on cross-stage edges | all three retargeted inside the stage (CI/CD governance, orchestration to serving) | CI/CD governance 3, with or without orchestration to serving automation 3 |
| 119 Silent forecast failure | Monica's driver on a cross-stage edge, Ruth's second driver too far from the card | Monica: drift monitor to alerting; Ruth: rollback governance (shared with Reuben's boundary) | rollback automation 2 and governance 3, drift to alerting automation 2 |
| 120 Silent ingestion failure | Reuben's boundary needed two changes on versioning | Reuben's boundary is now validation governance, which the validation automation change doubles as the implementation step for | validation automation 3 and governance 3, ingest to validation governance 3 |

Not authored: **116 Nightly window miss** and **118 Shadow deployment contract** are `hard`
conflicts. A hard conflict is defined as the losing side holding a Boundary on the same dimension
(Ruth wants validation automated, Dave's boundary caps it at manual), so no card pleases both and
a PASS would contradict what the challenge is. They keep par `SOFT_PASS`. Softening them (the
loser's boundary becomes a trade-off) is a design change to the dilemma itself, not an authoring
fix.

The content content_gen ledger (`game-api/tools/content_gen/work/out`) was not updated, as for
any hand edit (see `content-gen-ledger-drift.md`): re-running `assemble` would revert these rooms.

## Root causes found (second round)

Measured with `tests/sim_grades.py` (final room mood, run-by-run) and `tests/sim_ceiling.py` (best
card per room at the seed state, 3 vs 4 changes; no DB). Rooms start from the seed state with
neutral emotions, so a ceiling is an upper bound for that room, not a prediction.

**R1. Mood is scored with the wrong sign on two dimensions.** `emotions_norm` (pitch buy-in,
`session.py:744`) and the results pillar and trajectory (`compute.py:164`, `:604`) take a plain mean
of 7 dimensions, but for `stress` and `perceived_risk` lower is better. Good play lowers them, which
lowers the mean, so the number barely moves with play. Final room mood, plain vs sign-corrected:

| Profile | plain mean | sign-corrected |
|---|---|---|
| perfect | 0.50-0.52 | 0.33-0.41 |
| medium | 0.53-0.55 | 0.37-0.61 |
| bad | 0.37-0.41 | 0.22-0.41 |

Corrected, perfect-vs-bad is about 0.38 vs 0.25 instead of 0.51 vs 0.40: a wider gap. It also
shows perfect play ends with an *unhappy* room (R3).

**R2. A PASS does not exist in half the rooms.** Cards of up to 3 changes, thousands sampled per
room: PASS exists in 110, 112, 117, 111 only; 114, 115, 116, 118, 119 and (at 3 changes) 120 have
none, whatever the player does. So perfect play is SOFT_PASS in 4 of 5 challenges (decision quality
0.6, never higher), and each soft pass writes a grudge. "Perfect" and "no grudges" are
incompatible by content. The `prefer="best"` search (below) picks identical outcomes, which
confirms it is the rooms, not the search.

**R3. Conflict by design plus no recovery leaves the final room unhappy.** Every card pleases some
stakeholders at the cost of others, vetoed commits and breakers add maluses (`VETO_MALUS`, breaker
-0.40), and nothing ever repairs a mood. The pillar reads the final snapshot, so the earlier a
stakeholder was upset the worse it looks.

**R4. Grudges are charged twice.** A grudge already costs in-game (`fire_grudges`: a component is
degraded, a world event comes early, or an extra objection), which feeds pipeline health. The
pillar then docks 0.08 per grudge on top.

**R5. The stuck bad run is a real soft-lock, not a tool bug.** Run bad/1 stopped at challenge 118
with 0 Escalation Points. Its room: Alex 0.13, Ruth 0.21, Emilia 0.24 mean mood (three deliberate
vetoes, three breakers at -0.40, wrong tags adding `MISCLASSIFICATION_MALUS`), 14 of the room's
intel notes found. Best card the search could build: a VETO at lowest buy-in 0.397, a hair under
the 0.4 line. Humans have two exits from a veto: revise or Push It Through (3 per game). The
pipeline has a `STALEMATE` outcome with `stalemate_ops`, and a comment names a
`handle_pitch_concede`, but no handler or button reaches it. With no points left and an
unwinnable room the challenge never ends. Emotions carry across challenges, so a bad first half
makes a later room unwinnable.

**R6. Four changes per card is not worth it.** 4 instead of 3 adds a PASS to 120 (1 card in 1961)
and more of them in 110; every other room is unchanged. Not a lever.

**R7. The "perfect" tool picked a random acceptable card.** Now `prefer="best"`: the best outcome,
then the highest lowest buy-in. Same outcomes, but pipeline health fell (0.78-0.82 to 0.65-0.68)
because the best card for the room is not the best card for the system. Real tension, and the
reason a perfect run is not simply "max buy-in" (see D9).

## Design proposals

Status of each: **1** mood sign, built. **2** PASS in every room, gate built and PASS authored in
114, 115, 119 and 120; 116 and 118 stay par SOFT_PASS because they are hard conflicts. **3** par,
built. **4** make amends, built. **5** time heals, built. **6** Table It, built. **7** relations
from the whole run, built. **8** room hint in the veto dialog, built.

Ordered by value for the effort. Each says what the player feels, not only what changes.

1. **Fix the mood sign (R1).** One shared `valence_mean(emotions)` used by buy-in, the pillar and
   the trajectory. Re-run the ceiling experiment afterwards: buy-in thresholds were tuned against
   the old mean, so rooms get harder or easier and the 0.4 / 0.3 lines may need a nudge.
2. **A PASS in every room (R2).** Content gate in the style of `reachable_templates`: for every
   challenge, a card of at most 3 changes exists that the seed-state room passes. 5 of 10 fail
   today; fix them by authoring (move a boundary, relax one conflicting driver, add the intel that
   unlocks the elegant answer). A PASS should be the designed reward for reading the room, and
   SOFT_PASS the honest compromise.
3. **Grade against par, not against 1.0 (R2).** If a room has no PASS, a SOFT_PASS is the best
   outcome and should score 1.0 for it. Needs per-challenge par data; after proposal 2 this is a
   fallback for the rooms that stay hard on purpose.
4. **Make amends (R3, R4).** A grudge is cleared early when that stakeholder's buy-in in the next
   pitch clears their threshold ("you came back to it"). Gives the player something to do about a
   soft pass, turns the grudge from a punishment into a short story, and replaces the flat pillar
   penalty with a real mechanic. Pillar penalty drops to 0.03 per grudge, or goes.
5. **Time heals, a little (R3, R5).** Between challenges every emotion drifts 25% back toward 0.5.
   Early mistakes stop dominating the snapshot, and a bad first half no longer guarantees an
   unwinnable fourth room.
6. **An exit that costs (R5).** Wire the existing `STALEMATE` path as "Table it": the challenge
   ends, the stalemate world event fires, every low-power stakeholder gets a grudge, decision
   quality scores it 0. No soft-lock, and no free pass either.
7. **Pillar from the whole run, not the last frame (R3).** Relations = mean of the per-challenge
   weighted mood, with the final value weighted double. A hard first challenge that the player
   repaired reads as a recovery, not as a failure.
8. **Escalation as a decision (R5).** Show the room's best-case outcome in the veto dialog ("no
   card can pass this room") so spending a point is a choice with information. Keep 3 per game.

What this does to the grades, honestly: proposals 2 and 3 lift decision quality for perfect play
from 0.6 to about 1.0 (+0.08 overall), proposals 1, 4, 5 and 7 should lift relations from about
0.1 to about 0.5 (+0.12). Perfect then lands near 0.6 + 0.20 = 0.8, an A, and S needs pipeline
health above about 0.9 as well, which only a genuinely flawless run gets. Bad stays D or E, since
nothing here helps wrong tags and vetoes. All of that is an estimate until the simulation is re-run
on each change; the order above is also the order to measure in. The scale has no F: the lowest
band is E.

## Decisions

**D1. Grudge penalty per distinct grudge.** Done (`service._distinct_fired_grudges`). Written and
fired events are matched per stakeholder, so a grudge that fires twice costs once and one that
never fired costs nothing. Epilogue facts get the same number.

**D2. Playtest profiles.** Done. The tool takes `payload.profile`, default perfect, so nothing
changes for existing callers. The 3 Escalation Points are respected: a "bad" profile falls back to
a soft pass once they are spent. Still to do: a profile picker next to the playtest buttons.

**D3. Pipeline health counts played stages only.** A stage counts as reached once its phase is at
or below the latest phase played (`graph_state_view._stage_reached`), so skipping phase 2 and
playing phase 3 would score stage 2 at its starting health. `service._graph_view` should pass the
set of played phase ids, and stages of unplayed phases go out of the average exactly as locked
stages do now. Gate 7 follows the same rule: `_gate7_target_rows` must only read targets in played
stages, or every skipped run drifts to 7a (too much unrealized scope).

**D4. Run subset.** A campaign flag `challenges_per_run` (null = all five phases, today's
behaviour), same pattern as `intro_phase_enabled`. In `next_challenge`, phases outside the run's
subset count as done.

- The subset is derived, not stored: `stable_rank(f"{user_id}:{run}", f"phase:{id}")` within
  strata, so it is reproducible and needs no schema change beyond the flag.
- **Stratified draw**: for 3, one phase from {1, 2}, one from {3}, one from {4, 5}; for 2, one
  early and one late. This keeps every run covering the front, middle and back of the pipeline, so
  two players' grades stay comparable.
- Every phase has a fallback template, so any phase can be dealt on its own.

**D5. Next iteration prefers what was skipped.** The played set already spans runs and the phase
quota counts it, so a second run naturally deals phases not yet played. Make it explicit and
test it: a next iteration schedules unplayed phases first. *Interpretation to confirm*: the
request said "non-skipped steps"; this plan reads it as "the steps not yet played". Also verify
what a next iteration does once all five phases have been played (the quota check suggests it
deals nothing).

**D6. Relations pillar needs a decision.** The sign fix (R1) comes first and is a bug, not a tuning
choice. Then, options to be measured with the simulation, not argued:

- (a) lower `GRUDGE_PENALTY` (0.08 to about 0.04);
- (b) cap the total penalty at half of the mood score so one pillar cannot be wiped out;
- (c) rescale mood (0.5 is neutral, so score `(mood - 0.5) * 2` plus a floor) so good play can show;
- (d) change the card search so a PASS is found more often (a game-design question: is a clean
  PASS meant to be rare?).

Acceptance target after D6: perfect A or S, medium B or C, bad D or E, with the spread stable
across seeds. Bands change only after that.

**D8. Four changes per card: no.** See R6.

**D9. "Perfect" means the best grade, not the best buy-in.** `prefer="best"` ranks by outcome and
buy-in only. A fuller version would also score each candidate by the pipeline health it leaves
behind. Do it only if the simulation is needed to prove an S is reachable.

**D7. Short runs and noise.** Decision quality over 2-3 outcomes moves in steps of 0.33-0.5, so one
veto swings the grade a band. Accept it, or weight decision quality down for short runs. Decide
after the subset simulation (below), not before.

## Work

1. Decide D6, apply, re-run the simulation until the acceptance target holds.
2. D3: played-phase filter in `_graph_view` and `_gate7_target_rows`, with tests on hand-built
   stage lists (`test_results_compute.py`).
3. D4: campaign flag + migration, `next_challenge` subset filter, stratified draw, a test that two
   runs for one player get the same subset and that every subset still reaches the end screen.
4. D5: scheduler preference and test; check the all-played case.
5. Re-run the simulation with `challenges_per_run = 3` and 2. The grade spread must match the
   full-length spread within one band. If not, revisit D7.
6. UI and admin: the "Challenge n/N" counter and `admin_service.py:437` (sums the quota of every
   phase) must read the run's subset; update `docs/gameplay-flow.md` (step 7, "Next").
7. Playtest UI: profile picker for the skip and auto-card buttons.

## Not in scope

- The two questionnaires and the demo phase are the other big time costs. They do not touch the
  grade (the demo is already excluded from results), but are separate decisions.
- Rebalancing individual challenges.
