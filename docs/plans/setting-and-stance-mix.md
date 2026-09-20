# One setting for all content, and a stance mix players can bargain with

Two changes that share a regeneration: the game's content moves from a generic MLOps project into
one named fictional company, and a challenge's intel becomes mostly Trade-offs rather than Drivers
and Boundaries.

## Why a setting

Content used to be written against "an enterprise that develops an ML-based product". In practice
that produced a playthrough set in several different worlds at once: the assembled corpus contained
a fraud detection pipeline, a churn model and a table of customer records, in the same game. Nothing
tied a snippet to the challenge next to it, and the governance half of the component graph had
nothing concrete to defend.

`gameConfig/Setting.json` now holds the world, and both halves of the game read it:

- `content_gen` appends it to every stage's system prompt (`stages/common.py: system_for`), so
  challenges, intel, snippets, objections and story fragments are written in it.
- the live agents get a shorter version through the `[[SETTING]]` placeholder, filled in when a
  prompt is read rather than when the module is imported (`domain/prompts.py`), so stakeholders talk
  about the same company the snippets came from.

The setting's fingerprint is part of every generated item's input hash
(`Context.stage_version`), so editing `Setting.json` marks content stale the way editing a prompt
does, instead of leaving half the game in the old world.

### The world

A discount supermarket chain, Lindenmarkt, running about 1200 stores. Its ML system, Shelfcast,
forecasts demand for every article in every store each night and turns that into replenishment
orders; it also sizes the first allocation of the weekly middle aisle promotion when a buyer locks
it in.

The reframe from "which products go in the middle aisle" to "chain wide forecasting and
replenishment, with the middle aisle as its most visible slice" is deliberate. A quarterly buying
decision would not plausibly need a serving endpoint, latency budgets, canary rollout or production
drift monitoring, which is about a third of the component graph. A nightly forecast serving hundreds
of stores needs all of it.

What stays domain neutral on purpose: the component graph, the six metrics, CAPTURE, and the
glossary. Those are the transfer layer, and they are worth more to a player in the real vocabulary.

## Why the stance mix

Playtesting found rooms full of Boundaries: a red line is a wall, so a challenge made of them has
one legal proposal and nothing to negotiate. Trade-offs are what the player can actually spend.

`scopes.json` now carries a `stance_mix` per scope. It is enforced in three places: the items prompt
asks for it, the items check rejects a challenge that misses it, and a gate checks the assembled
corpus as a whole.

The share is bounded on both sides. Asked only for a floor of Trade-offs, the model wrote the one
Driver and one Boundary it had to and made everything else a Trade-off, which reached 64 percent and
cost the challenges their shape: a Driver is what the player builds an action card out of, and the
orphan gate needs Drivers spread over a phase's components.

| | Driver | Boundary | Trade-off |
| --- | --- | --- | --- |
| before | 39% | 34% | 27% |
| floor only | 19% | 16% | 64% |
| shipped | 33% | 17% | 50% |

## The removed hand written challenges

Challenges 0 to 5 predated the generation harness and were each phase's fallback. They had no intel
payloads, were written for a generic project, and between them contained 51 Drivers, 37 Boundaries
and no Trade-offs at all. They are deleted rather than rewritten, together with their 88 intel items
and 24 snippets.

That leaves two holes, both now filled by the harness:

- **Fallbacks.** The loader insists on exactly one fallback challenge per phase. Assembly now picks
  it: the lowest priority generated challenge of the phase, with its preconditions cleared so it is
  always eligible (`assemble.assign_fallbacks`).
- **The introduction.** Phase 0 has no stage of its own; content generation borrows the first
  lifecycle stage, as the websocket pitch handler already does. The scope's `intro_phase` gives it
  one gentle challenge instead of the usual pair, and the templates prompt asks for a first meeting
  that teaches rather than tests. It generated The Summer Forecast Gap, a soft disagreement about
  whether KPI definitions should be automated, opening on a line that welcomes the player in.

