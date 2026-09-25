# Neglected-Stakeholder Sabotage

Builds on [00-plan.md](00-plan.md) (axes, cost model) and its §11 (power/interest quadrant
coverage). Addresses a mechanic gap, not a content gap: right now, being ignored has no
consequence unless you're the one stakeholder who happens to hold formal ownership.

## 1. Problem statement

`apply.py:resolve_degradation` (`apply.py:52-76`) is the only place a stakeholder's unhappiness
ever changes what a card does: if `owner_buyin.get(owner, 1.0) < graph.thresholds.debt_buyin_threshold`
(default 0.4), the raise lands one allowed step lower than asked and the gap becomes tracked
`DebtEntry` — i.e. is delayed, not lost, in the game's own existing vocabulary. Two facts make this
mechanic dead for everyone except one stakeholder per phase:

1. **`owner` is resolved from graph structure alone**, never from who's "in the room" for this
   pitch: `graph.owner_of(target)` (`domain/graph.py:218-224`) returns
   `component.owner_role or stage.owner_role`. Checked `gameConfig/MlopsGraph.json`: **zero
   components have a component-level override** — every target's owner is exactly its stage's
   `owner_role`, i.e. one of five stakeholders (`req`→`requirements_reuben`, `data`→`data_dave`,
   `model`→`model_monica`, `deploy`→`automation_alex`, `ops`→`reliability_ruth`).
   `efficiency_emilia` owns nothing in the entire graph, ever.
2. **Anyone not read this round defaults to fully happy.** `owner_buyin_from_reads`
   (`pipeline.py:138-143`) is explicit about it: *"Anyone not in the room is not unhappy:
   `apply.resolve_degradation` defaults them to 1.0."* A stakeholder whose drivers were never
   addressed isn't neutral in this mechanic, they're maximally satisfied — the literal opposite of
   what "ignored" should mean.

