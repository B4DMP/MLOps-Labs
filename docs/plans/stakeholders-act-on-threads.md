# Stakeholders act on the threads the player found

Status: proposed, nothing built.

## Goal

Confirmed case board threads change what the player sees in the pitch (composer chips, the ally
lift), but the stakeholders never mention each other. The player finds "Monica and Dave are allies",
pitches, and the room reacts as if the board did not exist. Give a confirmed thread a payoff the
player can see and hear:

1. **Voice:** a stakeholder's spoken reply names the other person when a confirmed thread bears on
   what they are saying.
2. **Reaction card:** the same fact shows as one short line on the stakeholder's reaction in the
   pitch, so it is visible even with narration off.

## What this is not

- **No new effects.** Scoring, the ally lift and the objection logic stay exactly as in
  [case-board.md](case-board.md) D3. This plan only reports what the engine already does.
- **Confirmed threads only.** A thread the player has not confirmed is never mentioned, so the
  stakeholders cannot leak the answer key. Same rule as D3.
- **No stakeholder acts between rounds** (lobbying, escalating rifts, withdrawing support). That
  needs a stance model and fires on unconfirmed threads, which undoes the "Stakeholder alliances"
  cut recorded in [graph-redesign/BACKLOG.md](graph-redesign/BACKLOG.md). Separate plan, only if
  playtests show the board feels inert.
- **No new dialogue generation path.** The existing per-stakeholder reply call gets one more fact.

## Facts this rests on

Checked against the code on 2026-10-10.

- `pitch_markers(user_id, challenge)` in `application/case_board_service/context.py` returns the
  confirmed `Relation`s. `pitch_handler.py` already passes them to `evaluate_pitch` as
  `confirmed_relations`.
- `evaluate_pitch` (`pitch_debate_service/session.py`, ally block near line 1102) computes
  `ally_lifts` (`{lifted_id: [backer_id]}`), stored on `PitchState`. The handler turns it into a
  log event with cause `emotion.ally_backed` (`gameConfig/EventCauses.json`). Nothing else uses it.
- The handler builds one dict per stakeholder in `stakeholders_ctx_list`
  (`pitch_handler.py` near line 567), including `repeat_context`. `action_card_pitch_service/nodes.py`
  passes it into the reply chain, and `domain/prompts.py` renders it in a
  `{% if repeat_context == ... %}` block. `action_card_pitch_service/service.py` has fixed fallback
  lines for when the LLM call fails.
- Reads reach the UI as `pitchState.reads`. `pitch_debate.tsx` hides a read until that stakeholder
  has spoken in the pitch (`isReadRevealed`), so a thread line must follow the same gate or it
  spoils the reply.
- Relation fields: `kind`, `a`, `b`, `target`, `via` (chain), item ids per side. A chain is ordered:
  `a` waits on `b`.

## Design

### D1 One thread hint per stakeholder per pitch

A pure function `thread_hints(confirmed_relations, reads, objections, ally_lifts, room_ids, names)`
returns at most one hint per stakeholder. One keeps the reply short and stops it turning into a
lecture. Hint shape: `{kind, other_id, other_name, target, relation_id}`.

Selection, first match wins, deterministic order (sorted by relation id):

| kind | stakeholder who speaks | condition | what the hint says |
|---|---|---|---|
| ally | the one who got the lift (`ally_lifts` key) | the backer is in the room | the backer asked for the same thing, which is why they are warmer |
| rift | one whose primary objection target equals `rel.target` | the other side is in the room | their ask clashes with the other person's on that target |
| chain | `rel.a` (the one waiting) | their primary objection target equals `rel.target` or `rel.via` | they cannot move until the other person's step is in |
| step | none | | no voice, no line. It has no effect to report |

Rules that keep it honest:

- A hint exists only when the engine did something or the objection is really about that target. No
  decorative mentions.
- Quiet stakeholders (`quiet_stakeholders`) get no hint, as they get no reaction.
- If two relations qualify, the ally lift wins (it changed a number), then rift, then chain.

### D2 Voice (item 1)

- `thread_hint` is added to each stakeholder dict in `stakeholders_ctx_list` and passed through
  `nodes.py` like `repeat_context`.
