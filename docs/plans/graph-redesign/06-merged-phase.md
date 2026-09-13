# 06 Merged Pitch Phase

Depends: [04](04-content-pipeline.md), [05](05-persistent-dossier.md). Tracked in [STATE.md](STATE.md).

`challenge_loop_index` 1 and 2 collapse into one screen. Old online intel and pitch debate screens are deleted, no flag.

```
stage 0  GATHER    engagement cards and the attention tokens they cost (D46)
stage 1  PREPARE   build the card from what gathering turned up
stage 2  OBJECT    deterministic objections, player answers, card amended with intel items only
stage 3  COMMIT    pass, soft pass, veto, conceded or stalemate
```

Gathering is a step of its own (D46). The stepper is the navigation: the player moves between
gathering and building at will, and jumps ahead to the room once the readiness meter allows it.
Making the pitch closes gathering for good, since the pitch is terminal. Artifacts are never re-read
in this phase, they belong to offline gathering.

A pitch also needs something to pitch with. The screen reports how much of the challenge's intel is
verified, and holds the pitch back below the lower threshold, warns between the two, and clears it
above the upper one. The thresholds are content, not code.

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
| VETO | nothing applies | Veto Breaker, Rebuild, or Let them have it |
| CONCEDED | the opposing position applies instead of the card | the side that was dropped remembers it |

**Veto Breaker.** 1 Escalation Point. Card applies. Overridden stakeholder takes a large emotion hit, patience 0, maximum degradation on everything they own, double weight grudge.

**Rebuild.** Back to PREPARE. 1 patience from everyone in the room. New card must differ by at least `MIN_REBUILD_DELTA` items, default 2.

**Let them have it (D41).** The player drops their own card and accepts the opposing position of the challenge `conflict`, which applies in its place. No Escalation Point, no patience cost. A large emotion gain with the side that gets its way, a loss with the side dropped, and a grudge for the dropped side. Offered whenever a veto stands, next to Veto Breaker and Rebuild, so a challenge never dead ends: refusing to decide is itself a decision, and the room acts without the player. Outcome `CONCEDED`, simulated in [07](07-simulation-phase.md).

**Escalation Points.** 3 per game, never regenerate (D15). Spent on Veto Breaker or Emergency Addendum. Shown in the navbar.

**Patience.** Per stakeholder per challenge, default 2. A vetoing high power stakeholder at patience 0 with no Escalation Points left ends the challenge in **STALEMATE**: no card, `stalemate_ops` fire, grudges for everyone in the room, game advances.

**Risk read.** Before commit, a per stakeholder band (green / amber / red). Exact buy-in only for stakeholders whose Language is correctly tagged.

## Stakeholder LLM context

Their owned components with story fragments, the targets in their objection set, the card's targets with current levels. Never the whole graph.

## Deleted

`determine_dialogue_options`, corporate noise, `DialogueOption.archetype` randomization, the separate online intel screen. v2 options Cite Evidence, Defer, Trade removed, see [BACKLOG.md](BACKLOG.md#rejected).

## Steps

- [x] 1. `game-ui/src/components/pitch_phase.tsx`, four stages (D46), built from parts of `online_intel_gathering.tsx`. Screen exists with all three stages. Engagement cards and stakeholder chat folded into PREPARE (D37). Loop indices 1 and 2 both route to `<PitchPhase>`; `online_intel_gathering.tsx` deleted in step 11.
- [x] 2. Card builder: 1 to 5 stance items in any mix, grouped display, convincer picker with axis bars. (picker is a plain select, axis bars still missing)
- [x] 3. Builder previews: effective level prediction from knowledge, Boundary warnings, uncompensated losses.
- [x] 4. `pitch_debate_service/scoring.py`, pure: fit, coverage with metric credit, loss, buy-in, outcome. Tested. (fit/coverage/emotions_norm/loss/buy_in/outcome; 32 tests green)
- [x] 5. `pitch_debate_service/objections.py`, pure: five objection kinds, ordering, option availability with reasons. Tested. (Objection + DialogueOptionSpec models, fire_objections, dialogue_options_for; boundary/technical are hard, correction separated)
- [x] 6. Objection UI, one stakeholder at a time, amendment budget shown.
- [x] 7. Commit: outcomes, Veto Breaker, Rebuild with delta check, patience, stalemate, risk read.
- [x] 8. `PitchDebateState` rework, drop `dialogue_options`, add `card`, `objection_state`. Deviation: the pitch state is not a LangGraph channel at all. It lives on the challenge row as `action_card.pitch` and is driven by the `pitch:*` websocket events, so nothing about the pitch depends on the conversation graph. The LangGraph state and its checkpointer stay as they are for the stakeholder chat.
- [x] 9. Trim stakeholder prompt context. `username` added to `PitchDebateState`; `generate_stakeholder_response` now builds `owned_components` (this stakeholder's graph components with story at current level) and `card_targets` (card items' graph targets with current level). Static `st.requirements` dropped from the combined field; prompt updated to use `private_requirements`, `owned_components`, `card_targets`. Both blocks are wrapped in a single try/except so a missing graph state never breaks the chat.
- [x] 10. Grudges persisted, Escalation Points in game state and navbar. Both persist on the session row (migration `a7b8c9d0e1f2`) and the pitch screen shows the points; the navbar does not yet. Closed: no separate navbar is being built; the pitch stage bar is the only place EPs are spent, so that is the right place to show them.
- [x] 11. Delete old screens and dead handlers. (`online_intel_gathering.tsx`, `pitch_debate.tsx`, `PitchActionCardModal.tsx`, `ActionCardCreatedModal.tsx` and their CSS modules removed; `Game.tsx` routes loop indices 1 and 2 to the merged `<PitchPhase>`.)
- [ ] 12. Playtest a full challenge. Fixes the numbers afterwards (D38), and settles how a player walks away from a veto (Q25).
- [x] 13. Let them have it (D41): `pitch:concede` event + `concede_pitch()` in `session.py` + `handle_pitch_concede()` in `pitch_handler.py`. Frontend: "Let them have it" button beside Veto Breaker and Rebuild; CONCEDED outcome card with description. Emotion constants `EMOTION_CONCEDE_WIN=0.30`, `EMOTION_CONCEDE_LOSE=-0.20`.
- [ ] 14. Move every tuned number out of code into config (D38): emotion effect per dialogue option, patience, amendment budget, the Veto Breaker cost in emotion and levels, grudge lifetime. Code keeps the defaults it has now.

## Done when

Player builds a card from intel, gets objected to deterministically, fixes things by adding intel, and lands on pass, soft pass, veto or stalemate. Same inputs, same objections, same options.
