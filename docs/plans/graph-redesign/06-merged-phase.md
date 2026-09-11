# 06 Merged Pitch Phase

Depends: [04](04-content-pipeline.md), [05](05-persistent-dossier.md). Tracked in [STATE.md](STATE.md).

`challenge_loop_index` 1 and 2 collapse into one screen. Old online intel and pitch debate screens are deleted, no flag.

```
stage 1  PREPARE   engagement cards, build the card
stage 2  OBJECT    deterministic objections, player answers, card amended with intel items only
stage 3  COMMIT    pass, soft pass, or veto
```

Pitch is terminal for the challenge. Nothing touches the graph until COMMIT.

## The card

**1 to 5 stance items, any mix of Driver, Boundary, Trade-off** (D27). No quota per tag. Only intel items, no filler. Fewer items means less coverage. Building and amending cost no attention tokens.

Each item is an action plus its stakeholder's importance ([02](02-intel-taxonomy.md#one-model-for-all-stance-items)). The card's ops are the union of its items' ops. Every Boundary of every stakeholder in the room is checked against the predicted post-card graph, slotted or not.

Display groups the card by tag, it does not restrict it:

| group | shows |
|---|---|
| **Must** | slotted Boundaries, plus warnings for discovered unslotted Boundaries the card would violate |
| **Wants** | slotted Drivers with coverage per stakeholder |
| **Concessions** | slotted Trade-offs, plus uncompensated losses the card causes |
| **Framing** | main convincer profile, optional secondary |

Builder shows live, from player knowledge only:
- predicted effective level per item that raises something, with `capped_by`, or `?` where upstream is unknown ([02](02-intel-taxonomy.md#what-facts-do-in-the-pitch))
- Boundary warnings for discovered Boundaries, "cannot check" where the read target is unknown
- uncompensated losses per stakeholder, where a Price item would help

## Convincer fit

Matched against **every** stakeholder in the room. Main is the primary framing, secondary a hedge for a second audience.

```python
d(p, st) = mean(abs(p.axis - st.archetype.axis) for 3 axes) / 5
fit(st)  = 1 - min(d(main, st), d(secondary, st) + SECONDARY_MALUS)   # malus ~0.15, secondary optional
```

Power weighting happens in the pitch score, not in fit.

## Stage 2 OBJECT

Objections are pre-authored per (stakeholder, target, kind) ([04](04-content-pipeline.md)) and fired deterministically against ground truth. Stakeholders are not fogged. They know their part of the system.

| kind | fires when | raised by |
|---|---|---|
| **stance** | a Driver of st is uncovered or under-covered | st |
| **boundary** | the card violates a Boundary of st | st, hard |
| **price** | the card causes a loss st cares about and st's matching Trade-off is not in the card | st |
| **technical** | an item will be capped by upstream | owner of the capped component |
| **correction** | a slotted item was mis-tagged | its stakeholder |

Order: boundary, technical, stance, price. Top N per stakeholder surfaced, N from challenge config.

### Dialogue options

Availability is a pure function of what the player holds and did. Unaffordable options shown greyed with the reason.

| option | unlocked by | effect |
|---|---|---|
| **Amend** | player holds an intel item that answers it: a Driver for stance, a Boundary for boundary, an upstream item for technical, a Trade-off for price | item added to the card. The only way to build a compromise |
| **Reframe** | always | strength from convincer fit. Can clear a stance objection on a soft Driver. Never clears boundary, technical or price |
| **Stonewall** | always | objection stands, emotion loss with st, emotion gain with whoever holds the opposing position in the challenge conflict |
| **Emergency Addendum** | an Escalation Point remains | adds a change the player holds no intel for, clears one objection, emotion hit with st |
| **Concede Correction** | correction objection | item fixed and verified in the dossier, small emotion cost |

Amendments capped at `max_amendments`, default 3. Card may not exceed 5 slots after amending.

## Stage 3 COMMIT

```python
coverage(st) = mean(credit(d, card) for d in drivers(st))              # all Drivers, no exclusion
loss(st)     = sum(uncompensated losses on targets st cares about)
buy_in(st)   = clamp(0.7*coverage(st) + 0.3*emotions_norm(st) + 0.1*(fit(st) - 0.5) - LOSS_W*loss(st))
```

Outcome:

```python
veto = [st for st in room if st.power == "high"
        and (violates_boundary(card, st) or buy_in(st) < VETO_THRESHOLD)]
soft = [st for st in room if st.power == "low"
        and (violates_boundary(card, st) or buy_in(st) < OBJECTION_THRESHOLD)]
VETO if veto else SOFT_PASS if soft else PASS
```

| outcome | now | later |
|---|---|---|
| PASS | card applies | none |
| SOFT_PASS | card applies | each neglected low power stakeholder writes a grudge, fired in [07](07-simulation-phase.md) |
| VETO | nothing applies | Veto Breaker or Rebuild |

**Veto Breaker.** 1 Escalation Point. Card applies. Overridden stakeholder takes a large emotion hit, patience 0, maximum degradation on everything they own, double weight grudge.

**Rebuild.** Back to PREPARE. 1 patience from everyone in the room. New card must differ by at least `MIN_REBUILD_DELTA` items, default 2.

**Escalation Points.** 3 per game, never regenerate (D15). Spent on Veto Breaker or Emergency Addendum. Shown in the navbar.

**Patience.** Per stakeholder per challenge, default 2. A vetoing high power stakeholder at patience 0 with no Escalation Points left ends the challenge in **STALEMATE**: no card, `stalemate_ops` fire, grudges for everyone in the room, game advances.

**Risk read.** Before commit, a per stakeholder band (green / amber / red). Exact buy-in only for stakeholders whose Language is correctly tagged.

## Stakeholder LLM context

Their owned components with story fragments, the targets in their objection set, the card's targets with current levels. Never the whole graph.

## Deleted

`determine_dialogue_options`, corporate noise, `DialogueOption.archetype` randomization, the separate online intel screen. v2 options Cite Evidence, Defer, Trade removed, see [BACKLOG.md](BACKLOG.md#rejected).

## Steps

- [ ] 1. `game-ui/src/components/pitch_phase.tsx`, three stages, built from parts of `online_intel_gathering.tsx`.
- [ ] 2. Card builder: 1 to 5 stance items in any mix, grouped display, convincer picker with axis bars.
- [ ] 3. Builder previews: effective level prediction from knowledge, Boundary warnings, uncompensated losses.
- [x] 4. `pitch_debate_service/scoring.py`, pure: fit, coverage with metric credit, loss, buy-in, outcome. Tested. (fit/coverage/emotions_norm/loss/buy_in/outcome; 32 tests green)
- [x] 5. `pitch_debate_service/objections.py`, pure: five objection kinds, ordering, option availability with reasons. Tested. (Objection + DialogueOptionSpec models, fire_objections, dialogue_options_for; boundary/technical are hard, correction separated)
- [ ] 6. Objection UI, one stakeholder at a time, amendment budget shown.
- [ ] 7. Commit: outcomes, Veto Breaker, Rebuild with delta check, patience, stalemate, risk read.
- [ ] 8. `PitchDebateState` rework, drop `dialogue_options`, add `card`, `objection_state`. Update the checkpointer allowlist in `service.py`.
- [ ] 9. Trim stakeholder prompt context.
- [ ] 10. Grudges persisted, Escalation Points in game state and navbar.
- [ ] 11. Delete old screens and dead handlers.
- [ ] 12. Playtest a full challenge.

## Done when

Player builds a card from intel, gets objected to deterministically, fixes things by adding intel, and lands on pass, soft pass, veto or stalemate. Same inputs, same objections, same options.
