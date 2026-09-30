# Evaluation instrument spec

Concrete spec per [eval-methodology-improvements.md](eval-methodology-improvements.md)'s "next
step." Grounded in actual game content: `GameStakeholders.json`, `RequirementObjects.json`,
`Briefing.json`, `Setting.json`.

**Status**: implemented in `gameConfig/EvaluationQuestions.json`, `Question`/`QuestionFactory`
(added `construct` field), and `admin_service.calculate_{intro,outro}_percentage_by_construct`.
Item text below is the *final* wording, after two rounds of revision driven by the review
pipeline (steps 1-2 of three; the expert content-validity pass, step 3, is still pending —
1-2 MLOps experts still need to look at this before the session).

**Round 1 → round 2 revisions, from the adversarial/academic passes:**
- *Guessability probe* found all 9 original items answerable via pure surface cues (role name
  stems used as their own tell-words; trade-off answers near-verbatim echoing the scenario text;
  absolutist distractor words like "always"/"fully"). Rewrote every match-to-role stance as a
  behavioral scenario instead of a self-description using the role's own keyword stem, and added
  an explicit contrast clause to each (e.g. R1 now contrasts "why the input changed" against "the
  forecast still looks reasonable" to separate Data Engineer from ML Engineer, rather than relying
  on the word "data"). Rewrote trade-off answer options to avoid restating scenario language and
  softened absolutist distractors.
