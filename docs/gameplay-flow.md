# Gameplay flow (read this before touching any screen)

Paths: UI = `game-ui/src`, API = `game-api/src/mlops_serious_game`. Written from reading the code,
not from playing it. Update it when the flow changes.

## One-line loop

Register/Login -> intro briefing -> [per challenge: phase briefing -> offline intel -> pitch ->
(veto -> revise) -> simulation] -> next challenge, or Results.

## How screens are chosen

No router. `App.tsx` picks login/register/verify/game with booleans; identity is an httpOnly
cookie (`mlops_player`), the websocket authenticates from it. The URL is telemetry only.
Resume position is **server side only**: `handle_game_init` (`game_handler.py`) reads the run's max
`game_progress_index` and the latest `GameChallenge` row.

`Game.tsx` renders by `progressionIndex`: null = loading, 0 intro questionnaire, 1 briefing
(demo briefing if `hasIntroPhase`), 2 real briefing then gameplay, 3 outro questionnaire,
4 `ResultsScreen`. Inside gameplay `challengeLoopId` picks the view: **0 offline intel, 1 and 2
pitch (one screen), 3 simulation**. `PrePhaseDialog` is an overlay opened when `challengeLoopId`
is 0 and the `phase:challenge` key changed (skipped if `seenBriefings` has it).

**View as player (admin):** the Admin players table has a "View as" button. It sets an
`mlops_impersonate` cookie (valid only while the admin cookie is) and opens `Game` for that player
with a bottom banner and Exit. The websocket is read-only for it: only the load events in
`READ_ONLY_EVENTS` (`websocket/router.py`; `board:get` is in it, `board:connect` is not) run, every action gets `system:read_only`. The load
events still write idempotently (`game:init` creates the session row, offline intel loads on-record
items), and the simulation screen shows no report because `simulation:run` is an action. Profile
routes (`get_current_player`) refuse while it is active.

**Loop index quirk:** the client sends its *current* index in `game:state_update_request`, the
server adds 1. Offline intel Continue sends 0 (server stores 1 = pitch), pitch end sends 2 (stores
3 = simulation), simulation Continue sends 3 (stores 4 = "next challenge or end").

## Steps

1. **Register / Login** (`Register.tsx`, `Login.tsx`, calls in `App.tsx`, `routes/auth_routes.py`).
   Register collects email, password, campaign key, mute and voice gender; email verification
   unless the campaign skips it.
2. **Intro briefing** (`BriefingPage.tsx`): hard-coded Honey Vault `DEMO_BRIEFING` when
   `hasIntroPhase`, else the backend briefing. Continue sends `game:progress_update` value 2.
3. **Phase briefing** (`PrePhaseDialog.tsx`): phase intro, challenge card, `PowerInterestMatrix`
   (radar) with each newcomer's self-introduction. Phase 0 order: `intro2` tour, then narration of
   phase and challenge, then introductions, then the Enter button is nudged. Closing it reveals
   the already-mounted offline intel screen. Review reopen (from the dossier) is a modal with no
   narration. This is where Power and Interest are first explained.
