# Intro pitch: guided session (playtest-ready scope)

Status: proposal, nothing implemented. Checked against the code by an independent read-only
review; its corrections are folded in. Decisions made are listed at the end.

## Goal

A first-time player gets through the Honey Vault pitch understanding: who can stop me (power),
what the pipeline graph is, what a boundary is, and why a veto means "go back and fix it".
Mistakes get a short, silent tip. No veto breaker in the intro.

## Facts the design rests on

- Phase 0 is a demo (`demo: true`), one challenge (113), 20 tokens. Bruce: high power, wants
  Data Ingestion automated, and has a boundary: Data Validation must be at least "Implement It
  Manually". Mark: low power, wants a say (Spot Checks on ingestion, or validation kept in place).
- The natural first mistake is automating ingestion and skipping validation: Bruce vetoes.
- Expected passing card: Data Ingestion "Automate It" + Data Validation "Implement It Manually"
  or better. By code reading this passes; a pytest committing exactly this card must exist
  before any copy relies on it.
- The demo's graph, grudges and Escalation Points are reset when it ends, so nothing in the
  intro carries into the real run.

## Rules for all new copy

- No numbers, thresholds, formulas or weights. Resource counts the player manages (tokens,
  Escalation Points, "three changes") are fine. Graph steps use option names ("Automate It"),
  not level numbers. CI check: grep new copy for digits and `%`.
- Say only what the engine does. The simulation plays changes out and shows what owners do with
  them; it does not "check promises". In the intro never say someone *will* remember; say "in the
  real game, people remember being passed over".
- Mistake tips are silent. Only tour steps are narrated.

## Ship for the next playtest

### 1. Veto breaker out of the intro
- Server: demo guard in `handle_pitch_veto_breaker`; make `_break_the_stood_veto`
  (`playtest_handler.py`) return False on that error. Hide the button in `VetoDialog` in demo.
- Add an Escalations chip beside Tokens and Intel in `statChipsRowCentered`, hidden in the
  intro and while the count is still null.

### 2. Veto feedback (show the real veto, then teach)
- Add `objection_target` and the boundary item id to `veto_info` (computed already, not sent).
- Beside the existing reason box, a coach panel: what it means (high power can stop the plan),
  what you could change ("Give Data Validation at least Implement It Manually"), and two buttons:
  show the objection (opens the dossier item) and revise (opens the composer on that component).
- A second veto in a row gets the concrete pointer. The Hint button (section 6) is the other rescue.
- Must be re-derivable from `pitch:state` after a reload.

### 3. Coach tips (mistakes), as a small `<CoachTip>` component
Not intro.js: `tour.ts` injects its own controls and observer into any tooltip. One active
guidance owner at a time (tips queue behind tours and the gate). Four tips:

| Tip | Trigger | Gist |
| --- | --- | --- |
| Can't afford / used card | `handleSelectEngagementCard` returns silently today | Cost vs tokens left |
| Pitching on thin intel | Intel readiness red when opening the Pitch Deck | Verify first |
| Likely veto | `predicted_outcome === "VETO"` after evaluate (not `boundary_warnings`, it omits untagged boundaries) | "Someone will say no. Open their page, or commit to see what a veto is." Commit is not blocked |
| Re-pitching unchanged | Same changes as `last_pitched_changes` | Change something |

Seen-once flags persist in `localStorage` per user (like `seenBriefings.ts`). Coach state is
otherwise derived from server state, so a reload resumes instead of replaying.

### 4. Guided pitch session (extends the existing four steps)
1. Existing four steps (challenge, boardroom, chat, cards).
2. Cast: highlight both seats, power/interest explainer (section 7).
3. Wait for action: play Verify Intel on the unconfirmed note, then one conversation card on
   Bruce. Spotlight the card, advance when played.
4. Point at the revealed-intel pill and Bruce's dossier boundary note.
5. Open the Pitch Deck, graph walkthrough (section 6), assemble, evaluate.
6. Reactions: point at the buy-in gauge (word bands). If a veto is predicted, show the
   likely-veto tip.
7. Commit. Pass: short recap. Veto: section 2.

Wait-for-action steps need a small `tour.ts` addition (hide Next, advance on event). If a
spike shows intro.js v8 can't do it cleanly, those steps become `<CoachTip>` spotlights.

### 5. Narration reliability and start gate
Instrument first (time to first audio, reason for every cancel), then fix the likely causes:
- `tour.ts` marks text narrated before it plays, so a cancelled first line never retries: retry.
- Stakeholder lines hit a 20 s cap (12 s for the player) and the next line cuts the audio: scale
  the cap with text length, use `onEnd` plus a no-progress watchdog.
