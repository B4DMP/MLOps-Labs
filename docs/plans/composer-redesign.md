# Composer redesign: blueprint canvas, paper sidebar

Status: **steps 1 to 4 built; step 5 (polish) partly.** Not yet checked on screen (no browser
was available): do the layout check in section 6 before calling it done.

Deviations from the plan below, all deliberate:

- The lit node **grows and gains a shadow** instead of getting a ring. A ring fights the broken
  node's glitch; the grow-and-shadow sits on a wrapper group between the placed group and the
  `node-broken` group, so a lit broken node keeps glitching.
- Nodes are **whiteprint patches**, not cream cards (warm cream on a cool blueprint read as a
  collage). A whiteprint is navy line on pale blue-white print: cool pale face at 94% opacity so
  the sheet's grid shows through like vellum, 1.25px navy outline, 3px-ish drafting corners, no
  shadow (nothing floats on a drawing), gold 2px outline when selected or slotted, dashed outline
  for another phase (view only). Implemented as `NodeDefs theme="whiteprint"` plus
  `LevelMeter emptyColor`; the dashboard keeps the default theme. Options weighed and set aside:
  flat cream card, dark ink node, title-block node (light name plate over dark body), luminous ink.
- The footer is **dark navy** like the header, not paper, so the window frame reads as one desk.
- The notes share the case board's ledger **look and `stripSubject`**, not extracted components:
  `ConfirmedSummary` stays untouched (its table markup is not reusable in a narrow sidebar).
- `HoverTooltip` wrappers are used where simple; `useTooltipController` (same box) is used for
  the SVG canvas, the stage chevrons, header chips and ladder rows.
- Slot tickets show a remove icon, with the old tooltip, instead of the word "Remove".
- Header "Slots" chip is four pips plus "2 / 4 slots".
- Added: `utils/litTargets.ts`, `utils/firstSentence.ts`, `components/composeSidebar/*`.
- Not done: ticket perforation and tilt, the fly-to-slot transition, the node pulse on slot.

`ComposeActionProposalModal` is flat SaaS next to the dossier's leather and paper. This plan gives
it a drafting-table identity, rebuilds the sidebar so it is dense and single-line, moves every
tooltip onto `HoverTooltip`, and lets a hovered dossier note light up its node.

Mock of the sidebar: two states (unblocked with governance locked; held back with a full ladder)
were agreed in chat. The row heights and chip set below are taken from it.

## Rules for the whole change

- **Skin, do not restructure.** The window's regions keep their footprint: header, stage tabs,
  canvas area, sidebar width (`clamp(280px, 26vw, 380px)`), footer. Keep the `--sp-*` / `--fs-*`
  clamps and the px-bound reasoning in the CSS header. The only regions that change size are the
  sidebar's own contents, and they get smaller.
- **Direction A.** Blueprint canvas on a navy desk, warm paper sidebar. Paper matches the dossier
  next to it, so evidence is read on paper and drawn on the blueprint.
- **One line per row.** Fixed row height, `min-width: 0`, ellipsis, full text in the tooltip.
  The only wrapping text is the caption under the title: `text-wrap: pretty`, 2-line clamp.
- **No nested frames.** One gutter (`--sp-3`). Sections are split by a 1px rule. Only things the
  player acts on keep a border (next-step row, slot tickets).
- **Delius sparingly.** Title, section headings, stamps. Body stays in the current sans: Delius is
  wider and would wrap rows.
- Keep every `data-coach*` anchor (guide and tour depend on them) and the `compose` prefix
  contract with `nodeChrome` (shared with `PerformanceDashboard`).
- Copy: no em dashes, sentence case.

## Decisions already made

- Owner shows as an avatar only, not too small: **28px** (was 16px), name and "opens their
  dossier" in the tooltip.
- The footer hint group stays as is: "Hint", "Another hint", and "Add it for me" (intro phase).
  Tooltips on the proposal buttons (slot click-to-open, Remove, Discard, Confirm) stay too; they
  only change mechanism (section 3).
- `.inspectorCard` keeps a **header fill** (full-bleed band inside the sidebar, with a bottom
  hairline). It loses its own border, radius and shadow.
- The ladder keeps its **Add** button per next step.
- Hovering a dossier note faintly highlights its node (section 4).

## 1. Sidebar

### Structure, top to bottom (component inspector)

