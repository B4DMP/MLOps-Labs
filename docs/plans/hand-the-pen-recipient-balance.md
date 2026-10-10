# Hand the Pen: the "Reuben always wins" balance finding

Status: diagnosis complete, no mechanic change recommended yet. Written so the reasoning survives
even if the headline numbers drift as challenge content changes.

## The original finding

`tests/sim_pen.py` (the balance sim `docs/plans/hand-over-the-pen.md` step 2 asks for) reported:

> best-recipient tally (a single dominant name across most challenges would be a red flag):
>   requirements_reuben  best in 10/10 challenges

That is exactly the red flag the plan's own pass criteria warn about ("no recipient or band is
best in most challenges"). This doc is the investigation into why, and what - if anything - to do
about it.

## What this rests on

Checked against the code and content on 2026-10-10, via `sim_pen.py` runs and a few one-off
scripts against the real graph/phase config (not reproduced here - see "Verify" below to
regenerate the same numbers).

- **The sim's own tie-break was the first bug.** `sim_pen.py`'s `challenge_best` comparison used a
  strict `>` on health, so an exact tie kept whichever `(stakeholder, target)` was checked *first*.
  `owned_targets` iterates `graph.components`, and `gameConfig/MlopsGraph.json` lists `req.*`
  (Requirements, all owned by `requirements_reuben`) before every other stage. Any wide tie
  therefore always "resolved" to Reuben, regardless of whether his draft was actually better.
  Fixed: `sim_pen.py` now collects every result per challenge and reports the whole tied set
  (within `TIE_TOLERANCE = 0.02` health of the best, at the same outcome rank), not just the first
  match.
- **`requirements_reuben` is in every non-demo room.** Of the 5 non-demo phases (10 challenges,
  2 each): `requirements_reuben` sits in all 5; `reliability_ruth` in 4; `automation_alex` and
  `data_dave` in 2 each; `model_monica` in 2. A stakeholder who is never in the room can never be
  "best" - a raw "best in N/10" tally structurally favours whoever is present most, independent of
  whether their items are mechanically stronger.
- **`efficiency_emilia` owns zero graph components** (`graph.owner_of` never returns her for any
  of the 28 components). She's in every room too, but never eligible for Hand the Pen under the
  sim's owner-only scope (matching the real game's eligibility rule - she'd only ever be eligible
  via a held note, which the sim doesn't model, see `sim_pen.py`'s own docstring). Not a bug: she's
  a cross-cutting stakeholder without a stage of her own.
- **`card_search._health_after` is scoped to the current phase's own stage** (`stage_for_phase`).
  Challenge 110 (phase 1) only ever measures Requirements-stage health - a locked
  `deploy.cicd`/`ops.alerting` draft doesn't touch that stage at all, so its "health won back"
  mostly just reports that stage's pre-existing condition. This is why, in an early debug run
  (lock-and-search a single target with no trust-band forcing), *every* owned target across every
  stage scored `health=1.000`: not because every draft was equally powerful, but because the
  metric was blind to most of them. "Health won back" is the wrong column to compare recipients
  across different stages by; outcome rank (PASS/SOFT_PASS/VETO) from the full combinatorial
  search is the real signal, and that one *did* vary before normalisation.
- **Once the tally is normalised by eligibility** (`tied-for-best / eligible-for`, i.e. only
  counting challenges the stakeholder was actually in the room and owned something), the picture
  flips:

  | stakeholder | tied for best | eligible | rate |
  |---|---|---|---|
  | requirements_reuben | 10 | 10 | 100% |
  | reliability_ruth | 8 | 8 | 100% |
  | automation_alex | 4 | 4 | 100% |
  | data_dave | 4 | 4 | 100% |
  | model_monica | 3 | 4 | 75% |

  Every owning stakeholder is tied for best in essentially 100% of the challenges they're
  eligible for. There is no recipient whose draft is reliably *worse* than peers, and - this is
  the important part - no recipient is reliably *better* either. The 10/10 headline was almost
  entirely the presence effect plus the tie-break bug, not a property of `pen.draft_for_pen`'s
  trust-band logic.

## Conclusion

**No change to `pen.py`'s trust-band logic is warranted by this finding.** The mechanic looks
balanced across recipients: who's "best" in a given challenge is explained by who's in the room,
not by whose items are secretly stronger. The one open thread worth a look, not a fix:
`model_monica` misses the tied-best set in 1 of her 4 eligible challenges (challenge 119, where
her `model.experiment_tracking`/`model.evaluation` drafts are among the "Low-trust drafts that
left NO veto-free card" - see `sim_pen.py`'s own output). That may just be challenge 119 being a
tighter room (it already needed `pen_trust_dividend_steps` etc. relaxed per the original plan's own
"Risks" section), not a defect.

## What to actually do

1. **Keep the fixed `sim_pen.py`.** It now reports the full tied set and the eligibility-normalised
   rate, not a single first-found name. Re-run it whenever challenge content, the graph, or
   `pen.py` changes - the presence/eligibility normalisation is what makes the result trustworthy,
   so don't revert to reading the raw "best in N/10" tally on its own.
2. **Don't tune `pen_trust_gain`/`pen_control_gain`/`pen_trust_dividend_steps` for this.** Those
   knobs exist for a different risk (the original plan's "Decision: trust dividend" - whether a
   High-trust draft is too strong on its own), which this finding doesn't speak to either way.
3. **Optional, low priority:** look at challenge 119 specifically (why `model_monica`'s items and
   `requirements_reuben`'s `req.kpi_definition`/`req.acceptance_criteria` all show up in the
   "no veto-free card" list at Low trust there) - if it's a tight room by design, nothing to do; if
   it's an accidental content gap, that's a challenge-content fix, not a Hand the Pen fix.
4. **Note for later balance work, not this one:** `_health_after`'s single-stage scoping means it
   shouldn't be read as "how good was this draft" when the draft's target isn't the phase's own
   measured stage. If a future sim wants a true cross-stage draft-quality comparison, it would need
   the multi-pillar scoring `card_search._flawless_card` already uses (pipeline + relations +
   decision), not `_health_after` alone.

## Verify

```bash
docker compose up -d
docker compose exec -T -e PYTHONPATH=/app -e SIM_BUDGET=150 api python tests/sim_pen.py
```

Read the three tallies at the end in order: raw first-found (misleading on its own), tied-within-
tolerance (better, still presence-biased), eligibility-normalised (the one to trust). A real red
flag would be a recipient near 100% here while a peer who was equally eligible sits near 0% - not
what the current numbers show.
