# 06 Merged Pitch Phase

Depends: [04](04-content-pipeline.md), [05](05-persistent-dossier.md). Tracked in [STATE.md](STATE.md).

`challenge_loop_index` 1 and 2 collapse into one screen. Old online intel and pitch debate screens are deleted, no flag.

## Three stages on one screen

```
stage 1  PREPARE   spend attention tokens on engagement cards, assemble the card
stage 2  OBJECT    stakeholders object, player answers with dialogue options, card can be amended
stage 3  COMMIT    outcome resolved: pass, soft pass, or veto
```

Pitch is terminal for the challenge. Nothing is applied to the graph until COMMIT.

## Stage 1 PREPARE

Engagement cards behave as today, reveal bias toward the challenge focus nodes.

Card assembly:
- exactly 5 slots, Position items only, any phase, any stakeholder
- empty slots fill with **corporate noise**, zero coverage, flat emotion penalty on every active stakeholder, no deadlock
- **main convincer profile**, matched against the phase high power high interest stakeholder
- **secondary convincer profile**, optional, matched against the high power low interest counterpart

```python
d(profile, st) = mean(abs(profile.axis - st.archetype.axis) for 3 axes) / 5
fit(st)        = 1 - d(main, st)                       if st is the primary target
                 1 - d(secondary, st)                  if st is the secondary target and one was picked
                 1 - 0.5 * (d(main, st) + d(secondary or main, st))   otherwise
```

Leverage Motivation items held for a stakeholder add a flat bonus to `fit` for that stakeholder. That is what Leverage is for.

## Stage 2 OBJECT: dialogue that is earned, not rolled

Objections are pre-authored ([04](04-content-pipeline.md)), fired deterministically:

```python
objections(st) = [o for o in authored_objections(st)
                  if o.component not in card.component_targets
                     or card.component_targets[o.component] < o.required_level]
order = Mandate first, then by severity, then by component weight
surfaced = top N per stakeholder, N from challenge config, typically 1 to 2
```

Each objection presents dialogue options. **Availability is a pure function of what the player did in stage 1 and in earlier phases.** Nothing random, nothing generated at answer time.

| option | unlocked by | effect |
|---|---|---|
| **Amend** | player holds a Position item covering the objection component | component added to the card, objection cleared, but the card grows and may anger the owner of a conflicting position |
| **Cite evidence** | player holds an Evidence System State item asserting the component already sits at the required level | objection cleared, no slot spent, strong emotion gain. Checked against ground truth, so citing stale evidence backfires: objection stands and the stakeholder loses trust |
| **Reframe** | always | scaled by convincer `fit` for that stakeholder. Good fit clears a Preference objection. Never clears a Mandate. |
| **Trade** | the challenge `conflict` block puts a rival on an opposing level and the rival is in the room | objection cleared, rival loses buy-in. Explicit zero sum choice. |
| **Defer** | always | objection parked, no buy-in change now, writes a promise. Broken promises cost trust in a later phase. |
| **Stonewall** | always | objection stands, emotion loss with this stakeholder, emotion gain with anyone whose position conflicts with the objection |
| **Emergency addendum** | an Escalation Point remains | adds a component the player holds no intel for, clears the objection, emotion hit with the objector. Finite, see COMMIT |
| **Concede correction** | objection is a mis-tag correction ([02](02-intel-taxonomy.md)) | item is fixed and verified in the dossier, small emotion cost, coverage recomputed |

Every option shows its unlock reason in the tooltip, so the player learns that stage 1 spending is what buys stage 2 options. An option the player cannot afford is shown greyed with the reason, never hidden. That is the teaching surface.

Amend replaces the old addendum idea, but bounded: the card can grow by at most `max_amendments` components per pitch, config default 3. Amending costs no attention tokens. Card building is free, preparation is what costs.

## Stage 3 COMMIT

```python
coverage(st) = mean(match_score(o) for o in all authored objections of st)
match_score  = 1.0 if card level >= required else 0.5 if card level > 0 else 0.0
buy_in(st)   = clamp(0.7*coverage(st) + 0.3*emotions_norm(st) + 0.1*(fit(st)-0.5))
```

No exclusion of well covered objections. The threshold decides only what is surfaced in stage 2.

### Three outcomes

```python
blocking = [st for st in room if st.power == "high" and buy_in(st) < VETO_THRESHOLD]
soft     = [st for st in room if st.power == "low"  and buy_in(st) < OBJECTION_THRESHOLD]

if blocking:  VETO
elif soft:    SOFT_PASS
else:         PASS
```