| Region | Today | New |
|---|---|---|
| Frame | `sidebarContent` padding, `inspectorCard` border + shadow, `inspectorBody` padding, bordered strip, banner, notes and option cards | Sidebar is the sheet: one padding, hairline rules between sections |
| Header | 16px owner pill with name next to the title | Filled band: icon, title (Delius, ellipsis), 28px owner avatar, close. Owner click opens dossier as today |
| Caption | Whole `help` text (two sentences) | First sentence only, `text-wrap: pretty`, 2-line clamp |
| Status | "Runs absent - output not reviewed" strip plus a dependencies banner | Chip row (like the dossier's `stakeholderMetaRow`): Automation (icon + 3 pips), Governance (icon + 3 pips), Dependency chip |
| Notes | 3 lines per note, source icon, "- Name" suffix, board chips inline | Ledger rows, 1 line each (below) |
| Ladders | Header + pill + hint line + 2-3 line option cards | Rung ladder (below) |
| Proposal | 2-line slot cards | 1-line tickets (below) |

Edge inspector uses the same skeleton: title `A -> B` (jump links stay), chips = Automation,
Governance, "started by <trigger>", hard/soft dependency (replaces the subtitle and the "Hand-off"
strip). Cross-phase stub and "view only" keep their single locked-phase line.

### Caption: first sentence only

`help` in `MlopsGraph.json` holds two sentences: what the component is, then a restatement of the
step names the ladder already lists. Show the first only. Add `firstSentence(text)` in a util with
a unit test (abbreviations such as "e.g." must not split). Trimming the second sentence at the
source is a later content pass, not part of this.

### Chip row

Pips reuse `AxisPipRow`. Words move to the tooltip ("Automation today: Absent, step 1 of 3").

Dependency chip states, one line each, ellipsis on the label:

- Unblocked: green, "Unblocked". Nothing else shown.
- Held back: amber, "Held back by <name>", click jumps to it (`jumpToComponent`). One caveat line
  under the row: "Automating further changes nothing until that is fixed." This consequence stops
  wasted slots, so it stays visible rather than going into a tooltip.
- Uncertain: amber, "Upstream undiscovered: <name>", same jump.

The old "Dependencies satisfied ... it runs absent" sentence is deleted. "Runs" and "output" are
gone as terms.

### Notes as ledger rows

Row: avatar (18px) | kind icon | one-line text (ellipsis) | mark. Shares its look with the case
board's compact `ConfirmedSummary` table.

- Extract the reusable cells from `ConfirmedSummary`: kind icon, the confirmed / on record / status
  mark, and the hover-peek style. Put them in `IntelLedgerCells.tsx` with a small CSS module.
  `ConfirmedSummary` consumes them too. Do not rewrite its table.
- Peek-on-hover shows the full note without growing the row.
- Ally and compromise board chips become mark-column icons. The existing long explanations move
  into the tooltip body.
- Click and light behaviour unchanged (`onSelectIntel`, `onLitIntel`, `litIntelIds`).
- Header: "Notes on this component" and "3 found" / "2 of 4 found" (`intelCountLabel`).
- **Spoiler guard.** The composer lists unconfirmed notes, which `ConfirmedSummary` never does. The
  kind icon shows only on confirmed notes. Unconfirmed notes get the neutral source icon, so the
  player's own (possibly wrong) tag is not echoed as if it were true.

### Ladder (the Automation / Governance element)

- Header: icon and title only. The state pill moves to the chip row. The hint line becomes a `?`
  with a tooltip (`AXIS_HINTS`, which stays as the source text).
- A 2px rail runs through the rung dots. Row = dot | name | rung tag | action, 30px.
  - Done: green dot with a check, muted name, "IN PLACE" stamp (dossier stamp look).
  - Next: tinted row, rung-coloured dot, tag ("manual"), tactile **Add** button
    (`0 2px 0` shadow, pressed state). Disabled with "Slots full" as now.
  - In proposal: Remove button as now, label "In proposal".
  - Later: dim row, lock dot, no action.
- Descriptions leave the row and go in the tooltip (`HoverTooltip`, rich body). The rung tag and
  trigger tag stay visible.
- Governance locked: one muted line, "Unlocks once it's implemented", no dashed box.
- Keep `data-coach-option`, `data-coach="compose-governance"`, `OptionLadder` props and the
  `optionStatus` logic untouched; this is a view change.

### Proposal tickets

One line: number badge, "Target - step" (ellipsis), Remove icon. Empty slots are 26px dashed
lines. Whole ticket still opens the target in the inspector; the "Click to open it in the
inspector" tooltip stays. Shared-step and after-step board chips become icons with tooltips.
Perforation and a max 1 degree tilt are optional polish (phase 3).

### Empty inspector

A margin note with an arrow toward the canvas instead of the dashed grey box. Same copy, same
height or less.

## 2. The rest of the window

All of this is colour, border, shadow and type. No region changes size.

| Region | Change |
|---|---|
| Container | Keep radius and `overflow: hidden`. White fill and 15% white border become a brass hairline on the navy desk |
| Header | `--primary-bg` blue becomes deep navy with brass title icon. Title and subtitle in Delius. Same height. Intel and Slots chips become brass gauges. Slots chip shows 4 pips plus "2 / 4" (shorter than now); the long text goes to the tooltip |
| Stage tabs | Keep the 8px chevron geometry, row height and the two-layer outline trick. Recolour: navy segments, active in blueprint blue with a brass edge, view-only dimmer. Green "editable" pip stays |
| Canvas toolbar | Becomes a drafting title block strip: stage name, component and edge counts, Legend chip. Sentence case instead of uppercase tracking. Same row height |
| Canvas box | Blueprint ground, fine light grid every 16px plus a stronger line every 5th, keep the vignette and grain, add faint corner registration marks. Border becomes a brass hairline |
| Nodes | **Stay light.** Existing light faces read as parts cards pinned on the sheet, so rung colours and node text keep their contrast and `nodeChrome` needs no dark variant |
| Edges and chrome | These do need work, because they are drawn on the ground. Default `#94a3b8` and `var(--primary-bg)` (invisible on blue) become light cyan and brass. Markers, edge handle, cross-phase stubs, selection reticle, `FlowParticle` and the dashed view-only line get blueprint-ground colours. Done through the `compose` prefix or props on the shared pieces, not by editing the dashboard's look |
| Legend | Stays a hover panel, restyled as paper. Swatches that assume a white canvas (the dashed "undiscovered" swatch) are rechecked |
| Loading and empty canvas | Bootstrap spinner and `text-muted` become module classes in the new palette |
| Footer | White bar becomes paper with a brass top hairline. Status message in the handwriting font. Hint group unchanged in behaviour. Confirm gets the tactile press and a short stamp moment (about 350 ms "PROPOSED") before closing. Respect `prefers-reduced-motion` |
| Header and footer "Back to Boardroom" | Both exist today. Left as is; see open questions |
| Leave-confirm overlay | Paper card, same layout and actions |
| Coach tips | No code change. Visual check of the spotlight against the dark ground |

Contrast pass before calling it done: every text and line colour on blueprint and navy, against
WCAG AA, at the smallest clamp size. The rung and axis colours are only used on paper and on the
light node faces, so they should be unaffected.

## 3. Tooltips: everything through `HoverTooltip`

Today the composer has its own `showInfoTag` / `tagProps` / `infoTag` state (20 call sites, a
portal and about 90 lines of `.headerHoverTag*` CSS) plus 11 `HoverTooltip` uses. The guidelines
say not to keep a second mechanism, so the local one goes.

Two gaps in `HoverToolTip.tsx` to close first, in their own small step:

1. **Rich bodies.** `description` is a `string`. The guidelines want structured bodies from
   small components (like `TabTagDetail`, `HoverTagDetails`). Widen `description` to
   `ReactNode`, add a plain-text `ariaText` for `aria-label` / `labelsChild`, keep the empty check.
   Existing string callers are unaffected.
2. **SVG targets.** The canvas nodes, edges, handles and stubs are inside an `<svg>`, where the
   guidelines forbid the wrapper. Export the same bubble and positioning as a hook,
   `useAnchoredTooltip()`, returning `{ handlers, bubble }` from the same code that `HoverTooltip`
   uses (flip above, viewport clamp, Escape and scroll dismiss, z-index 10010, variant). One
   mechanism, two entry points. `HoverTooltip` becomes a thin user of the hook.

Then in the composer:

- Replace each `tagProps(label, detail)` on HTML elements with `HoverTooltip`. Use `labelsChild`
  on icon-only controls (close, help, remove), `block` on full-width rows, and check flex items
  since the wrapper is an inline `span`.
- Build the body as a small component with a CSS module (`ComposeTagDetail`): label on the first
  line, detail below, each logical chunk `white-space: nowrap`, regular weight with bold only on
  highlights, literals or `var()` with fallbacks (the tag is portaled out of the composer's scope).
  No `\n` layout. The multi-line node and edge tags currently built with `\n` become structured
  rows.
- The dossier's `parchment` variant is not used here. The composer gets its own light variant
  (paper) via `HoverTooltipTheme`, wrapped once at `.proposalContainer`.
- Wrapping a tooltip around the ledger rows' peek, and around a button inside a row that is
  itself wrapped, would nest tooltips. One tooltip per element; the row's peek is not a tooltip.
- Delete `infoTag` state, `showInfoTag`, `hideInfoTag`, `tagProps`, the layout effects and the
  `.headerHoverTag*` CSS from the composer once nothing uses them. Pitch deck's own
  boardroom tag in `pitch_debate.tsx` is out of scope.
- `noNativeTitle.test.ts` must stay green. New tooltip styles go in their own CSS modules.

## 4. Hovered dossier note lights its node

Reuse the channel that already exists instead of adding a second one. `StakeholderDossier` already
takes `onLitIntelChange(ids)` (the case board's hover) and `pitch_debate.tsx` already feeds that
state to the composer as `litIntelIds`.

- `StakeholderDossier`: on the sticky note root (the element with `data-intel-id`), call
  `onLitIntelChange(new Map([[id, "#e9c46a"]]))` on mouse enter and focus, and an empty map on
  leave and blur. Same colour the composer already uses for its own notes.
- `ComposeActionProposalModal`: derive `litTargetIds` from `litIntelIds` by looking each id up in
  `dossierData` (`item.target || item.debug?.target`). Nodes and edges whose id is in that set get
  a faint "echo": a 2px ring in the lit colour at about 70%, a very light tint on the face, 120 ms
  fade. No pulse, no layout change. A lit edge thickens by 1px.
- Only the visible stage is drawn on. If the note's target is on another stage, put a small dot on
  that stage's tab instead of switching tabs under the player's cursor.
- Side effect, intended: hovering a case board thread or ledger row also lights the node. The
  composer's own sidebar rows already light from the same map.
- Notes with no `target` do nothing.

## 5. Order of work

1. **Tooltip primitive** (section 3, gaps 1 and 2). Own commit. No visual change.
2. **Sidebar** (section 1) including `IntelLedgerCells` extraction, `firstSentence`, and moving the
   sidebar's tooltips to `HoverTooltip`.
3. **Window skin** (section 2) and the remaining tooltips (canvas, header, footer, legend).
   Removes the local info tag.
4. **Intel -> node echo** (section 4).
5. **Polish:** stamp animation, slot fly-in (`layoutId`), ticket perforation, node pulse on slot.

Steps 1 to 3 can land without 4 and 5. Keep each step small: re-read a file right before editing
it, and import components instead of inlining markup, since several sessions edit
`StakeholderDossier.module.css` and the composer files.

## 6. Verification

Run only what each step touches (full runs are slow):

- Step 1: `HoverToolTip.test.tsx`, `noNativeTitle.test.ts`, `StakeholderDossier.test.tsx`.
- Step 2: `ComposeActionProposalModal.test.ts`, `graphOptions.test.ts`, `ConfirmedSummary.test.tsx`,
  `composeGuide.test.ts`, plus a new `firstSentence` test and a ledger-cells test.
- Step 3: `stageCanvas.test.ts` and the tooltip tests again.
- Step 4: a test that a lit intel id resolves to the right target ids (pure helper), and the
  dossier test that note hover calls `onLitIntelChange`.

Run via `docker compose exec ui npm test -- <file>`; never against the host Node. New third-party
imports that need canvas or timers get stubbed in `src/setupTests.ts`.

Layout check, since density is the main risk: screenshot the composer before and after at 1080p
with browser font scale at 100% and at 125% (the CSS header explains why that is the breakpoint
that breaks), with a component, an edge and nothing selected. Compare the bounding boxes of the
header, stage tabs, canvas area, sidebar and footer. They should not move by more than 1px. Then
check that no row in the sidebar wraps at the narrowest sidebar width (280px), including long
names such as "Feature Store -> Model Registry".

## 7. Docs to update

- `docs/gameplay-flow.md`: composer sidebar description (chip row, ledger notes, ladder), and the
  note that hovering a dossier note lights its node.
- `docs/plans/hover-tooltip-guidelines.md`: `description` accepts a node plus `ariaText`; the SVG
  hook; the composer's variant.
- `docs/plans/graph-node-polish.md`: cross-reference the blueprint ground and the edge colours.

## Open questions

- "Back to Boardroom" appears in both the header and the footer. Keep both, or drop the footer
  one to free space for the hint group and Confirm?
- The footer hint group and the hint text are described as kept. Confirm that reading of "keep the
  add it button and the hints on the proposal buttons" is the intended one.
- Is it acceptable that the dossier-note highlight also fires from case board hovers (section 4)?
  The alternative is a separate prop pair that only the dossier notes use.