4. **Offline intel** (`offline_intel_gathering.tsx`, dossier left, `IntelArtifactViewer.tsx`):
   deck = on-record cards first (1 challenge Fact + the conflict stakeholders' positions,
   normally 3), then up to 3 stance artifacts to tag as driver / boundary / trade-off
   (`MAX_STANCE_ARTIFACTS`, `intel_handler.py`). Known cards cannot be tagged. Continue to the
   Pitch appears only when every non-known card is tagged. Events: `intel:get_offline_artifacts`,
   `intel:tag_item`, `intel:get_dossier`.
   - The dossier's Challenge-Intel page opens with a "What they want" ledger: one row per confirmed
     or on-record stakeholder note (`utils/confirmedIntel.ts`). Unconfirmed notes never appear;
     clicking a row opens that stakeholder's page. It is an `introDossier` tour step (shares
     `data-step="4"` with the notes, after them in the DOM), so it is only highlighted when the
     tour starts with the dossier on the Challenge-Intel page.
   - Progressive disclosure: any intel item whose graph target is an edge (`is_edge_requirement`,
     `intel_handler.py`) is left out of the deck, the dossier, every Gather/online-intel reveal, and
     pitch scoring itself on a player's first playthrough (`is_first_playthrough`, `run_index == 1`)
     - a new player only has to read intel about components, and cannot be vetoed or marked down
     over a hand-off requirement they were never shown. It starts counting again, display and
     scoring both, from the second playthrough on. `PitchContext.all_intel`
     (`pitch_handler.py`, the single source buy-in, boundary checks and veto reasoning all read
     from) is filtered with `filter_edge_intel` at construction time, so this one gate covers the
     whole pitch phase instead of each caller re-checking it. A Fact about what the challenge's
     opening event broke is exempt (`_is_incident_fact`) and is always on record at the start, even
     when it is a hand-off: the player can always read what happened.
   - **Board tab** (`CaseBoard.tsx`, `useCaseBoard.ts`, backend `case_board_service/`): the last tab of
     the dossier, shown when the room has 3 or more stakeholders and not in the demo. This is where
     the player first ties two people together as allies (pushing the same way on one step), a rift (opposite asks) or a
     chain (one waits on the other) or a shared step (different asks on one step), by dragging between portraits or picking two with the
     keyboard. The challenge's own conflict (its rift) is already on the record, so it is pinned for free
     once both sides are verified. A thread can only be found from **verified** notes on both sides, so unconfirmed
     notes offer nothing and the board never shows more than the dossier does. A wrong kind or an
     empty pair costs one of 5 guesses (`case_board_attempts`); a pair the player cannot yet judge
     is free. A found thread opens its file under the board: what it changes in the pitch, and the
     player's own notes behind it (icon, status, a link to the stakeholder's dossier page). Events:
     `board:get` / `board:state`, `board:connect` / `board:result`, `board:pencil`. Under the cork the
     board shows the same "What they want" summary as Challenge-Intel, in a compact form: one line per
     note that opens over the rows below on hover (an overlay, so the list never shifts under the
     cursor), a column with the icon of the graph step the note is about, and a pencil box per note.
     The boxes are the player's own marks (stored per challenge, `case_board.penciled`) for "my pitch
     covers this"; nothing reads them, and a one-time hint on the board says so. Picking a thread
     narrows the summary to its notes; hovering a person on the board lights their rows and the
     other way round. Hovering a thread tag lights its notes in the thread's colour, and the pitch
     composer lights the same notes (and the board lights what the composer hovers). With the dossier debug flag the
     state also carries an answer key of every thread. Team Sync-Up also marks one pair that has a
     thread, never its kind.
     Effects: a confirmed ally warms the one they back when the backer agrees in a pitch
     (`ally_lift`, once per pitch); a rift a Trade-off can settle shows as a compromise pair on the
     composer's notes, and a confirmed ally shows a "pushing the same way as X" chip on both notes; a chain shows "after X's step" on the dependent slot; a shared step shows
     "shared by X and Y" on slots for that target. Plan:
     `docs/plans/case-board.md`. Code: `CaseBoard.tsx` (the board), `ConfirmedSummary.tsx` (the table, used by
     Challenge-Intel and, compact, by the board), `CaseBoardTab.tsx` (the tab and the portraits),
     `useCaseBoard.ts` and `useGraphTargets.ts`.
5. **Pitch** (`pitch_debate.tsx`): dossier left; right column = boardroom table (stakeholder
   seats, Pitch Deck plaque, stat chips), the conversation history (`conversationHistory/`), engagement card
   shelf.
   - Conversation history (`conversationHistory/ConversationHistory.tsx`): a transcript on the room's
     glass, one folder tab per conversation (pitch, each card played, verification). Each stakeholder
     line is a bubble tinted with their colour, avatar on its corner, name, role, mood, and a play
     button that reads it aloud. Intel a line reveals is a chip under it (type icon and colour as in
     the dossier, Verified or Corrected); clicking it opens that note in the dossier. The player's
     own moves and system messages are centred lines ("You played Team Sync-Up"). On the pitch tab
     a band above the transcript shows the pitched proposal and one chip per stakeholder (waiting,
     backs it, pushback, objection); their last reply carries the same Pushback or Objection tag. It
     scrolls vertically, never sideways, and follows the newest line. Plan:
     `docs/plans/conversation-history.md`.
   - Cards (`GameEngagementCards.json`): Verify Intel (`intel:verify_item`), 1-to-1, Probe,
     Team Sync-Up, Generic Question (`gather:open/ask/close`). attention tokens per challenge (`attention_tokens` in `GameProgression.json`: 20 in the practice round, 15 in phases 1-2, 12 in phases 3-5).
   - Pitch Deck opens `ComposeActionProposalModal.tsx`: graph of components and edges, two axes
     (automation, governance), max 4 changes, only allowed targets of the phase stage.
     Layout: a corkboard canvas (nodes are index cards pinned to it, a brown title bar that takes a colour only when something is wrong) and a paper sidebar. The sidebar
     shows, for the selected target: owner avatar, first sentence of its help text, a chip row
     (automation and governance pips, and whether anything upstream holds it back), its notes as
     one-line ledger rows, then one rung ladder per axis (the next step has the Add button; a step's
     description is in its tooltip), and the proposal as one-line tickets at the foot. Hovering a
     note in the dossier lifts its node (grow and shadow, a broken node keeps glitching) and marks
     the stage tab when the node is on another stage. Confirming stamps "PROPOSED" before closing.
     Plan: `docs/plans/composer-redesign.md`.
   - Stages `PREPARE -> PITCHED -> DONE`. Events: `pitch:state`, `pitch:evaluate` (stakeholders
     react, no commit), `pitch:commit`, `pitch:veto_breaker`.
