# Challenge & Scheduling Rework

Builds on [00-plan.md](00-plan.md) (§5, §10–§12: challenges need to offer more than one viable
path). This document is about a different axis of the same complaint: not "does one challenge
offer enough distinct solutions", but "does a full playthrough offer enough distinct
challenges, paced correctly, with the parts of MLOps that aren't conflicts modeled at all."

## 1. Problem statement

### 1.1 One challenge per phase, chosen from two candidates

Checked `gameConfig/GameProgression.json` directly. Every phase sets
`challenges_per_phase: 1` and authors exactly 2 candidate challenge templates (phase 0 has only
1). `Phase.challenge_quota` (`domain/Phase.py:29-31`) resolves to that 1, and
`scheduler.py`'s eligibility check (`challenge.preconditions`/`excluded_if` evaluated against the
graph) picks one of the phase's templates by `priority` (`Challenge.priority`, "higher wins among
eligible templates") with one of them marked `fallback: true` (picked when nothing else
qualifies). A full playthrough is therefore **exactly 6 challenges** — one per phase, phase 0
through 5 — chosen from a pool of 1–2 candidates each.

### 1.2 `on_exit_ops` exists and is authored nowhere

`Challenge.on_exit_ops` (`domain/Challenge.py:40`, *"World event ops fired in the simulation that
closes the challenge"*) is applied unconditionally by `simulate()` on every non-stalemate outcome
(`pipeline.py:666`) — including a lost pitch, not only a clean win. Checked all 11 authored
challenges: **`on_exit_ops` is an empty list on every single one.** The hook that would let
"quiet, uncontested progress" happen after a challenge closes already exists in the engine and has
never been used.

### 1.3 Consequence: only the ~6 things a stakeholder fights about ever move

Since nothing but a challenge's own card changes the graph (no `on_exit_ops`, no phase-level
equivalent), the 28 components and 31 edges the 6 challenges *don't* directly touch never move
from their `initial_level`. The graph a player ends a playthrough with is not "the org's whole
MLOps maturity as of six hard-fought decisions" — it's "six components/edges the content authors
happened to write conflicts about, everything else frozen at its starting value." That is a
structural gap, not a balancing one: **the game currently has no representation at all for the
large part of real MLOps work that best practice handles without a fight** (a team just adopts
data versioning, or wires up basic alerting, because it's obviously correct — no stakeholder
debate needed). The user's framing is exactly right: challenges can only ever model the conflict
part of MLOps, so the non-conflict part needs a different mechanism, not a 7th/8th/9th challenge
per phase invented just to touch more targets.

### 1.4 No continuation after phase 5

