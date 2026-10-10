# Conversation history: a live transcript on the boardroom glass, extracted into its own component

Status: implemented (steps 0 to 7). Step 8, the playtest, is the remaining item. See "As built" for where the build differs from the mockup.

Mockup (static, nothing is wired to the game): [../mockups/conversation-history.html](../mockups/conversation-history.html).
Open it in a browser. It opens on the **Glass (v2)** direction; the toolbar switches to **Paper (v1)**
for comparison. **Notes** overlays numbered design notes, **Replay** re-runs the arrival and
narration, and `?paper`, `?sync`, `?notes` pick a state. The left column is today's panel. Icons need
internet. The dialogue is the one from the playtest screenshot, and the avatars are stand-ins.

## Goal

The conversation history is a stock chatscope panel in slate and teal. It should feel like the room
it sits in (smoked glass, a live transcript), make who-said-what readable at a glance, and live in
its own file so it can be changed without touching the 780-line `StakeholderInteractionArea.tsx`.
It should not copy the dossier and composer, which are the player's own paper notebook (see decision 6).

## Decisions already made (from design review)

1. **Extract the history into a separate TSX.** See "Extraction" below.
2. **No coloured borders, spines or rings.** No stakeholder-colour left stripe on a message, no
   coloured ring on an avatar, no coloured outline on a card, no glow ring while narrating. Identity
   comes from the avatar's own tinted background, the speaker name set in their colour as text, and
   the mood tag. A message bubble is a subtle tint of the stakeholder colour with no outline. (A stance tag is
   a filled chip, not an outline.)
3. **No avatars above the chat.** The mockup's first draft had a row of seat plates above the
   panel. It was a stand-in for the boardroom table, which already shows the seats, so it is
   dropped. The verdict chips are text only (see below).
4. **The glossary is not touched here.** Underline style and colour come from each term's category
   (`GlossaryTermMark`, `Glossary.module.css`: `--glossary-underline`, `--glossary-accent`), so a
   dotted indigo term and a wavy red term in the same bubble are correct. They must look the same in
   the chat, the dossier and the composer. The chat keeps calling
   `useGlossaryHighlighter("stakeholder_messages")` and respects `isSurfaceEnabled`. The only
   chat-side note: the glossary colours were designed for dark surfaces, so the glass chat is where
   they already read best; any contrast fix goes in `Glossary.module.css` so every surface gets it.
5. **Keep the suspicious face on avatar hover.** Playtesters like it. The play control becomes a
   larger badge on the avatar corner instead of replacing the face.
6. **Glass for the room, paper for the notebook.** The dossier and composer are the player's private
   workspace, so they are paper (handwriting font, sticky notes, stamps). The boardroom is a shared
   space and the history is what was said in it, so it keeps the room's dark glass, the UI sans and
   no skeuomorphic props. Paper means "yours", glass means "the room". The first mockup draft used
   cream slips, taped notes and rubber stamps; that was a scrapbook inside a boardroom and is kept
   in the mockup only as the **Paper (v1)** comparison.

## Extraction

`StakeholderInteractionArea.tsx` has one caller, `pitch_debate.tsx`, which passes
`showStakeholderList={false}` and `showDialogueOptions={false}`. So the stakeholder list, the
light-themed dialogue-options card (`journalDialogueCard`, `journalOptionBtn`) and its
`dialogueOptions` props are not reachable from the game today.

New files under `game-ui/src/components/conversationHistory/`:

| File | Holds |
|---|---|
| `ConversationHistory.tsx` | Tab state, message filtering per conversation, the scroll area, the maximize button, intro-tour anchors. This is what `pitch_debate.tsx` renders. |
| `MessageBubble.tsx` | One stakeholder line: avatar, play badge, name, metric, mood chip, glossary text or `SpokenText`, optional stance tag. |
| `IntelChip.tsx` | The revealed, verified or corrected intel chip, between bubbles. |
| `ActionReceipt.tsx` | A player's move (card played) as a system line. |
| `TypingBubble.tsx` | "Ryan is writing" with a face. |
| `ProposalBand.tsx` | The merged proposal and verdict band. |
| `HistoryTabs.tsx` | Folder tabs with the existing `Reorder.Group` drag order, unread dot. |
| `ConversationHistory.module.css` | Tokens and styles. Reuse the boardroom's existing glass and text variables from `pitch_debate.module.css` rather than copying new hex values. |
| `ConversationHistory.test.tsx` | See Verification. |

