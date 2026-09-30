# Evaluation methodology improvements

Planning only. Reviewer feedback: learning test not validated, n=13, no comparison group,
in-game metric increases don't show learning.

Constraints: 1 week, no survey-design expert (1-2 MLOps domain experts available for review),
eval runs in an MLOps class (~20+ students), no resources for a control condition beyond the app
itself. n=13 is out of scope for this plan.

## Current state

`gameConfig/EvaluationQuestions.json`: 7 MC knowledge questions, Bloom-tagged, asked pre and post
verbatim, no feedback shown on the pre-test. Plus demographics, persona Likerts, full SUS.
Scored as percent-correct via `admin_service.calculate_{intro,outro}_percentage`.

Design: one-group pretest-posttest, no control. Matches the reviewer's description.

Item content: mostly generic MLOps trivia (concept drift, reproducibility, pipeline jungles); only
2/7 touch stakeholder conflict, and those are still recognition items, not judgment/transfer
items. The game's actual target is stakeholder-perspective/trade-off reasoning, not trivia recall
— that mismatch is the real "not validated" problem, separate from psychometric pedigree.

`results-screen.md` (D3) will surface the existing intro→outro delta by Bloom tag in a Results
screen. Doesn't fix the instrument or design; the taxonomy breakdown is worth reusing.

## Two things to fix

**1. Construct validity.** Test measures trivia recall, not the skill the game trains. Fix:
split into two constructs, scored separately:
- Declarative knowledge — trim today's 7 items to ~4-5, keep as context.
- Perspective-taking / trade-off judgment — new performance items (below).

**2. No comparison group.** No pretest feedback rules out "pretest taught the answer," but not
the plain testing effect (asking twice inflates score regardless of the game). Only a comparison
arm rules that out — but any design giving a subset of students different/lesser material (e.g. a
static reading in place of the game) is hard to justify to students or an instructor in a real
class, and a waitlist/crossover design (stagger who plays first, compare pre→interim-no-game vs.
pre→post-with-game) is a fairer alternative but still adds real logistics on a one-week clock.

- **Decision: no comparison group this round.** State it plainly as a limitation in the writeup
  rather than attempt a design that isn't feasible to run well in the time available. Everything
  else in this plan (construct validity, Kirkpatrick scoping) is what's left to make the claim as
  strong as it can be without one.
- Waitlist/crossover noted as the fairer option for a future iteration, if there's ever budget to
  run it properly.

## Our three ideas, evaluated

| Idea | Fixes | Doesn't fix |
|---|---|---|
| Align wording to game content | Face validity | Construct validity, no comparison group |
| Match-to-role puzzle | Recall → performance measure of perspective-taking | Doesn't attribute the change to the game vs. testing effect (no comparison group) |
| Trade-off question (must be novel, not a restated challenge) | Near-transfer validity | Same attribution gap; risk of testing memorization if not novel |
| Check pre/post diff alone | Nothing new | This *is* the critique |

Match-to-role and trade-off items should be built together — same construct (perspective-taking/
trade-off judgment), two angles: recognizing a stance vs. reasoning through a fresh conflict.

## Kirkpatrick framing (scope the claim, don't overclaim)

- **Reaction** — SUS + persona ratings. Already fine, keep as-is, label as Reaction not learning.
- **Learning** — the two-construct instrument is a real improvement over today's test, but without
  a comparison group the Learning claim stays qualified: "scores changed pre→post, on an
  instrument aligned to what the game teaches" rather than "the game caused this change." Say that
  explicitly rather than imply causal attribution the design can't support. The quasi-experimental
  checks below are what push this claim past a bare pre/post number.
- **Behavior / Impact** — out of scope. State this explicitly in the writeup so it isn't implied.

## Strengthening the Learning claim without a comparison group

Without a control arm, no single number proves attribution. But several quasi-experimental checks,
run on data already being collected, build a case that survives scrutiny better than the raw
pre/post delta alone. Pre-registered as predictions (not post-hoc pattern-hunting) wherever a
prediction is possible:

1. **Differential item gain (pre-registered prediction).** Gains should be larger on the
   perspective-taking/trade-off items than on the generic declarative items. Test-retest inflation
   should hit both roughly equally; a content-specific game should move the items closest to what
   it teaches more than the generic ones.
2. **Baseline moderation (pre-registered prediction).** Students who self-report low MLOps
   familiarity should gain more than those who self-report high familiarity (ceiling effect for
   the latter). A flat test-retest artifact wouldn't care about baseline; real learning
   concentrated in novices would produce this pattern.
3. **Dose-response within the game.** Correlate each player's knowledge-test delta against how much
   they engaged with stakeholder mechanics that session (dossier depth, trade-off decisions made,
   distinct stakeholders engaged — already in `GameEventRow`/`GraphOpLog`). No new instrumentation;
   an analysis pass on existing logs.
4. **Convergent validity with in-game decision quality.** Check whether players whose
   perspective-taking score improved more also show better late-session decision quality (the
   `results-screen.md` decision-quality pillar). Two independently-collected measures agreeing is
   evidence distinct from the "metrics improve across challenges" argument already ruled out
   (that one was purely within-game and confounded with UI fluency; this correlates it against the
   external pre/post measure).