- *Ambiguity critique* flagged R5 as genuinely ambiguous (conflated model-refinement and
  live-monitoring concerns, the latter arguably DevOps territory) — rewrote to focus only on
  model refinement, explicitly contrasted against unchanged input (Data Engineer's territory).
  Other minor-ambiguity items (R1-R3, R6, TO1, TO2) were tightened per the guessability fixes.
- *Academic reviewer pass* confirmed the Kirkpatrick-scoped, non-causal framing is the right move
  but warned it must hold in every results sentence, not just the limitations section; flagged
  that correlational checks (3, 4) must be labeled exploratory, not mechanism evidence; flagged
  check 7 (external qualitative triangulation) as weaker than described unless the qualitative
  sample is the same cohort — reframe as "citing related work," not triangulation, in the writeup;
  and recommended cheap fixes folded in below.
- **Cheap fixes folded in**: expanded the single MLOps-familiarity item into a 3-item
  composite (added two Likert self-efficacy items) for a sturdier baseline-moderation check;
  pre-test/post-test timestamps are already free (existing `GameProgression.time_stamp`
  per progress index) so no new capture needed for the reviewer's duration-logging suggestion.
  Per-item response distribution reporting and marking checks 3/4/6/7 explicitly exploratory are
  analysis/reporting instructions, not content changes — carried into §5 below.

## 1. Declarative knowledge (trimmed to 4, kept from today's 7)

Keep, unchanged: concept drift, ML vs MLOps, reproducibility, pipeline jungles.
Drop: pipeline dependencies (redundant with pipeline jungles), the two generic-role conflict
items ("Operational Engineer vs Business Manager", "Data Scientist vs MLOps Engineer") — those
used invented role names that don't match any actual persona, which is exactly the "align to game
content" problem. Superseded by §2, using the real personas.

## 2. Perspective-taking construct

### 2a. Match-to-role (paraphrased stance → which role said it)

Answer options are **role titles, not game nicknames** — players haven't met "Efficiency Emilia"
etc. at pretest, so nicknames are meaningless there and the construct we actually want
(associating a professional role with its priority) is more general anyway. Same 6 options every
item, order randomized per item:

*Data Engineer · ML Engineer/Data Scientist · Compliance & QA Architect · Business/Domain
Analyst · DevOps/MLOps Engineer · Production Engineer (App Reliability)*

Stances are written as **behavioral scenarios with an embedded contrast**, not self-descriptions
using the role's own keyword stem — the round-1 guessability probe found the original
self-description phrasing solvable by pure keyword matching (100% of items), so each stance now
pairs the target behavior against a specific, plausible runner-up behavior rather than naming the
role's own jargon:

| # | Stance | Correct role | Embedded contrast |
|---|---|---|---|
| R1 | "When last Tuesday's numbers don't line up with the week before, they want to know exactly why the input changed, not just whether the forecast at the end still looks reasonable." | Data Engineer | input provenance vs. ML Engineer's output-plausibility concern |
| R2 | "When someone proposes a new project, they want to know which number on the weekly report would actually move, and by how much, before agreeing to spend a cent on it." | Business/Domain Analyst | budget authority vs. a metric-moving concern any technical role could share |
| R3 | "After doing the same release steps by hand for the second time, they start quietly scripting it away, even though nothing has broken yet and nobody asked them to." | DevOps/MLOps Engineer | proactive automation vs. R6's reactive incident response |
| R4 | "Even after everyone agrees the results look good, they still want to see it walked through every rule that was written down months ago before anyone calls it done." | Compliance & QA Architect | formal sign-off vs. Data Engineer's input-quality concern |
| R5 | "Even when the input hasn't changed at all, they'll keep adjusting the model's settings until its mistakes stop looking so avoidable." | ML Engineer/Data Scientist | model-side tuning, explicitly not input-side (was ambiguous with DevOps monitoring pre-revision; monitoring clause removed) |
| R6 | "They're the one who finds out, mid-afternoon, that the thing which was fine this morning has quietly stopped working for actual users right now." | Production Engineer (App Reliability) | reactive, live, user-facing vs. R3's proactive, pre-emptive automation |

All 6 are in the shipped instrument (not trimmed to 4) — each now carries a distinguishing
contrast clause rather than relying on redundant coverage to average out guessability.

### 2b. Novel trade-off scenarios

Structurally modeled on real `trade_off` nodes (challenges 110-118: concedes/branch mechanic,
boundary-vs-preference distinction) but with changed surface details, not verbatim challenge
content — avoids rewarding "I remember this exact challenge" over the underlying skill.
Stakeholders are referred to **by role, not nickname**, same reasoning as §2a — a pretest-taker
can't reason about "Ruth and Reuben" before they've met them, and the transferable skill is
reasoning about role tensions, not recalling character names.

De-echoed from scenario wording and de-absolutized (dropped "always"/"fully"/"at all"-style
distractor tells the guessability probe flagged) relative to the round-1 draft.

**TO1 — speed vs. governance.**
*Scenario*: A regional distributor needs a restocking feature shipped before a two-day cold-chain
audit deadline. The production engineer wants to ship now with a manual sign-off instead of the
full automated acceptance-test suite. The compliance architect insists every release passes the
automated suite first, even if it slips the deadline.
*Question*: Which resolution best matches how such trade-offs are usually handled?
- **A. They agree on an interim check now, with the fuller process following shortly after.**
  (correct — matches the `concedes` mechanic: negotiated, partial, explicit)
- B. They wait for the full process to finish, even past the agreed date.
- C. They go ahead without raising it with the other side at all.
- D. They leave the call to someone who wasn't part of the original disagreement.

**TO2 — business urgency vs. data integrity.**
*Scenario*: A cold snap threatens frozen-goods demand forecasts. The business analyst needs a
stock decision within the hour. The data engineer wants to pause integrating a new weather feed
into the pipeline until it's validated, worried a rushed integration corrupts the pipeline.
*Question*: What is the underlying tension here?
- **A. Needing to act before all the facts are confirmed, against wanting to confirm them
  first.** (correct)
- B. Doing more by hand against doing more automatically.
- C. Whether the newer feed can be trusted at all, regardless of timing.
- D. Spending more now against spending less later.

**TO3 — boundary vs. negotiable preference.**
*Scenario*: Marketing wants a personalized-discount model live before a big promotion week, built
on customer loyalty-card data. The DevOps engineer could deploy today by skipping the staged
rollout. The compliance architect wants the standard review done first, since loyalty data is
personal data under consent rules.
*Question*: Which role is most likely to treat this as non-negotiable regardless of the deadline,
and why?
- **A. The one responsible for the data-handling rules, since those aren't something you trade
  away for speed.** (correct — tests the boundary vs. trade-off/preference distinction the
  dossier tagging already teaches; options describe the role by its action in-scenario rather
  than naming it, requiring the reader to map back to which role that is)
- B. The one who could ship it today, since once something's built, finishing it becomes the
  priority.
- C. The one pushing for the promotion deadline, since marketing timing rarely moves.
- D. None of them; there's a workable middle ground here too.

## 3. Pre-registered item → construct mapping

Dated 2026-09-30, fixed before data collection. Matches the `construct` field now on each
`knowledge_question` item in `EvaluationQuestions.json`; scoring reads this field
(`admin_service.calculate_{intro,outro}_percentage_by_construct`), not a post-hoc regrouping.

| Item | `construct` value | Approx. Bloom level |
|---|---|---|
| Concept drift, ML vs MLOps, Reproducibility | `declarative` | Remember/Understand |
| Pipeline jungles | `declarative` | Analyze |
| R1-R6 (match-to-role, by role title) | `perspective_taking` | Apply |
| TO1-TO3 (trade-off) | `perspective_taking` | Analyze/Evaluate |

**Pre-registered predictions** (checks 1-2 from
[eval-methodology-improvements.md](eval-methodology-improvements.md)'s strengthening section):
1. Mean gain on `perspective_taking` items > mean gain on `declarative` items.
2. Students self-reporting low prior MLOps familiarity/self-efficacy (the 3-item composite in
   §4) gain more than students self-reporting high familiarity.

Checks 3, 4, 6, 7 are exploratory/descriptive, per the academic reviewer pass — report them
labeled as such, not as evidence for a causal mechanism.

## 4. Familiarity composite (baseline for prediction 2)

The single categorical "familiarity" demographic item is kept (unchanged, useful on its own for
reporting), plus two new 5-point Likert items added directly after it in
`EvaluationQuestions.json`: *"I could explain the difference between ML and MLOps to a
colleague"* and *"I have hands-on experience with at least one MLOps tool or workflow."* Average
the three (rescaling the categorical item to 1-5) into one composite score for prediction 2,
rather than relying on the single category alone.

## 5. Session protocol (single class slot, one arm — no comparison group)

No control condition this round: splitting the class into groups that get different material is
hard to justify fairly in a real class on a one-week timeline. Every student plays the game;
everyone gets the identical pre/post pair.

| Time | All students |
|---|---|
| 0:00-0:10 | Consent, demographics (incl. familiarity composite), pretest (declarative + R1-R6 + TO1-3) |
| 0:10-0:50 | Play the game |
| 0:50-1:00 | Post-test (same items, no feedback) + SUS + persona ratings |

Pre/post timestamps need no new capture: `GameProgression.time_stamp` at `game_progress_index`
1 and 4 already gives per-student elapsed time, covering the academic reviewer's
rushed-response-detection suggestion for free.

## Known limitations (state explicitly, don't paper over)

- **No comparison group.** A pre→post score change can't be separated from the plain testing
  effect (answering the same items twice) or from maturation over the session. State this
  plainly in the writeup; don't claim the game *caused* the change, only that it was observed
  alongside the game on an instrument aligned to what the game teaches.
- **No independent psychometric pilot.** TO1-3 and R1-R6 went through the adversarial and
  academic-reviewer passes (§ above) and still need the half-day expert content-validity pass
  (1-2 MLOps experts) before the session — not yet done as of this writing.
- Match-to-role items test *general* MLOps-role literacy as much as anything learned specifically
  from this game — a knowledgeable-but-never-played reader could score non-trivially on them.
  This is an inherent tension (the roles are drawn from real industry vocabulary), not something
  the contrast-clause rewrite fully removes; expect a real risk of ceiling effects limiting how
  much room there is to show a gain on this subscale specifically.
- n is whatever the one class session yields — report effect sizes with confidence intervals,
  not significance claims.