Also moves with it: `ChatMsg`, `RevealedIntel` and `getTabInfo`. `Game.tsx` imports `ChatMsg` from
the old file, so update that import (or re-export once, then delete the re-export in the last step).

What `StakeholderInteractionArea.tsx` becomes: delete it once the new component is in, along with
the dead dialogue-options card, the stakeholder-list wiring and `StakeholderInteractionArea.module.css`.
Confirm `StakeholdersList` and `DialogueOption` have other users before deleting them.

### Behaviour that must survive the move

These are easy to lose in a restyle, so each gets a test or a manual check:

- **Live message by object identity.** `isLive = item === liveChatMsg`. Keep passing the same object
  through, do not clone messages when filtering or grouping.
- **Narration:** `onPlayMessage` on every stakeholder and player line, `onStopSpeech` only on the
  live line, `SpokenText` with `activeSentenceIndex` for the live line, glossary-wrapped text for the rest.
- **Tab behaviour:** jump to `evaluatingConversationId` when a pitch starts, follow the conversation of
  the newest message, preserve the player's drag order (`tabOrder` sync effect).
- **Intel:** `onInspectIntel(intel, stakeholderId)` with keyboard activation (Enter, Space).
- **Action cards:** `actionCards[item.ac_id]` link and `onHoverCard`.
- **Empty and evaluating states** for a tab with no messages.
- **Intro tour anchors:** `data-intro-group` `intro4` (typing indicator) and `intro5` (steps 1 and 2),
  plus the `startTour("intro4")` effect that fires when `!isEnabled` on challenge 0, phase 0. Move
  them unchanged so `utils/tour.ts` keeps working; also keep the `introPitch` step-4 anchor on the
  column in `pitch_debate.tsx`.
- **Maximize:** state stays in `pitch_debate.tsx` (it also swaps in the challenge card). The button
  moves into the component's header row via the existing `isMaximized` and `onToggleMaximize` props.
- **Hover face:** hovering an avatar still switches to the "suspicious" expression.
- **Keys:** rows are keyed by index today. Keep that unless a stable id is available, so
  entry animations do not replay on every tab switch.

## Visual spec

All of this is shown in the mockup's Glass view; the numbers in its Notes overlay match.

- **Surface.** The room's smoked glass: about 78% opacity, a light blur, a neutral hairline. The
  current hover-reveal (25% opacity that flips to 90% on hover, `.chatWrapper` in
  `pitch_debate.module.css`) goes away: legibility must not depend on the pointer.
- **Type.** The UI sans (Inter), not the handwriting font. Body 0.9rem at line-height 1.45,
  wider than today's bubble. Handwriting stays in the player's notebook.
- **Tabs.** Folder tabs as in the notebook, in glass: the active tab joins the sheet below it, the
  others sit back. Drag handle only on hover. A pulsing dot on a tab that received a line while
  another was open. The maximize button sits in this row so it can no longer cover the first line.
  The "Conversation history (10)" heading is dropped in favour of the tab row (the per-tab counts add
  up to it); decide at implementation whether to keep an icon.
- **Message bubble.** A subtle speech bubble tinted with the stakeholder colour (about 15% over the
  glass), corners 2px top-left and 6px elsewhere. The avatar (34px, tinted background) sits on that
  corner. No outline. Header: name in the stakeholder colour as text, metric in small caps, mood tag
  (tinted fill, no outline), then a 24px play button at the right; it no longer sits on the avatar.
- **Density.** Small radii throughout: panel 6px, tabs 5px, chips and tags 3 to 6px, no pills. Body
  0.9rem at line-height 1.45, bubble padding 5px 11px 8px, about 19px between bubbles (enough for
  the avatar overhang), intel chip on 6px padding. The "Responses" divider is dropped,
  since the band above already marks the start. In the mockup the same conversation is about a fifth shorter.
