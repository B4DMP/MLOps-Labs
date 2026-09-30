# Evaluation instrument spec

Concrete spec per [eval-methodology-improvements.md](eval-methodology-improvements.md)'s "next
step." Grounded in actual game content: `GameStakeholders.json`, `RequirementObjects.json`,
`Briefing.json`, `Setting.json`.

**Status**: implemented in `gameConfig/EvaluationQuestions.json`, `Question`/`QuestionFactory`
(added `construct` field), and `admin_service.calculate_{intro,outro}_percentage_by_construct`.
Item text below is the *final* wording, after two rounds of revision driven by the review
pipeline (steps 1-2 of three; the expert content-validity pass, step 3, is still pending —
1-2 MLOps experts still need to look at this before the session).

**Round 3 (2026-10-01)**: the match-to-role/trade-off role vocabulary was re-targeted from a
6-role set loosely derived from the game's own personas and Eken et al.'s wider taxonomy, to the
**7 roles actually taught in this course's lecture**: Business Stakeholder, Subject Matter Expert,
Legal Expert, Data Scientist, Data Engineer, ML Engineer, DevOps Engineer. This is a deliberate
divergence from the game's 6 in-game personas (Data Dave, Model Monica, Requirements Reuben,
Efficiency Emilia, Automation Alex, Reliability Ruth), which already compress several of these
roles into single characters for game-design reasons (e.g. Model Monica covers both Data
Scientist and ML Engineer). The construct being measured is "can a player map what they
experienced in the game onto the lecture's role framework," not "can they name the in-game
characters" - so the questionnaire's role vocabulary should track the lecture, not the cast list,
and a 6-persona-vs-7-role mismatch is expected rather than something to reconcile.

**Validity caveat the academic reviewer pass insisted on stating explicitly, not just implying**:
splitting the game's one Data-Scientist-plus-ML-Engineer persona back into two lecture roles adds
a taxonomy-mapping layer on top of the behavioral inference the items are meant to test. A student
who correctly understood "this character trains and deploys models" must further partition that
understanding into two lecture categories using only the wording of a vignette - for R5/R6
specifically, this means the item is partly testing lecture-taxonomy recall, not purely
game-to-role transfer. Not fixed by the round-4 rewrite below; noted as an open limitation instead
(see "Known limitations").

**Round 4 (2026-10-01), a second pass of the same review pipeline against the round-3 content**,
surfaced three real problems, all fixed:
1. *Guessability probe*: every one of the 10 items (7 match-to-role + 3 trade-off) was solvable via
   jargon/keyword association or elimination, and all three trade-off items shared one template
   (correct answer = moderate compromise or scenario-restatement; wrong answers flagged by
   absolutist words like "even past," "without... at all," "rarely moves"). Reworded distractors
   to remove the absolutist tells and vary question *type* across the three trade-off items
   (TO1 = which resolution mechanism; TO2 = which description of a stated concern is accurate;
   TO3 = which information source takes priority) instead of one repeated shape.
2. *Ambiguity critique*: flagged R3 (DevOps Engineer) as genuinely **AMBIGUOUS** against ML
   Engineer ("automates a repetitive manual step" is equally an ML Engineer reflex in many orgs).
   Rewrote to emphasize DevOps's cross-team/cross-pipeline scope (building one tool for three
   different teams' releases) rather than a single engineer automating their own step.