| outcome | now | later |
|---|---|---|
| PASS | card applies in full | none |
| SOFT_PASS | card applies | each neglected low power stakeholder writes a `grudge`. Grudges fire in later phases as friction: delayed world events, a component landing one level lower, an extra objection with reduced patience |
| VETO | card does not apply | see below |

Grudges are persisted and resolved in [07](07-simulation-phase.md). Soft failure must cost something visible later, otherwise low power stakeholders are free to ignore.

### Veto resolution

Player picks one:

1. **Veto breaker.** Costs 1 Escalation Point. Card applies as if PASS. The overridden stakeholder takes a large emotion hit, drops to `patience 0`, and owns every component they touch with maximum degradation in the simulation phase. Overruling works, and it hurts.
2. **Rebuild.** Return to stage 1. Costs 1 patience from every stakeholder in the room. The new card must differ by at least `MIN_REBUILD_DELTA` Position items, config default 2, so resubmitting the same card is not a path.

### Escalation Points

3 for the entire game, tracked in game state, shown in the navbar next to attention tokens. Two spends:

- **Veto Breaker**, above.
- **Emergency Addendum**, during stage 2. Adds a component to the card that the player holds no intel for, clearing one objection. Costs 1 point plus an emotion hit with the stakeholder whose objection was bypassed.

Escalation is the answer to "I did not prepare for this", and it is finite, so it cannot be the strategy.

### Patience and stalemate

Patience is a small integer per stakeholder per challenge, default 2. Not an emotion, a hard gate. Decremented by rebuild and by override.

When any high power stakeholder in the room reaches `patience 0` and the card is still vetoed, and the player has no Escalation Points, the challenge ends in **STALEMATE**:

- no card applies
- the challenge fires its `stalemate_ops`, a detrimental world event authored on the template. The problem does not wait for the meeting to finish
- metrics take a hit, affected stakeholders carry a grudge into the next phase
- the game advances

Failure is a legitimate outcome, not a dead end. That is what gives the veto weight without an infinite loop.

### Risk read before commit

Before locking in, the player sees a per stakeholder risk indicator, not exact buy-in numbers:

```
resolution = full   when the player holds a Leverage Motivation item for that stakeholder
             coarse otherwise            (green / amber / red band only)
```

So preparation buys foresight too. Blind commits are possible, they are just gambles.

Final screen lists per stakeholder risk, which objections stand, what the card contains, Escalation Points remaining, and a confirm button.

## Stakeholder LLM context

Owned node summary plus story fragments, the components named in their own objection set, the card components with current levels. Never the whole graph.

## Deleted

`determine_dialogue_options`, corporate noise as a dialogue path, `DialogueOption.archetype` randomization, the separate online intel screen. Addendums come back, bounded, as the Amend and Emergency Addendum options.

## Steps

- [ ] 1. New component `game-ui/src/components/pitch_phase.tsx`, three stages, built from parts of `online_intel_gathering.tsx`. Do not fork `pitch_debate.tsx` wholesale.
- [ ] 2. Card assembly UI, 5 slots, corporate noise filler, convincer picker with axis bars.
- [ ] 3. `application/pitch_debate_service/scoring.py`, pure: fit, coverage, buy-in, outcome resolution. Tested.
- [ ] 4. `application/pitch_debate_service/objections.py`, pure: objection selection, option availability with unlock reasons. Tested.
- [ ] 5. Objection UI, one stakeholder at a time, greyed options with reasons, amendment budget shown.
- [ ] 6. Amendment applies to the card in memory, coverage recomputed live.
- [ ] 7. Commit stage: pass, soft pass, veto. Escalation Points, patience, rebuild delta check, stalemate.
- [ ] 8. `PitchDebateState` rework, drop `dialogue_options`, add `card_components`, `objection_state`, `promises`. Update the checkpointer allowlist in `service.py`.
- [ ] 9. Trim stakeholder prompt context.
- [ ] 10. Promises and grudges persisted for later phases. Escalation Points in game state and navbar.
- [ ] 11. Delete old screens and dead handlers.
- [ ] 12. Playtest a full challenge.

## Done when

Player prepares, gets objected to, answers with options they earned, amends, and hits one of pass, soft pass, veto or stalemate. Same inputs always produce the same objections and the same available options.