6. **Outcome** (`scoring.py`): VETO if a high-power stakeholder has a violated boundary or low
   buy-in; SOFT_PASS if only a low-power one objects; else PASS. VETO opens `VetoDialog.tsx`
   (revise; Push It Through with an Escalation Point, 3 per run; or Table It, which ends the
   challenge in a stalemate with nothing agreed and costs no point. None of the last two in the
   intro). The dialog also says what a card search found for the room (`pitch:room_ceiling`): a
   clean pass exists, only a reluctant yes does, or nothing found. PASS and
   SOFT_PASS auto-continue to `ac_simulation.tsx` (`simulation:run`, idempotent per challenge):
   changes are applied, owners with low buy-in degrade them, grudges fire (a grudge whose owner is
   satisfied by this pitch is cleared instead, "make amends"), the debrief is shown.
7. **Next**: every stakeholder's emotions recover a quarter of the way back to neutral
   (`challenge_recovery`) as the new challenge's row is created. The *server* picks (`select_next_challenge`, `graph_service/scheduler.py`); the UI
   just reacts to `game:state_update` (back to step 3) or `game:progress_change` (outro
   questionnaire, then `ResultsScreen`: four pillars, grade, epilogue).

## Phase 0 (demo)

`demo: true` in `gameConfig/GameProgression.json`, one challenge (Honey Vault, Bruce and Mark).
UI-only extras key off `currentPhase === 0`: tours `intro2`, `introDossier`, `introPitch`, a composer
guide (`CoachTip` hints, was the `introCompose` tour), intel next-action hints, coach tips, graph hint button. Backend uses
`PhaseFactory.demo_phase_ids()` / `is_demo`. When it ends the graph, metrics, escalation points
and grudges are reset (`_reset_run_session`), the first real briefing shows a "practice round is
over" alert.

## Where things live

- Narration: `utils/speech.ts` (one global arbiter, instrumentation, session mute), start gate
  `NarratorGate.tsx`. Engagement card dialogs are silent; chat replies are narrated by `pitch_debate.tsx`. Tours: `utils/tour.ts` (intro.js, group by `data-intro-group`). Tips:
  `CoachTip.tsx` + `useIntroCoach.ts` (silent, seen-flags in localStorage per user).
- Copy: `content/helpCopy.ts`, `content/graphHelp.ts`, `help` per component in
  `gameConfig/MlopsGraph.json`, glossaries in `gameConfig/*Glossary.json`.
- Re-pitch rules and impatience: `pitch_debate_service/session.py`; config in
  `EmotionValueConfig.json` (`impatience_*`).
- Plan and history of the intro work: `docs/plans/intro-pitch-handholding.md`.

## Rules for player-facing text

No numbers, thresholds, formulas or percentages (resource counts like tokens are fine). Say only
what the engine does. In the intro never say a stakeholder *will* remember (grudges reset after
the demo), say "in the real game". No em dashes.

## Gotchas

- Case board relations are derived at read time from the challenge's items, so rerun the coverage
  gate (`tests/test_relations.py`, 8 of 11 rooms with 2+ threads) after any content regeneration.
- The board key uses the challenge's `phase_id` and `id` (what the pitch uses), not the client's raw indices.
- A broken component needs "Fix It" and then "Automate It" (two slots) to meet an automate driver; fixing it by hand alone leaves the driver unmet and a downstream step is capped by it.
- `get_phases()` always includes phase 0, and the client ignores the campaign flag
  `intro_phase_enabled`, so the demo briefing can show before a first challenge in phase 1.
- `handle_state_update_request` and `handle_get_dossier` read the latest `GameChallenge` without
  scoping to the current run.
- A broken veto is graded like a VETO in results (`outcome.veto_breaker` is not mapped).
- Token deduction on card play is trusted from the client payload.
- Stages `OBJECT` / `COMMIT` exist in the client type but are never sent.
- Tour guards (`introTourStartedRef`, `introDossier...`) are per mount, only the coach tips and
  briefings persist "seen".