There is no mechanic for "play another pass through the lifecycle." `run_index`
(`infrastructure/database/run_scope.py`, `current_run_index`) is a full restart — a new run gets a
fresh persona draw and a fresh graph, not a continuation of the one just finished.
`challenge_loop_index` (`models.py:106,176`) is an *intra-challenge* step counter (gather → pitch →
simulate), unrelated to replaying the lifecycle. `gameConfig/EndgameEpilogue.json` already writes
in the voice of "this cycle closes" (`"spiral_closing"` key) — the fiction already gestures at a
spiral/iterative model (`MLOpsGlossary.json`'s own `spiral_model` glossary entry), but nothing in
the engine acts on it.

## 2. Design principle

**Challenges model conflict. A separate, lighter mechanism models everything else.** Concretely,
each phase gets two tiers:

- **Challenge tier** (unchanged mechanism, recalibrated content): 1–2 dynamically scheduled
  challenges per phase, exactly the existing `preconditions`/`priority`/`fallback` scheduler in
  `scheduler.py` — nothing here needs new engineering, only more/better authored templates (§4).
- **Progression tier** (new content convention, no new engine mechanism): every challenge template
  in a phase carries a shared, authored **stage baseline sweep** in its `on_exit_ops` — a fixed
  batch of one-step `raise_to`/`set_attr` ops (`source_kind: "world_event"`) that nudge the
  stage's *other*, conflict-untouched components/edges from `absent`/`broken` up to a modest,
  believable baseline (proposed default: `automation=manual`, `governance=partial_1`, capped by
  each target's own ceiling from `00-plan.md` §3). This is the "best practice happens quietly"
  mechanism the user asked for, and it costs zero new domain-model surface — it's `on_exit_ops`,
  finally used for what it was already built for.

Why on `on_exit_ops` and not a new `Phase`-level hook: today exactly one challenge plays per
phase, so that challenge's `on_exit_ops` already *is* the phase-closing moment. If a phase moves to
`challenges_per_phase: 2` (§4), the sweep must be authored identically into *every* candidate
template of that phase (not just the one expected to run second) so it fires exactly once
regardless of which the scheduler picks — a content-authoring rule, not new code. A dedicated
`Phase.on_complete_ops` field is a reasonable fallback if this duplication turns out to be
error-prone in practice, but isn't needed to start.

## 3. Time budget

No recorded playtest timing exists (checked `docs/plans/playtest-notes.md`) — the numbers below
are an explicit assumption to validate, not a measurement. Working assumption: **6–8 minutes per
challenge** (intel gathering + pitch debate + simulation review), which is what today's 1
challenge/phase × 6 phases already roughly targets (~36–48 minutes). That leaves headroom to
promote 1–2 phases to `challenges_per_phase: 2` (§4) and still land at 50–60 minutes total —
matching "1 to at most 2 challenges per phase, max. one hour" directly, without needing to touch
every phase uniformly.

## 4. Challenge tier: more candidates, not more picks per phase

The lever for "more viable paths through a playthrough" at the macro level is **candidate
breadth**, not challenges-played count: `priority`/`fallback` already let the scheduler choose
among more than 2 templates per phase for free. Recommendation:

- Keep `challenges_per_phase` at 1 for phases where the graph state realistically only produces
  one live conflict at a time (thematically thin phases — judge per phase, not uniformly).
- Raise `challenges_per_phase` to 2 for phases with enough authored template breadth to support
  two *different* conflicts without the second feeling bolted on (a content decision per phase,
  not a global rule) — this is the concrete lever for "1 to max. 2 per phase."
- Author 3–4 candidate templates per phase instead of today's 2, with `preconditions` that key off
  the automation/governance split from `00-plan.md` (e.g. one template's precondition favors a
  graph that's leaned automation-heavy so far, another favors governance-heavy) — so *which*
  conflict a given playthrough sees already reflects the player's own prior choices, which is a
  second, independent source of "different paths" alongside the per-challenge option work in
  `00-plan.md` §5/§10–§12. No scheduler change needed — this is exactly what `priority` +
  `preconditions` already support.

## 5. Continuation: already built — this section was wrong

**Correction (superseded the recommendation below):** phases 6–10 as new authored content is not
needed and was not built. Checked `results_service/` and `game_handler.py`'s `handle_new_run`,
which this document had not looked at when it was first written: the "second pass" mechanic
already exists in full, under the name **spiral**, and is exactly "looping phase ids 1–5 again"
— the "heavier alternative" below, except it long predates this rework and cost nothing here:

- `infrastructure/database/run_scope.py`: `run_index`/`seeded_from_run` chain runs (`run_chain`,
  `parent_run`). A spiral run's rows carry `seeded_from_run = <previous run>`; the live game reads
  the whole chain, so the player returns to phase 0 (`game_progress_index=2`, straight into play,
  no re-briefing) with the graph, dossier, personas and grudges from the run it followed intact.
- `game_handler.handle_new_run(mode="fresh"|"spiral")`: the only player-facing switch. `fresh`
  starts clean; `spiral` sets `seeded_from_run`. Neither mode deletes anything (`test_new_run.py`).
- `PhaseFactory.get_phases()` is a fixed, single list of phases 0–5 — a spiral run walks the exact
  same phases and the exact same scheduler (`preconditions`/`priority`/`fallback`) again. Which
  candidate template comes up a second time around already depends on the (now-advanced) graph
  state for free; §4's "more candidate templates per phase" is the real lever for making a second
  pass feel different, not new phases.
- `results_service/compute.py`'s `pipeline_health` already special-cases a spiral run (scores
  improvement over the inherited baseline, not the absolute), and `epilogue_for(..., spiral=...)`
  already reads as an iteration closing rather than a finale.

**What genuinely was missing, and is now built:** the GDD's Gate 7 (`GDD.txt`, "CAPTURE Gate 7")
5-way outcome classification (7a–7e) was not computed anywhere — `handle_new_run` let a player
pick `fresh` or `spiral` freely regardless of how the run went. `results_service/compute.py` now
computes `metric_compliance`, `change_scope` and `drift_magnitude` alongside the existing four
pillars, maps all of it plus `stakeholder_relations` to a `Gate7Result` (`gate7_outcome`), and
`build_results` reports it as the payload's `"gate7"` field. `handle_new_run` calls it before
honoring `mode="spiral"` and refuses with `GATE7_BLOCKED` when the outcome (7a/7e) doesn't allow
it — a bad run can still restart `fresh`, just not build further on what it left behind. Thresholds
(`GATE7_VIABILITY_THRESHOLD` etc.) are explicit, tunable defaults, not a claim of one correct cut —
same posture as `DEFAULT_GRADE_BANDS`. Tests: `test_results_compute.py`'s Gate 7 section (pure
threshold math) and `test_new_run.py`'s Gate 7 gating section (the refusal/mode wiring).

## 6. Interaction with 00-plan.md

- The baseline sweep (§2) must respect every ceiling and invariant from `00-plan.md`: never target
  `broken` (§2.1 there), never exceed a target's `allowed_automation`/`allowed_governance`, and —
  since it's an automated `world_event` op, not a player action — it is exactly the kind of
  background move the `broken`-is-backend-only rule was written for (§6, decision 5 there).
- A spiral run's *second pass* through phases 1–5 is where the completability guarantee
  (00-plan.md §12) matters most: a harder, post-baseline-sweep starting state raises the floor for
  what counts as "worst case" for that pass's eligible templates. §12.4-style checks authored
  against a fresh graph don't automatically cover a template whose `preconditions` only become
  eligible after a sweep has already run once — worth another completability pass once §4's
  extra candidate templates are authored, not before.

## 7. Codebase impact

- Built (this rework): `domain/Challenge.py` (`baseline_sweep_ops`), `pipeline.py` (sweep applied
  and filtered against what the card/veto already touched), `gameConfig/GameProgression.json`
  (the sweep content itself), `results_service/compute.py` + `service.py` (Gate 7:
  `metric_compliance`/`change_scope`/`drift_magnitude`/`gate7_outcome`, reported as `"gate7"`),
  `game_handler.handle_new_run` (refuses `mode="spiral"` on a 7a/7e outcome).
- Not built, still open: `gameConfig/GameProgression.json` additional candidate templates per
  phase and `challenges_per_phase: 2` on the phases chosen in §4 — the real lever for a spiral
  run's second pass through a phase feeling different rather than repeating the first pass's
  conflict verbatim.
- No changes needed in `domain/Phase.py` or `scheduler.py` for §4 — it is entirely a
  content-authoring convention on top of the existing scheduler.

## 8. Open questions

1. ~~Does the game have a continuation mechanic past phase 5?~~ Resolved: yes, already built
   (`run_scope.py`, `handle_new_run`'s `spiral` mode) — see the correction in §5.
2. Which phases get `challenges_per_phase: 2` (§4) is a content call, not derivable from code —
   needs a decision per phase once template content is drafted.
3. Gate 7's thresholds (`GATE7_VIABILITY_THRESHOLD`, `GATE7_MAJOR_CHANGE_SCOPE`,
   `GATE7_LOW_DRIFT`/`GATE7_LOW_GAP`/`GATE7_HIGH_DRIFT` in `results_service/compute.py`) are
   untested against a real playthrough's numbers — explicit defaults to retune after a playtest,
   same posture as `DEFAULT_GRADE_BANDS`.