- `domain/prompts.py`: a `{% if thread_hint %}` block next to the `repeat_context` block. It states
  the fact in plain words, tells the stakeholder to mention the other person by first name in one
  clause, and to keep their own objection or approval unchanged. It must not invent a position for
  the other person beyond what the hint says.
- Fallback lines in `action_card_pitch_service/service.py` get one template per kind, used only when
  the LLM call fails (for example "{other} wants the same thing, so I am with you on this").
- The stakeholder's verdict, buy-in and objection come from the engine as today. The prompt change
  only adds a clause to the wording.

### D3 Reaction card line (item 2)

- `PitchState` read payload gets `thread_note: {kind, other_id, other_name, target} | null`, built
  from the same hint as D2 so the spoken line and the card line never disagree.
- `pitch_debate.tsx` shows it on the stakeholder's reaction, gated by `isRevealed`:
  - ally: "Warmer: {other} backed the same ask" (the existing `emotion.ally_backed` wording,
    shortened).
  - rift: "At odds with {other} on {target}".
  - chain: a small "Waiting on {other}" badge, cleared on the next pitch where `other` is agreeing.
- The other person's portrait is highlighted on hover of the line, reusing the thread colour from
  `CaseBoard.tsx` so it reads as the same thread the player pinned.
- Copy follows `docs/gameplay-flow.md` rules: no numbers beyond resource counts, say only what the
  engine does, no em dashes. Tag names stay "Same direction", "At odds", "Depends on".
- Respects `prefers-reduced-motion`; no animation is needed for the first version.

### D4 Debug and logging

- A hint adds a log cause so the event log explains it: reuse `emotion.ally_backed` for ally, add
  `pitch.thread_rift` and `pitch.thread_chain` in `EventCauses.json` (group `pitch`).
- Debug mode already shows the answer key; no change.

## Steps

- [ ] 1. `pitch_debate_service/thread_hints.py`: pure `thread_hints`, plus `tests/test_thread_hints.py`
      (ordering, one per stakeholder, ally beats rift beats chain, unconfirmed and quiet get none,
      step gives none, deterministic).
- [ ] 2. Pass the hint through `pitch_handler.py` into `stakeholders_ctx_list`, `nodes.py` and the
      prompt block, plus fallback lines. Test the prompt rendering with and without a hint, and the
      fallback path, in `tests/test_action_card_pitch_service.py`.
- [ ] 3. `thread_note` on the read payload, new log causes, `tests/test_pitch_session.py` for ally
      lift parity (hint present exactly when `ally_lifts` has the key).
- [ ] 4. `pitch_debate.tsx` line and badge, gated like reads, with a component test for each kind
      and for the hidden-until-spoken case.
- [ ] 5. Docs: `docs/gameplay-flow.md` (pitch step and the case board effects paragraph), tick the
      "no new dialogue path" note here, move this plan's status to implemented.
- [ ] 6. Playtest: do players notice the line, and does naming the partner make the board feel
      worth filling in.

## Tests

Backend, in `game-api/tests`, run with `-m "not db"` before pushing (CI has no Postgres). All of the
above are pure or use in-memory stores, so none should need the `db` mark. Verify:

```
docker compose exec api python -m pytest tests/test_thread_hints.py tests/test_pitch_session.py tests/test_action_card_pitch_service.py -m "not db" -q
```

Frontend: `docker compose exec ui npm test -- pitch_debate`. No new third-party library, so nothing
new to stub in `src/setupTests.ts`.

## Risks

- **Prompt drift.** The LLM may add claims about the other person. Mitigation: the prompt states
  the single fact and forbids more; the card line (D3) is generated from the hint, not from the
  reply, so the UI never depends on the model's wording.
- **Spoiling an unconfirmed relation.** Mitigation: hints are built only from `pitch_markers`
  output, which is confirmed threads. Add a test with an unconfirmed ally pair that is pitched
  anyway and expect no hint.
- **Noise.** With four threads and a five person room, every reply could name someone. The one
  hint per stakeholder rule and the "engine did something or the objection is about it" condition
  bound this. Revisit the thresholds after the playtest.
- **Content regeneration** changes relations, but hints are derived at pitch time from the current
  relations, so nothing is stored that can go stale.