3. *Academic reviewer pass*: flagged that Legal Expert was the correct answer in 2 of 3 trade-offs
   (TO1 and TO3), a new meta-shortcut ("when in doubt, pick whichever role sounds like a
   compliance gatekeeper") reintroducing exactly the failure mode the round-1/2 pipeline had
   already eliminated for match-to-role items - and that TO1/TO3 were structurally near-identical
   templates (engineer wants to skip a review step, a gatekeeper role objects, correct answer is
   "do the diligence"). Fixed by replacing TO3's scenario entirely: it no longer involves Legal
   Expert at all (now Subject Matter Expert vs. ML Engineer, over incorporating domain knowledge
   before retraining), which also fixes the template-repetition problem since TO1/TO2/TO3 are now
   three distinct question shapes.

R5/R6 were also reworded to drop "notebook" (flagged as a literal tell for Data Scientist/ML
Engineer) and sharpen the distinction to "comparing candidate approaches" (Data Scientist) vs.
"making a chosen approach callable without manual triggering" (ML Engineer). This second pipeline
pass was not re-run again after these fixes, given time constraints - noted as a further limitation
below rather than treated as fully closed.

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
etc. at pretest, so nicknames are meaningless there, and the construct being tested is explicitly
transfer to the lecture's role framework (see the round-3 note above), not recall of the cast.
Same 7 options every item, order randomized per item:

*Business Stakeholder · Subject Matter Expert · Legal Expert · Data Scientist · Data Engineer ·
ML Engineer · DevOps Engineer*

Stances are written as **behavioral scenarios with an embedded contrast**, not self-descriptions
using the role's own keyword stem — the round-1 guessability probe found the original
self-description phrasing solvable by pure keyword matching (100% of items), so each stance now
pairs the target behavior against a specific, plausible runner-up behavior rather than naming the
role's own jargon:

| # | Stance | Correct role | Embedded contrast |
|---|---|---|---|
| R1 | "When last Tuesday's numbers don't line up with the week before, they want to know exactly why the input changed, not just whether the results at the end still look reasonable." | Data Engineer | input provenance vs. Data Scientist/ML Engineer's output-plausibility concern |
| R2 | "When someone proposes a new project, they want to know which number on the weekly report would actually move, and by how much, before agreeing to spend a cent on it." | Business Stakeholder | budget authority vs. a metric-moving concern any technical role could share |
| R3 | "After watching three different teams each hit the same manual release snag in the same week, they're the one who builds a single tool so none of them have to do it by hand again." | DevOps Engineer | cross-team/cross-pipeline scope vs. an ML Engineer automating only their own step (round-4 fix: ambiguity critique flagged the original single-team framing as genuinely confusable with ML Engineer) |
| R4 | "Before anyone signs off on using this data, they want to know exactly what the agreement with the customer actually permits, not just what the system is technically capable of." | Legal Expert | permission/boundary vs. Business Stakeholder's value/cost framing |
| R5 | "Even with the same input, they'll keep comparing new candidate approaches against each other, unwilling to settle until one clearly beats the rest." | Data Scientist | comparing/choosing among approaches vs. ML Engineer's making-it-dependable concern |
| R6 | "Once a candidate approach is chosen, they're the one who wires it up so the rest of the system can call it on its own, not just watch someone trigger it manually." | ML Engineer | productionizing a chosen approach vs. Data Scientist's comparison-stage work (round-4 fix: dropped "notebook," a literal tell flagged by the guessability probe) |
| R7 | "When a plan satisfies every rule on paper, they're still the one who can tell you it won't survive contact with how people actually do this job day to day." | Subject Matter Expert | operational reality vs. formal-compliance framing (round-4 fix: reworded away from "prediction... technically sound," which the academic reviewer flagged as too close to R1's input/output framing) |

All 7 are in the shipped instrument — each carries a distinguishing contrast clause rather than
relying on redundant coverage to average out guessability. R5/R6 split what round 1-2 had
merged into one "ML Engineer/Data Scientist" role, now that the lecture treats them separately;
R4/R7 are new, covering Legal Expert and Subject Matter Expert, which didn't exist in the
game-persona-derived set at all.

### 2b. Novel trade-off scenarios

Structurally modeled on real `trade_off` nodes (challenges 110-118: concedes/branch mechanic,
boundary-vs-preference distinction) but with changed surface details, not verbatim challenge
content — avoids rewarding "I remember this exact challenge" over the underlying skill.
Stakeholders are referred to **by role, not nickname**, same reasoning as §2a — a pretest-taker
can't reason about "Ruth and Reuben" before they've met them, and the transferable skill is
reasoning about role tensions, not recalling character names.

De-echoed from scenario wording and de-absolutized (dropped "always"/"fully"/"at all"-style
distractor tells the guessability probe flagged) relative to the round-1 draft. Round 4 (see the
revision log above) additionally varied the *question type* across the three items rather than
repeating one template, and removed the Legal Expert-wins-twice pattern.

**TO1 — speed vs. governance.**
*Scenario*: A regional distributor needs a restocking model shipped before a two-day cold-chain
audit deadline. The ML engineer wants to deploy now with a manual sign-off instead of the full
data-protection review. The legal expert insists every release passes that review first, even if
it slips the deadline.
*Question*: Which resolution best matches how such trade-offs are usually handled?
- **A. They agree on an interim check now, with the fuller review following shortly after.**
  (correct — matches the `concedes` mechanic: negotiated, partial, explicit)
- B. They complete the full review first, and the deadline moves instead.
- C. They proceed without telling the other side.
- D. Someone outside the disagreement makes the call instead.

**TO2 — business urgency vs. data integrity.**
*Scenario*: A cold snap threatens frozen-goods demand forecasts. The business stakeholder needs a
stock decision within the hour. The data engineer wants to pause integrating a new weather feed
into the pipeline until it's validated, worried a rushed integration corrupts the pipeline.
*Question*: Which of these is the most accurate description of the data engineer's real
objection? (round-4 rewrite — the original "what is the underlying tension" framing let the
ambiguity critique find a plausible competing reading, since the scenario's concrete concern
mapped just as well onto a wrong option as the intended abstract one)
- **A. Integrating an unvalidated feed risks corrupting the pipeline for everyone, not just this
  one decision.** (correct)
- B. The new feed comes from a vendor the data engineer personally distrusts.
- C. Automating the integration would take too much engineering time this week.
- D. The business stakeholder's timeline doesn't match the usual release schedule.

**TO3 — whose information takes priority.**
*Scenario*: A demand-forecasting model flags a sudden drop for one product category. The subject
matter expert says the drop is expected, a known seasonal pattern the model wasn't around to
learn yet. The ML engineer wants to retrain immediately on the new numbers before anyone acts on
the forecast. (Round-4 replacement for the original loyalty-data/DevOps-vs-Legal-Expert scenario:
that one made Legal Expert the correct answer in two of the three trade-off items, a meta-shortcut
the academic reviewer flagged, and was structurally identical to TO1 — this scenario touches
neither Legal Expert nor the skip-a-review-step shape.)
*Question*: Which resolution best fits how this kind of disagreement usually gets resolved?
- **A. They fold the seasonal pattern into the forecast before retraining on anything else.**
  (correct — domain knowledge takes priority over blindly retraining on the newest numbers)
- B. They retrain on the newest numbers and treat the seasonal explanation as unconfirmed.
- C. They leave the forecast as it is, since revisiting it would cost more time than it's worth.
- D. They put the decision in front of whoever manages the model's overall roadmap.

Trading away the original boundary-vs-preference framing (§ old TO3, tied to the dossier's own
boundary/trade-off/preference tagging) was a deliberate cost of this fix, not an oversight - noted
so it isn't silently lost. TO1 still carries a `concedes`-style negotiated trade-off; the
boundary/preference distinction itself isn't tested by any trade-off item after this round.

## 3. Pre-registered item → construct mapping

Dated 2026-09-30, fixed before data collection. Matches the `construct` field now on each
`knowledge_question` item in `EvaluationQuestions.json`; scoring reads this field
(`admin_service.calculate_{intro,outro}_percentage_by_construct`), not a post-hoc regrouping.

| Item | `construct` value | Approx. Bloom level |
|---|---|---|
| Concept drift, ML vs MLOps, Reproducibility | `declarative` | Remember/Understand |
| Pipeline jungles | `declarative` | Analyze |
| R1-R7 (match-to-role, by role title) | `perspective_taking` | Apply |
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
| 0:00-0:10 | Consent, demographics (incl. familiarity composite), pretest (declarative + R1-R7 + TO1-3) |
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
- **No independent psychometric pilot, and no third pipeline pass on the round-4 fixes.** TO1-3
  and R1-R7 have now been through two full rounds of adversarial/academic review (round 1-2 on the
  original 6-role set, round 4 on the relettered 7-role set — see the revision log above), but the
  round-4 fixes themselves were not re-run through a fresh guessability/ambiguity/academic pass,
  and the half-day expert content-validity pass (1-2 MLOps experts) still hasn't happened. Treat
  the current wording as "adversarially reviewed once," not "fully hardened."
- Match-to-role items now explicitly track the *lecture's* role vocabulary, which sharpens one
  limitation rather than removing it: a student who paid attention in lecture but never played the
  game could score non-trivially on this subscale, same ceiling-effect risk as before, now for an
  even more direct reason (the items are deliberately built to be answerable from lecture content
  alone, since that's the transfer being tested).
- **Data Scientist/ML Engineer taxonomy-mapping layer** (flagged by the academic reviewer, see the
  round-3 validity caveat above): R5/R6 ask a player to partition one compressed in-game persona's
  work into two lecture categories using only vignette wording - this is partly testing lecture
  recall, not purely game-to-role transfer, and isn't fixed by the round-4 wording changes.
- n is whatever the one class session yields — report effect sizes with confidence intervals,
  not significance claims.