Combined with the veto mechanic already reserving real consequences for high-power stakeholders
(`pitch_debate_service/scoring.py:118`: *"High-power veto trumps all; soft-pass from any low-power
stakeholder"*), a low-power, non-owner stakeholder today has **no lever at all** — being
completely ignored and being fully satisfied look mechanically identical to them. That's the gap:
not "the threshold is miscalibrated", but "only one specific stakeholder per target can ever be
unhappy in a way that matters."

## 2. Design

### 2.1 Who gets a lever, and why it's bounded to one quadrant

Restrict the new mechanic to stakeholders in the **low-power / high-interest** quadrant of that
phase's `Phase.stakeholders` map (§11 of `00-plan.md`) — not every ignored stakeholder, and
explicitly not low-interest ones:

- **High power** is excluded: they already have the veto. Giving them a second lever double-counts
  the same neglect.
- **Low interest** is excluded: they don't care enough to notice or act on being sidelined — that's
  what "low interest" means. Ignoring them is fine and should stay free.
- **Low power / high interest** is exactly the quadrant textbook stakeholder management calls
  "keep informed" — someone with a real stake and no formal authority. The standard warning about
  this quadrant is precisely that neglecting them breeds resentment and friction even though they
  can't block anything outright. That is a one-sentence description of the mechanic being added.

This also gives the §11 quadrant work a mechanical payoff it didn't have before: today all four
quadrants only differ in narrative framing. After this change, "low power / high interest" has a
distinct, real consequence for ignoring it, the same way "high power / low interest" already has
one (the silent veto) once §11 lands.

### 2.2 Trigger conditions

All of the following must hold for a candidate stakeholder S, evaluated once per resolved card:

1. `power == "low"` and `interest == "high"` for S in the card's phase.
2. S is not `graph.owner_of()` for any target the card touches (if they are, the existing owner
   mechanic already covers them — no double jeopardy).
3. S's buy-in for this specific card is effectively zero: none of S's own `driver`/`trade_off`
   items are represented among the card's slotted items. This needs computing demand-alignment for
   S even when S has no existing "read" this round (`owner_buyin_from_reads` today only covers
   stakeholders already read) — a small extension, not a new data source, since
   `demand_alignment`/`calculate_demand_alignment` (`domain/emotion.py`, `pitch_debate_service/scoring.py:33-41`)
   already takes `stakeholder_reqs` for any stakeholder id.

Deliberately a hard, binary gate ("effectively zero"), not a sliding scale down from the existing
0.4 owner threshold — this is meant to fire only in the extreme case the user described
("completely ignored"), not as a second, softer version of the owner mechanic.

### 2.3 What sabotage actually does

Pick **one** op in the card — never more — preferring a **governance-axis** step
(`00-plan.md` §2.1/§2.2) over an automation-axis one: governance steps are sign-offs and reviews by
construction, so "a spurned stakeholder slow-walks a sign-off they were never asked for" is exact,
not a stretch, whereas making the same person slow down a purely technical automation step would
be a coincidence dressed up as a story. If the card has no governance-axis op, or every governance
op is already touched by owner-degradation (§2.4), **no sabotage happens this round** — there is
nothing plausible to hold up, and "sometimes nothing happens" is fine; this isn't meant to fire on
every card.

The chosen op is degraded the same way `resolve_degradation` already degrades an owner-unhappy
raise: it lands one step lower than asked (under the one-step-per-slot model, §2.3 of
`00-plan.md`, that means the step simply doesn't land this round), recorded as a `DebtEntry` with
`owner_id = S`. Mechanically this is a delay, in the game's own existing terms — the same
`debt_created`/`debt_cleared` bookkeeping already shown to the player, payable down by a later
card exactly like owner debt is today.

### 2.4 Bounding the blast radius

Two caps keep this "a small part of the proposal", as asked, not a second veto system:

- **At most one stakeholder acts per card.** If more than one low-power/high-interest stakeholder
  qualifies, only the one with the lowest demand-alignment acts (ties broken by
  `scheduler.stable_rank`, the existing deterministic tiebreak used elsewhere in this codebase) —
  never stack multiple sabotages on one card.
- **Never the same op the owner mechanic already degraded.** If `resolve_degradation` already
  produced a debt entry for a target this round, that op is not eligible for neglect-sabotage too
  — total damage to any single op is capped at one degradation, from whichever mechanic gets to it
  first (owner check runs first, unchanged order).

## 3. Interaction with 00-plan.md and 01-challenge-scheduling.md

- This is a `source_kind="action_card"` concern only — world-event/challenge-seed ops (including
  the stage baseline sweep from `01-challenge-scheduling.md` §2) are never subject to it, same
  scoping `resolve_degradation` already uses today (`op.source_kind != "action_card"` short-circuits).
- Depends on the governance axis existing at all (`00-plan.md` §2.1) — this mechanic has no
  target to prefer until phase 2/3 of that plan lands. Sequenced after, not in parallel.
- Feeds back into `00-plan.md` §12 (completability guarantee): the worst-case check there must
  also confirm that a safe branch survives losing one governance step to a plausible neglect
  sabotage, not only surviving owner degradation — one more thing the §12.4 automated check needs
  to account for once both land.

## 4. Codebase impact

- `application/graph_service/apply.py`: new function alongside `resolve_degradation` (e.g.
  `resolve_neglect_sabotage`), called from `apply_ops` after the existing owner-degradation pass,
  same `DebtEntry` bookkeeping.
- `application/graph_service/pipeline.py`: `owner_buyin_from_reads`'s "not in the room = 1.0"
  default stays correct for the *owner* mechanic (unchanged); the new function needs its own input
  — per-phase-stakeholder demand-alignment computed independent of whether a "read" exists, using
  `Phase.stakeholders` (for the power/interest filter) and the challenge's own
  `RequirementObjects` (for "are any of S's items in this card").
- `domain/graph.py` / `graph_predicates.py`: none — no new axis, no new op kind, this reuses
  `DebtEntry`/`GraphOp` as they exist after `00-plan.md` phase 2.
- Frontend: debt from neglect-sabotage should probably be distinguishable from owner-debt in
  whatever UI already surfaces `debt_created`/`debt_cleared` (e.g. a different reason string) — not
  scoped in detail here, flagged for the phase-5 frontend work in `00-plan.md` §8.

## 5. Decided: no advance signal

**Decided (2026-09-23): the player gets no warning before committing a card.** Neglect-sabotage is
discovered the same way owner debt already is today — after the fact, via the resulting
`DebtEntry`. Surfacing "you're about to ignore a low-power/high-interest stakeholder" ahead of time
would turn the mechanic into a checklist item rather than a consequence of actually not paying
attention to the room — the whole point is that this quadrant is the one it's easy to overlook.