- **Hover.** The bubble tint deepens and a small toolbar fades in. No lift, no shadow. While
  narrating the tint is deeper still.
- **Narration.** Current sentence washed, finished ones settle, the rest dim. The avatar sways. No
  glow ring. The dark surface matches what `SpokenText.module.css` already assumes, so it needs no
  new variant.
- **Arrival.** 180ms rise and settle with the shared spring ease, instead of the 1s fade.
- **Intel chip.** A separate chip between bubbles (it was tried inside the revealing bubble as a
  footer and read worse). Glass fill, the intel type's icon and colour (driver, boundary, trade-off,
  fact) so it is recognisable from the dossier, a check and "Verified" or "Corrected" in the label,
  two-line clamp with the full text in the tooltip. Replace the external-link icon with a left arrow
  plus "Dossier", because it opens the dossier. Click flies a ghost of the chip to the dossier tab.
- **Player move.** A centred system line: card icon, "You played Team Sync-Up", target and question.
  It replaces the anonymous teal bubble. Card title and icon already come from `getTabInfo`.
- **Proposal and verdicts, one band.** A single row above the scroll area, pitch tabs only. Left:
  the committed proposal ("kpi definition", "Manual"), a compact version of the summary in
  `ComposeActionProposalModal` rather than a new design; "Action proposal, 1/4 changes" in the
  tooltip. Right: text chips with names and no avatars, showing writing, reading, or a verdict (a
  cross; the stance tag in the bubble says why, the chip's tooltip names it). It wraps onto two
  lines if the room is narrow. Replaces the spinner screen during pitch evaluation, and keeps the
  verdicts beside the thing they judge. Because the band does not scroll, the proposal stays
  visible while reading replies.
- **Stance tag.** A small filled tag next to the mood ("Objection"), not a rubber stamp.
- **Typing.** A named line ("Ryan is writing") with the face, instead of the generic indicator.
- **Reduced motion.** Every new animation is disabled under `prefers-reduced-motion`.

## Data this needs

- **Stance for the tag and the verdict chips.** `ChatMsg` has `emotional_state` and
  `facial_expression` but no stance. Smallest option: derive Objection or Pushback from the veto
  result and the pitch response already available to `pitch_debate.tsx`, passed down as a prop. Do
  not add a new backend field in this plan; if derivation is too rough, ship the lines without the
  stamp and revisit.
- **Who is still thinking.** `busyConversationKeys` and `isPitchEvaluating` exist; map them to a
  per-stakeholder pending set for the strip and the typing bubble.
- **Player moves.** Player lines are `id === "user"` or empty. The card they played is recoverable
  from the `eng_<card>_<n>` conversation id; target names may need to be added to the message.

## Steps

0. **Characterisation tests first.** Write `ConversationHistory.test.tsx` against the old component's
   behaviour (the bullets above), then run it before moving anything.
1. **Extract with no visual change.** Move the render logic into `ConversationHistory.tsx` with
   chatscope still in place; point `pitch_debate.tsx` at it; delete the dead dialogue-options and
   stakeholder-list paths. Tests stay green.
2. **Drop chatscope for the message list.** It forces the `!important` overrides and the DOM measuring
   (`measureControlAnchor`, `controlAnchors`) used to place the play badge. Render a plain list with
   `role="log"` and `aria-live="polite"`. Build `MessageBubble`, `TypingBubble`, the surface and the tabs.
3. **Narration and glossary on tinted bubbles.** Check the sentence highlight and every glossary category
   underline for contrast on the tinted bubbles (fix in `Glossary.module.css` if any fail).
4. **Intel note, player receipt, proposal receipt.**
5. **Proposal and verdict band, and stance tags**, once the stance prop exists.
6. **Cleanup.** Remove the old CSS from `pitch_debate.module.css` (`.chatWrapper` hover rules,
   `.chatMaximizeBtn`), the `@chatscope` imports and, if nothing else uses it, the dependency.
7. **Docs.** Update `docs/gameplay-flow.md` (intel chips, proposal and verdict band and where each is
   first met). Mark this plan implemented. Update the mockup if the build deviates.
8. **Playtest.** Watch whether players can say who said what without reading names, and whether the
   verdict strip is noticed.

## Verification

- `docker compose exec ui npm test -- ConversationHistory` for the new tests, then only the suites
  that touch `pitch_debate` and the glossary. No full run until the last step.
- The new test file needs no canvas, WebGL or timers at import time. `setupTests.ts` already stubs
  `@iconify/react` and `lottie-web`; `motion/react` `Reorder` is already used in the old component, so
  keep it behind the same usage and confirm it runs under jsdom.
- Open the game to the pitch screen and check: narration, tab switching during a pitch, the intro
  tour (challenge 0) still anchors, maximize and restore, keyboard focus on intel notes.

## Out of scope

- Any glossary change (see decision 4).
- Pinning a quote to the case board. The mockup shows a pin button on each bubble as a hook for
  [case-board.md](case-board.md); it is not part of this plan and the button is not built.
- Seat highlighting from a chat line. It needs a hover signal lifted into `pitch_debate.tsx` and the
  table; revisit after Step 6 as its own small change.
- New backend fields.

## Open questions

- Are text-only verdict chips in the shared band enough, or should verdicts live only in the bubbles (stance tags) and the band show just the proposal?
- Keep a small "Conversation history" label in the header, or let the tabs speak for themselves?
- `StakeholdersList` and `DialogueOption`: delete with the old component, or does something else
  need them? (Check in Step 1.)

## As built

Where the code differs from the spec above or from the mockup:

- **Files.** `game-ui/src/components/conversationHistory/`: `ConversationHistory.tsx`, `MessageBubble.tsx`,
  `IntelChip.tsx`, `ActionReceipt.tsx`, `SpeechControls.tsx`, `HistoryTabs.tsx`, `ProposalBand.tsx`, `chat.ts`
  (types, `getTabInfo`, `shortName`), the CSS module and `ConversationHistory.test.tsx`. The old
  `StakeholderInteractionArea.tsx`, its CSS, the dead dialogue-options card, the stakeholder-list wiring and the
  `@chatscope/chat-ui-kit-react` dependency are removed (the lockfile was regenerated in the `ui` container).
- **Scrolling.** The list scrolls vertically with a thin scrollbar and never sideways (`overflow-x: hidden`);
  it stays pinned to the newest line. Tabs scroll sideways with no scrollbar.
- **Name and role.** Where a role is shown beside the name, a leading role word is dropped
  (`shortName`: "Reliability Ruth" with a "Reliability" label is "Ruth"). The proposal band, the intel chip and
  the typing line show no role, so they keep the full name.
- **Dropped from the spec.** The unread dot on tabs (the active tab always follows the newest line, so another
  tab is never the one that just received it), the hover toolbar (pin and copy), and grouping consecutive lines
  under one header. Each line keeps its own bubble and avatar.
- **Avatars.** The small head-and-shoulders crop (`thumb`) on the bubble and typing avatars.
- **Font.** The game's existing UI stack (`"Helvetica Neue", Inter, ui-sans-serif`), not a newly loaded Inter.
- **Data.** The band's proposal is the first of `pitchState.last_pitched_changes` plus a `+N` chip. A chip is
  "backs it", "pushback" or "objection" from the server read's band (green, amber, red) once that stakeholder has
  replied in the pitch tab, and "waiting" while a pitch is being evaluated and they have not. The stance tag uses
  the same read, on their last reply. No backend change. Both apply only to the latest pitch tab.
- **Typing line.** Names the stakeholder (and shows their face) for card conversations; a pitch evaluation shows
  the generic "Stakeholders are reviewing the action proposal..." because there is no single writer.
- **Not verified in a browser.** The component is covered by 23 jsdom tests. The CSS (avatar overhang, tints,
  band wrapping) was ported from the mockup but has had no side-by-side check in the running game.