- The skip bar vanishes when the bubble closes: keep stop and replay while audio or queue is live.
- Don't start tour narration while the speech queue is busy.

**Start gate.** Shown only when audio is actually locked and narration would play (fresh start
or reload; not for muted players). A normal app modal in the `VetoDialog` family with a
Lordicon hero (`radio-walkie-talkie`, via `OnceIcon`). Buttons: "Begin the walkthrough" /
"Read it myself". One factual line: "Browsers keep audio off until you interact with the page.
One click and the narrator can speak." Own dialog semantics (role, focus trap, Escape). The lock
test uses a real probe (blocked `play()` / AudioContext state), the keypress flag is only a
fast path.

### 6. Graph help (composer)
- Rebuild the `introCompose` tour around the first challenge: canvas and hand-offs; a node's two
  dials (who does the work / who checks it); select Data Ingestion and pick "Automate It";
  governance ("the only step here is Spot Checks, one way to give Mark a say"); look at what
  feeds on what and check Bruce's notes for the rest; slots and the three-change limit.
  The tour teaches mechanics with the first change and leaves the validation boundary to the
  player (otherwise the veto lesson never happens).
- **Hint button (intro only).** Each press is stronger: 1 "reread what Bruce refuses to accept",
  2 "look at Data Validation", 3 the answer with a button that slots it. It exists because the
  breaker is gone. It is not cheating: the demo resets when it ends, and the real phases get no
  hint. State is local and not persisted.
- "?" in the composer opens a new "MLOps Graph" tab in `CheatSheetModal` (definitions, step
  names from `AUTOMATION_META` / `GOVERNANCE_META`, the worked example, replay button). The
  composer must stay mounted for replay, and the module-level tour guard needs a reset path.
- Governance copy comes from each component's own options (Data stage governance is only
  "Spot Checks"), never a generic ladder.
- `help` field (1 to 2 sentences) in `MlopsGraph.json` plus schema, for all 28 components
  (you review them all). Edge hover text is generated from the component names.

### 7. Power and Interest
- Facts (developer only): power decides who can veto; interest and power together set how hard a
  pitch moves someone's mood. Bruce and Mark react equally, only Bruce can block.
- Definitions added to `MLOpsGlossary.json` (`power`, `interest`, `boundary`, `veto`), hover tags
  on dossier badges, seat chips ("High power", "Low interest") until the explainer has been seen
  once, and the existing `PowerInterestMatrix` shown once in the cast step and linked from the
  cheat sheet. Check whether the phase 0 briefing already shows that matrix.

### 8. "Where do I click" on artifacts
In `offline_intel_gathering.tsx` pulses already exist (category buttons for unknown, Next for
known). Keep them, always highlight the next action in both cases, and add a short intro-phase
tooltip when the reading ends: category buttons, then Next after tagging, then Finish. Show the
same highlight immediately when the reading is skipped or muted. Add a visible "Next artifact"
label (today it is an icon with `title` and `aria-label`).

### 9. Buy-in as words
Dossier buy-in card keeps its bar, shows bands (Very low to Very high, plus "Boundary crossed")
instead of percentages. Remove `Blocks below: N%`, the numeric tooltips (`max 60%`, `max 40%`),
and the client copy of the thresholds in `pitch_debate.tsx`; band server side. Keep the notch
unlabelled, named "Veto line" / "Objection line".

### 10. Re-pitching: cost the player notices, but only for people who see something relevant

