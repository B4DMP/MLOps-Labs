# 11 Dialogue and the Event Log

Depends: [04](04-content-pipeline.md), [06](06-merged-phase.md), [07](07-simulation-phase.md). Tracked in [STATE.md](STATE.md).

Plan 06 deleted the randomized dialogue options and left three steps of the merged phase without
dialogue. Gather is a hand of cards that reveal silently, Build your case is solo work, and Face the
room has five mechanical buttons. The GDD's Intel-Based Questions went with them, and so did the
only way a note becomes **Inferred**.

This plan brings dialogue back into all three steps, and adds a log that says what every change
was caused by. Decisions D47 to D52.

## Rules

- **Options are a pure function** of what the player holds and did. Same inputs, same options, in
  the same order. No `random.sample` anywhere in this plan's paths.
- **The outcome is decided before anything is said.** The LLM voices the player's line and the
  stakeholder's reaction from the decided outcome. It never decides one (standing rule in STATE).
- **Compromises are built from intel.** Cite Evidence, Defer and Trade stay rejected
  ([BACKLOG.md](BACKLOG.md#rejected)).
- **No meeting clock.** Attention tokens are the budget in Gather.
- **Every change leaves an event with a cause.** Nothing moves emotion, patience, confidence,
  tokens, the card or the graph without one.

## The event log (D51)

One record for everything that happens in a game, with a cause the player can read.

```python
class GameEvent(BaseModel):
    seq: int                   # per user, monotonic
    phase_id: int
    challenge_id: int
    step: Literal["offline", "gather", "build", "object", "commit", "simulation", "gate"]
    kind: Literal["emotion", "patience", "intel", "archetype", "tokens", "escalation",
                  "card", "objection", "outcome", "grudge", "graph", "metric"]
    subject_id: str | None     # stakeholder, item, or graph target
    direction: Literal["up", "down", "none"]
    magnitude: Literal["slight", "clear", "large"] | None
    cause: str                 # code from gameConfig/EventCauses.json
    params: dict               # names for the cause template, never numbers
    refs: dict                 # objection_id, item_id, graph_op_seq, turn_id
```

- **Pure functions return events.** `_bump` and every other change point in `session.py`,
  `plan_engagement`, the pipeline and the gate return `list[GameEvent]` next to their result. The
  totals the game already keeps (`emotion_deltas`, `patience`) are derived from those events.
- **Causes are templates, not LLM text.** `gameConfig/EventCauses.json` maps a code to a sentence
  and a group: `emotion.reframe_hit` reads "warmer: you put it the way {st} thinks about it".
  A reason has to be true every time.
- **Words, not numbers.** Magnitude buckets live in config. The log must never show more than the
  risk read does (exact buy-in only for a correctly tagged Language, plan 06).
- **Fog holds.** A graph event names a target only if the player has observed it, otherwise the
  stage: "something in Monitoring got worse". Graph events point at `GraphOpLog.seq` instead of
  copying the op.
- **No tag leaks.** Tagging in offline gathering logs that a note was filed, never whether the
  tag was right.
- **Persisted** in a `game_event` table (migration), sent as `log:events` when they happen and
  `log:history` on load.

### What gets logged

| step | events |
|---|---|
| offline | artifact filed, archetype tagged, note verified (tokens spent, corrected or confirmed), Facts observed on leaving |
| gather | card played and tokens spent, each turn asked, note revealed, hypothesis Inferred or Refuted, archetype matched or ruled out, gist heard, turns lost on leaving |
| build | items set and removed, opener chosen, stakeholder sounded out (patience, their reply) |
| object | objection raised, each answer, every emotion change including the room listening, amendment, Escalation Point spent, notes verified by being said aloud |
| commit | outcome, Veto Breaker, Rebuild (patience), Let them have it, stalemate |
| simulation | graph changes (fog aware), metric moves, grudges written and fired |
| gate | Gate 7 path and its reasons |

### UI

- **`EventLog.tsx`** below Conversation history in the pitch phase, and the same component in
  offline gathering and the simulation report. Collapsed by default, grouped by action or turn,
  filters: People, Intel, Card, System.
- **Seat tags** show the latest cause per stakeholder: "colder: that argument doesn't speak to her".
  Replaces the bare warmer / colder tag at `pitch_phase.tsx` seats.
- **Patience in words (D50).** No pips. Full shows nothing, one step down shows **impatient**, the
  last point shows **at their limit**, each with its cause.

## Gather: cards buy conversations (D49)

A stakeholder card buys a fixed number of **turns** per target. Each turn the player picks one
option. Turns not used are lost when the conversation closes. Verify Intel Item stays as it is.

| card | cost | targets | turns per target | extra |
|---|---|---|---|---|
| `eng_1` 1-on-1 Deep Dive | 4 | 1 | 3 | the 1-on-1 template |
| `eng_2` Probe Requirements | 3 | 2 | 1 | open questions reveal Boundaries only |
| `eng_3` Team Sync-up | 2 | whole room | 1 | |
| `eng_4` Ask Generic Question | 1 | 1 | 1 | |

`intel_reveal_count` becomes `turns` in `GameEngagementCards.json`. Numbers are config (D38).

### Options per turn

| option | available | effect |
|---|---|---|
| **Open question** | the stakeholder has notes not found yet, in the card's allowed tags | reveals the next one in stable order, **Verified** as today |
| **Test a hypothesis** | one per held Unconfirmed note on this stakeholder, filtered by the player's own tag, up to 3 in stable order | tag right: **Inferred**, they add a detail. Tag wrong: **Refuted**, trust down, free re-tag, conversation continues |
| **Generic question** | always | the gist of their next undiscovered note, any tag. Nothing enters the dossier |
| **Trial Balloon** | the stakeholder's archetype is not verified | pick one archetype, they react warm or cold. A match verifies the tag, a miss rules that archetype out (struck through in the re-tag picker) |
| **1-on-1 template** | Deep Dive only, needs one Boundary and one Trade-off or Driver held on them | "I understand [A]. If we guarantee [B], would that work for you?" A right pair verifies both. A wrong pair is a trust hit |

- Stable order replaces `random.sample` in `plan_engagement`: `stable_rank` over
  (user, challenge, card play count, item id), the same helper the pipeline uses.
- Refuted is visible in three places: seat tag, a Refuted stamp with the re-tag control on the
  dossier note, and a log entry. Refuting never shows the true tag.
- Trial Balloon closes open item 4 of [engagement-cards.md](../engagement-cards.md).

## Gists (D52)

A gist says what a note is about, never how much they care: "monitoring keeps coming up whenever
you talk to her".

- **New stage `gists`** after `items` in `content_gen/stages`. It depends on items only, so no
  existing item, artifact or objection goes stale.
- Output per stance item: `gist`, 8 to 25 words, third person, names the topic in player words.
- **Gate, the blind reader reversed.** A second call sees only the gist and answers two things:
  which metric it is about (must match), and which of the four readings it commits to, with
  "none" allowed (must be "none"). Plus `player_text_errors`, `GAME_WORDS` and `STANCE_WORDS`.
- Same runner and ledger: resumable, cancellable, `unstick`, `review`, `approve`, `freeze`.
- **Minimal first.** New scope `dialogue0`: the tier 0 templates only. More scopes later with the
  same stage.
- **Runtime fallback** for an item without a gist: a template from its metric name ("{st} keeps
  bringing up data quality"). The game runs before the content does.
- `make content-run-gists` and `content-validate-dialogue0`; CI validates the scope.

## Build your case (D48, D50)

- **Opener.** The convincer select becomes 2 to 4 opening lines, one per archetype the player
  has tagged for the room, plus "any other" for the rest. The chosen line is `main_archetype`;
  a second line is `secondary_archetype`. Scoring unchanged.
- **Sound someone out.** Pick a stakeholder in the room. They react to the draft card.
  - Reply is decided from the scoring they would have if the card were committed now: on board,
    lukewarm, or would object, plus the objection kind if one would fire. No text of the objection,
    no numbers.
  - Costs 1 patience from that stakeholder. Not available at their last point, so sounding out
    alone never causes a stalemate.
- **Patience default 3** (D50), moved from `DEFAULT_PATIENCE` into the pitch tuning config.

## Face the room (D47, D48)

| option | as dialogue | mechanics |
|---|---|---|
| **Amend** | one line per answering item: "You're right, we'll make sure the audit trail is kept." | unchanged |
| **Reframe** | one line per archetype, the tagged one for this stakeholder marked "how you think they like it" | fit of this stakeholder against the chosen archetype decides the result, below |
| **Stonewall** | one voiced line | unchanged |
| **Emergency Addendum** | one voiced line | unchanged |
| **Concede Correction** | one voiced line | unchanged |

### Reframe results

```python
f = fit(st.archetype, chosen)             # no secondary for a single answer
HIT if f >= REFRAME_HIT else PARTIAL if f >= REFRAME_PARTIAL else MISS
```

| result | stance objection | other kinds | emotion |
|---|---|---|---|
| Direct Hit | cleared | stays | up |
| Partial | cleared | stays | none |
| Miss | **hardened**: from now on only Amend clears it | stays | down |

**The room is listening.** Every other high power stakeholder in the room with
`fit(other, chosen) < ROOM_LISTEN` takes a slight emotion hit: "colder: you pitched it in terms
that don't speak to him". Deterministic, same distance function.

`_verify_heard` stays: an answered objection verifies its note and the stakeholder's archetype.
So after one Reframe on a stakeholder, their archetype is known. That is the lesson paying off.

## LLM voicing

- Player line: `get_player_utterance_chain` gets the chosen option, the item or archetype, and
  the objection or question.
- Stakeholder line: the response node gets the decided outcome (revealed text, Inferred or Refuted,
  hit, partial or miss, warm or cold) and the cause. It voices it in their archetype's style.
- A failed LLM call falls back to a template line. Mechanics never wait on it.
- Both lines go to Conversation history; the effects go to the log.

## Deleted

`determine_dialogue_options`, `DialogueOption` and the `dialogue_options` LangGraph channel,
`get_checkpoint_dialogue_options` and `save_checkpoint_dialogue_options`, `corporate_noise_rules`
in `EmotionValueConfig.json`, the old options grid in `StakeholderInteractionArea.tsx`,
`game-ui/src/types/DialogueOption.ts`.

## Steps

- [x] 1. `GameEvent` model, `game_event` table and migration, `EventCauses.json` with a load-time check that every cause code used in code exists, `event_log` store, `log:events` and `log:history`. Tested.
- [x] 2. `EventLog.tsx`: grouping, filters, collapsed by default. Placed in the pitch phase.
- [x] 3. Pitch session emits events: `_bump` and every emotion and patience change return events, totals derived from them. Seat tags with causes, patience in words, default patience 3 in config. Tested.
- [x] 4. Face the room: Amend as one line per item, Reframe per archetype with Hit, Partial, Miss and hardening, room listening. Tuning keys `reframe_hit`, `reframe_partial`, `room_listen` and the emotion per result. Tested.
- [x] 5. Voicing for Face the room answers, with template fallback.
- [x] 6. Gather conversations, backend: `turns` on cards, `gather_options_for` pure, stable order in `plan_engagement`, `gather:open`, `gather:ask`, `gather:close` events, Inferred and Refuted, Trial Balloon with ruled-out archetypes, the 1-on-1 template. Tested.
- [x] 7. Gather conversations, frontend: conversation panel per card play, turns left, Refuted stamp and re-tag on the dossier note.
- [x] 8. Gists: `gists` stage, reversed blind gate, `dialogue0` scope, assemble writes `gist` on items, runtime fallback, Makefile targets, CI validate. Run on `dialogue0`.
- [x] 9. Build your case: opener lines, sound someone out with patience cost and decided reply. Tested.
- [x] 10. Log emitters for offline gathering, the simulation pipeline and Gate 7. `EventLog.tsx` on those screens.
- [ ] 11. Delete the dead dialogue code listed above. Scoped out into
      [12-cme-dialogue-cleanup.md](12-cme-dialogue-cleanup.md) (bigger than this list once the
      call graph was actually audited) - check this step off when that plan is done.
- [ ] 12. Playtest a full challenge with the log open. Tune the numbers in config (D38).

## Done when

Every step of the pitch phase is a conversation built from the player's intel, the same inputs give
the same options, a note can become Inferred or Refuted by using it, and every change in the game
has a log entry with a true, readable cause that respects fog and the risk read.