How many challenges a phase deals is pacing rather than content, so assembly now only fills
`challenges_per_phase` in where it is missing instead of overwriting it with the scope's template
count. Left alone it had quietly doubled the game from six challenges to eleven.

## Gates added along the way

- **Setting gate.** Player facing text that wanders into another ML domain (fraud, churn, patients)
  or names a real retailer is rejected at generation and again at assembly.
- **Duplicate templates.** Slots are written in parallel and cannot see each other. Two of them
  landed on the same slug, which assembly would have silently collapsed into one challenge sharing
  the other's intel. The templates check now refuses a slug or name a sibling already took, and
  assembly refuses to run on a duplicate.
- **Challenge angles.** Left alone, a phase's slots cluster: the first run produced four consecutive
  challenges about loyalty data consent. Each slot now draws a different source of trouble.
- **Level talk.** The strict "no levels" gate rejected ordinary English in prose ("feature level
  drift tracking"). The narrower pattern the artifacts stage already used is now shared.

## New commands

    python -m content_gen --scope tier1 prune [--stage S] [--dry-run]

Forgets ledger rows, and their output files, that a stage no longer plans. Rewriting the challenge
templates changes their slugs, and the items, artifacts, objections and gists of the old slugs stay
approved otherwise, feeding orphan content into assembly and into every stage that plans from what
is approved.

## Tests

Three test modules were written against the hand written content and had to move with it. None of
them were testing that content; they were using it as a fixture and naming it by id.

- `test_emotion_dynamics_simulation` pulled a stakeholder's intel out of challenges 0 and 1. It now
  picks by stakeholder, and slots Trade-offs as well as Drivers for the "fully met" case, since
  alignment averages over both and the hand written content had no Trade-offs to average.
- `test_facial_expression_mapping` named a deleted requirement id; it now takes the first Boundary
  in the config.
- `test_intel_categorization` asserted that a mis-tagged item's dossier text equals the stored wrong
  reading. For split items the dossier shows the fact followed by that reading, which is what the
  handler does and what the assertion now expects. Its second re-tag also moved off Trade-off, which
  goes down the branch inventing path and gets its wording from the model.

The ten remaining failures in the suite (`test_action_card_pitch_service`, `test_admin_service`,
`test_migrations`, `test_pitch_debate_cme`) predate this work: the same ten fail with these changes
stashed.

## Open questions

1. **Saved campaigns.** `game_challenge_data` rows point at challenge ids from the previous corpus
   (102 and 107 in the dev database). Regenerating reassigns ids, so those sessions now reference
   challenges that do not exist. They probably want clearing before the next playtest.
2. **The introduction argues about requirements.** Phase 0 borrows the requirements stage, so its
   challenge and phase 1's two challenges all argue about the same four components. Worth watching
   in a playtest for repetition.
3. **`FullGameProgression.json`** is reachable only through the admin config editor; nothing loads
   it. Its phase introductions were updated to match, but it may simply want deleting.
4. **Stakeholder introductions** in `GameStakeholders.json` are still domain neutral. They read
   fine, but they could name Shelfcast and the shelf if we want the cast to feel local.
5. **Trade-offs without payloads.** The mix is enforced on generated content, which always carries
   `concedes`. Nothing stops hand written content from carrying a payload free Trade-off, which
   reads right but does nothing mechanically.
6. **Orphan components.** The tier1 scope deals two challenges a phase, so 37 components and edges
   are asked for by nobody; the gate warns rather than blocks at this scope. Running `full` (four
   templates a phase) would cover more of the graph and would block on what is left.
7. **Gists.** Twelve of the sixty six stance items have no gist: they fail the stage's own blind
   reader check on metric attribution. The runtime falls back, so this is cosmetic, but the rate
   has been roughly a fifth across every run and the check may be stricter than it needs to be.