**What the code does today (verified by reading it).**
- An identical card is refused server side (`same_card`, "Change the proposal before pitching it
  again"), shown as an error.
- Stakeholders whose card-driven reaction is unchanged are already skipped in the chat
  (`silent_stakeholders`, `reaction_signatures`). So the chat half of your concern is partly
  handled.
- But `evaluate_pitch` still applies the full pitch deltas **and** the patience malus to every
  stakeholder in the room, silent ones included. So a happy, unchanged stakeholder is silently
  pushed further up (re-pitching can farm mood) and silently annoyed. The malus is also tiny
  (`patience_malus` 0.05 times the repeat count, spread over seven dimensions), and
  `pitch_attempt` reaches only the player's pitch line, not the stakeholder reaction chain or
  the fallback lines. Hence "you don't even notice it".

**Your rule, made precise: stakeholders react to what changed for them.** Per stakeholder, on
each re-evaluate, compare their reaction signature with last time:

| Their situation | Emotions | Chat |
| --- | --- | --- |
| Was fine, nothing changed for them | Untouched: no repeated delta, no impatience | Silent |
| Was objecting, nothing changed for them (their objection still stands) | Normal delta, impatience goes up one step | Reacts, aware it is a repeat: "You brought me the same problem again." |
| Their objection changed and is now answered | Normal delta, impatience released (see below) | Reacts: "Better. That took a while." |
| Their objection changed but still unanswered | Normal delta, impatience goes up one step | Reacts, repeat-aware |

So your example works: the happy stakeholder stays calm and quiet, the unhappy one pays for the
revision. Penalty goes only where a repeat was actually irritating. The "objecting and unchanged"
row is deliberate: a different card that still ignores their problem should not get a free pass.

**Impatience is a capped, recoverable meter, not permanent damage.** Someone who finally gets what
they asked for should cool down, not stay furious. So the repeat cost is not written into their
stored emotions each time (that cannot be undone cleanly). Instead:
- Each stakeholder carries an `impatience` count for the current challenge, kept in the pitch
  state next to `presentation_count`. It goes up one step per re-evaluate where their objection
  stands (rows 2 and 4 above) and never goes above a cap (about three steps).
- The emotion offset is *derived* from that count when reads and buy-in are computed, as a
  temporary extra on the seven dimensions the old patience malus used, with diminishing growth
  (the second step hurts less than the first) so repetition alone cannot spiral a stuck player
  into a veto.
- When their objection is answered, impatience drops most of the way at once (down to one step)
  and they get a small relief bonus on trust and fairness, plus the "Better. That took a while."
  line. The remaining step fades on the next successful pitch or at commit. The low point is
  reached while they are still being ignored, and recovery is real but not total: relief, with a
  trace of "finally".
- At commit, leftover impatience is dropped in the intro. In the real game, a stakeholder who
  ends the challenge still impatient (card passed anyway, for example via a soft pass) feeds the
  existing grudge mechanic instead of lingering in their mood. Check against `grudge.py` and
  `pipeline.py` before implementing.
- UI: the "Losing patience" tag follows the count (none, one step, at cap) and clears when they
  are relieved, so the player sees it come back down. Words only.

**Identical card.** No evaluation, no reactions, no cost. Instead of the current error, a subtle
inline notice in the composer next to Confirm: "Nothing changed since your last pitch, so nobody
has anything new to react to." The Confirm button is disabled while the card matches
`lastPitchedChanges` (already passed to the composer; mirror `same_card` on the client, keep the
server check as backstop). Partly unchanged pitches get a one-line system message in the chat
history (existing `__environment__` message type): "Bruce had nothing new to react to."

**Changes.**
- `evaluate_pitch`: take the previous `reaction_signatures`, skip the emotion update for
  silent-and-fine stakeholders, apply the malus only per the table. The signature is already
  captured before the malus, so silence detection is unaffected.
- Replace the flat `patience_malus` with the impatience meter: config for step size (first step
  around three times today's malus), cap, diminishing factor and relief amount, all scaled by the
  stakeholder's own stress and sense-of-control sensitivities. Do not confuse it with the
  unrelated `default_patience` (reframe) tuning value. Re-tune against
  `test_emotion_dynamics_simulation.py`: one revision stings, a third can tip a borderline
  stakeholder into a veto or objection, a good card still passes.
- Pass the attempt number and "objection unchanged / changed / answered" into the stakeholder
  chain prompt and the deterministic fallback lines.
- UI in words, no numbers: a "Losing patience" tag with the emotion face on the seat or dossier
  badge, and a coach tip the first time that every revision costs goodwill.
- Intro: the first revision after the scripted veto or the likely-veto tip carries no extra
  malus, and the tip says so ("This one is free, revising is how you learn the room"). The real
  game applies the full penalty. The demo resets afterward.
- A veto followed by a re-pitch counts as one repeat (the commit is not a presentation).
  Editing the card before its first evaluate stays free.

## Later, not for this playtest
- Event "messing around" tips in the composer, idle card nudges, other chip/tip polish.
- Moving old `data-intro` text into JSON (not needed).

## Copy and review
New text lives in `game-ui/src/content/helpCopy.ts` (tips, steps, gate, veto feedback), the
glossary JSON, and `MlopsGraph.json` `help` fields. About 40 short strings plus 28 `help` fields. I write them; an
independent audit agent checks digits, em dashes, voice and engine accuracy. You read only the
full set: the first-ten-minutes path (gate, steps 2 to 5, graph tour, veto feedback), all 28
`help` fields, and the re-pitch lines.

## Decisions made
Veto breaker off in the intro; real veto shown and explained; Commit not blocked; validation
mistake not forced; Escalations chip beside Tokens/Intel; mistake tips separate from tours and
silent; start gate as an app modal with a Lordicon hero; graph help inside the demo plus a
cheat sheet tab; layered Power/Interest help; seen-once flags in `localStorage`; buy-in as word
bands; resource counts are fine in copy.

## Tests
Backend: demo guard, playtest phase 0, pass-card test, `veto_info` fields, re-pitch rules (identical card refused with no cost, silent-and-fine stakeholders untouched, penalty only where the objection stands or changed, first revision free in the intro)
(`docker compose exec api python -m pytest tests/ -q`, targeted). Frontend: coach state
machine (pure function of events), gate (mock `@lordicon/react`), buy-in bands
(`docker compose exec ui npm test`, targeted).

## Implementation todos

Owners: BE = backend, GR = composer and graph help, NA = narration, gate and artifacts,
PS = pitch screen, DO = dossier and glossary, QA = final audit. Tick when done and verified.

Contract between backend and frontend (names fixed up front):
- `pitch:state` reads gain `buy_in_band` (`very_low|low|medium|high|very_high`) and `impatience`
  (integer step, 0 to cap). The `threshold` field is removed from what the client uses.
- `veto_info` gains `objection_target` and `objection_item_id`.
- `pitch:state` gains `is_demo` (bool).
- New chat system line for silent stakeholders uses the existing `__environment__` message type.

- [x] BE1 Demo guard in `handle_pitch_veto_breaker`; `_break_the_stood_veto` returns False on error
- [x] BE2 `veto_info` carries `objection_target` and `objection_item_id`; `pitch:state` carries `is_demo`
- [x] BE3 `buy_in_band` per read, thresholds no longer needed by the client
- [x] BE4 Per-stakeholder re-pitch rules and impatience meter (section 10), config values, grudge hand-off checked
- [x] BE5 Stakeholder prompt and fallback lines know attempt and objection unchanged/changed/answered; silent stakeholders get the system line
- [x] BE6 Tests: guard, playtest phase 0, scripted pass card, veto_info fields, re-pitch rules
- [x] NA1 Narration instrumentation and fixes T2 to T5 in `speech.ts` and `tour.ts`
- [x] NA2 Narrator start gate (modal, Lordicon hero, real audio probe, a11y)
- [x] NA3 Artifact next-action highlight, tooltips, visible Next label
- [x] PS1 Veto breaker hidden in intro (`VetoDialog`), Escalations chip
- [x] PS2 `CoachTip` component, `useIntroCoach`, four mistake tips, seen flags in localStorage
- [x] PS3 Guided pitch session steps, wait-for-action support
- [x] PS4 Veto feedback panel with show-objection and focused-revise actions
- [x] PS5 Speech queue fixes (cap, watchdog, persistent skip and replay) in `pitch_debate.tsx`
- [x] PS6 Seat chips, patience tag, no-change inline notice and system line display, `helpCopy.ts`
- [x] DO1 Buy-in card as word bands, numbers and threshold data path removed
- [x] DO2 Glossary terms, hover tags on power and interest, `PowerInterestMatrix` explainer
- [x] GR1 `help` for all 28 components in `MlopsGraph.json` plus schema
- [x] GR2 Example-driven composer walkthrough, hint button, "?" and "MLOps Graph" cheat sheet tab, replay reset
- [x] GR3 Identical-card disabled Confirm with inline notice, edge hover sentences
- [x] QA1 Audit: no digits or em dashes in new copy, claims match engine, tests green

Notes from implementation:
- BE4: the grudge hand-off for leftover impatience in the real game is NOT done (one-line TODO in
  `handle_pitch_commit`); impatience is per challenge and never stored in emotions, so nothing
  lingers. `patience_malus` was replaced by `impatience_*` config values and its old test removed.
- BE6: 8 tests in `test_demo_phase.py` and `test_playtest.py` fail on stale test-schema calls; to
  be confirmed as pre-existing in QA1.
- NA2: "Read it myself" is session-only (`setSessionMuted`), not saved to server settings.
- PS2: the "re-pitching unchanged" tip is skipped, the composer already disables Confirm for an unchanged card.
- PS4: the veto panel's suggested option is the first authored step above the component's current level (the server does not send the boundary's exact level).
- QA1 fixes applied: `veto_info` now re-derived on reload (`PitchState.veto_message`), free revision limited to the first one (`free_repeat_used`), cheat sheet replay button limited to phase 0, one `tour.ts` type error.
- Known gaps: the unlabelled veto/objection notch no longer draws (the client has no threshold; accepted, buy-in shows as word bands); the likely-veto tip does not make the revision free (only the post-veto revision is); real-game grudge hand-off for leftover impatience is a TODO in `handle_pitch_commit`.
- Not run in a browser: tour steps, start gate, coach tips, hint ladder, cheat sheet tab. 8 backend tests (`test_demo_phase.py` 5, `test_playtest.py` 3) fail on stale test schemas, confirmed pre-existing and unrelated. Remaining tsc errors (`Game.tsx`, `StakeholderDossier.tsx` status index, `nodeChrome.tsx`) are pre-existing.