5. **Reframe the testing effect rather than fight it.** Retrieval practice (the pre-test itself) is
   an established learning mechanism, not purely a confound. Claim "this game-based session,
   including retrieval practice from repeated testing, produced a measurable gain" — narrower than
   "the game alone did this," but honest and still a real learning claim.
6. **Spiral/repeated-measures persistence.** If the `run_index` knowledge-delta series keeps moving
   across a student's later playthroughs rather than flattening immediately, that's harder to
   explain as a one-off testing effect. Likely low-n in this round (few students will replay) —
   report as suggestive/supplementary, not load-bearing.
7. **Qualitative triangulation.** Cite the existing (externally-analyzed) free-text "what did you
   learn" responses alongside the quantitative delta.

None of these substitutes for a true control group. Together, especially (1) and (2) as
falsifiable pre-registered predictions, they're what makes the Learning claim more than "scores
went up and we're hoping that means something."

## Review pipeline (before data collection)

Human expert time is scarce, so cheap automated passes filter/harden the material first, and the
scarce human time is spent only on what survives.

1. **Adversarial item pre-filter** — context-less subagent(s), fresh per item, no game context:
   - *Guessability probe*: pick an answer using surface cues only (keyword matching, "sounds most
     textbook-correct"). A correct guess with no real reasoning flags the same "keyword matching,
     not detective work" failure the earlier playtest feedback called out on intel tagging —
     rewrite that item.
   - *Ambiguity critique*: argue for each wrong option as if defensible; flag items with more than
     one plausible correct reading.
2. **Academic serious-games reviewer pass** — a separate context-less subagent, given only the
   assembled protocol spec (instrument, construct mapping, Kirkpatrick framing, stated limitations
   including no comparison group), no prior conversation context, prompted to review it as a
   critical serious-games/education-
   research peer reviewer would (the same posture as the original feedback that started this
   plan). Purpose: catch design-level gaps — validity threats, scope overclaims, missing
   controls — before the human expert pass, which is better spent on domain content than on
   methodology it isn't the specialty of MLOps experts to catch.
3. **Expert content-validity pass, not a psychometric pilot**: 1-2 MLOps experts take the
   instrument themselves and review each item for one defensible answer and correct construct
   tagging, on the item set that already survived steps 1-2. Half a day, not a study.

Neither AI pass substitutes for the expert pass in the writeup — they're pre-filters that make
the experts' limited time go further, not a claim of independent validation.

**Status**: steps 1-2 run, on the round-1 item drafts. Guessability probe found all 9 original
items solvable via pure surface cues; ambiguity critique flagged one item (R5) as genuinely
ambiguous; academic reviewer pass confirmed the overall framing but flagged several cheap fixes
(expand the single-item familiarity self-report, label correlational checks as exploratory, don't
oversell check 7 as triangulation). All folded into a rewritten item set — see
[eval-instrument-spec.md](eval-instrument-spec.md) for the revision log and final wording. Step 3
(expert content-validity pass, 1-2 MLOps experts) is still outstanding.

## Other decisions

- **Pre-register item→construct mapping and predictions 1-2 above** before data collection (a
  dated table/section in this doc or a commit) — blocks "scoring/hypotheses decided after seeing
  results" concerns.
- **Free-text reflection**: already analyzed elsewhere, outside this repo — cite it, don't redo it.
- **Spiral hook**: `run_index` chain already gives replaying players a second outro datapoint.
  One extra calculation + a `run_index > 1` filter, riding on existing results-screen work.
  Report as supplementary, not load-bearing.
- **Sample size**: report honestly with effect sizes, don't chase significance.

## Locked-in scope for this round

- Two-construct instrument (trimmed declarative + match-to-role + novel trade-off), pre-registered.
- No comparison group — stated explicitly as a limitation, not worked around.
- Kirkpatrick-scoped writeup (Reaction claimed as Reaction; Learning claimed but qualified as
  non-causal without a comparison group; Behavior/Impact explicitly out of scope).
- Seven quasi-experimental strengthening checks (differential item gain, baseline moderation,
  dose-response, convergent validity with decision quality, testing-effect reframe, spiral
  persistence, qualitative triangulation) — first two pre-registered as predictions.
- Review pipeline: adversarial item pre-filter → academic serious-games reviewer pass → expert
  content-validity pass (1-2 reviewers), in that order.
- Spiral-replay delta series as supplementary (low-n expected, part of check 6 above).

## Next step

Implemented: `gameConfig/EvaluationQuestions.json` carries the final item set (construct-tagged),
`Question`/`QuestionFactory` gained a `construct` field, and `admin_service` gained
`calculate_{intro,outro}_percentage_by_construct` for the differential-gain check. Full detail and
revision log in [eval-instrument-spec.md](eval-instrument-spec.md). Remaining before the session:
the expert content-validity pass (step 3 of the review pipeline), and verifying the backend
changes against the test suite once Docker is available.
