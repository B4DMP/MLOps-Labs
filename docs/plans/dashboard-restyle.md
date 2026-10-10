# Performance dashboard: the composer's look

Status: **steps 0 to 3 built; step 4 (the per-phase layout check) is still to do on screen.** Depends on `docs/plans/composer-redesign.md` (the composer is the reference).

The composer became a corkboard with pinned index cards, yarn strings, and a paper sidebar, in the
dossier's brown. The Performance Dashboard still shows the same graph in the old web-card look
(white panel, Bootstrap alerts, rail-and-glow nodes). Two screens of one graph should look like one
office. This plan lists what changed in the composer, how each piece maps onto the dashboard, and
the order to do it in.

## 1. What the composer has now

**Shared primitives**
- `HoverTooltip` takes rich content, plus `ariaText`; a `paper` variant; `useTooltipController` for
  SVG and loops. `ComposeTagDetail` is the tooltip body (label, then lines).
- `nodeChrome`: `NodeDefs theme="cork"`; `LevelMeter` (`emptyColor`, `thickness`, shimmering and
  breathing notches); `NodeIcon` (`cx`, `cy`, disc opacity); `NodeTitleAberration` (`y`, `fontSize`);
  `BrokenBorder`; one timeline for the broken effects; `CrossPhaseStub` colour props; `LevelCaption size`.

**Window**
- Dossier brown (`#2a211b`, `#3d2d23`, `#251b14`), brass accents, Delius for titles, paper
  (`#f7f4ea` with the crumple texture) for what you read, dark borders instead of blue ones.
- Header with a gradient and an inset highlight; chevron stage tabs recoloured; footer on the desk
  colour; tactile brass buttons; a title-block strip above the canvas.

**Canvas**
- Corkboard: the case board's dot lattice (one 8px lattice, a light dot a pixel off the dark one),
  warm gradient, trace of grain, recessed inset shadow, a dark-brown frame.
- Nodes: sharp rectangles, a solid **title bar in the state colour** (brown healthy, orange held
  back, amber upstream unknown, red broken, grey view only), white 12px bold title with a dark text
  outline, icon disc centred between border and title, no side rail, a **pin**, a fixed tilt per
  id, a card face in cream, a hard pinned shadow. Selected = dark brown outline and corner
  brackets. Slotted = teal corner flag with a hammer, pulsing icon, breathing shadow, no outline.
- Broken: the glitch effects (wiggle, border tear, title fringe, distortion) swing the card about
  its pin; they stop once a slotted step would fix it.
- Meter: thicker notches, running ones shimmer, planned ones breathe.
- Hover: swing on the pin, a touch larger, deeper shadow, icon tilts.
- Strings: yarn (shadow, solid strand, wound bands, flowing line on top), colours chosen for cork,
  bigger arrowheads, pale-free.
- Legend: title bar, meters, strings, marks.

**Sidebar**
- Header band in the node's bar colour with a hanging owner badge (28px+, faces left).
- Chip row: automation and governance pips, dependency chip. First sentence of help only.
- Notes as one-line ledger rows with an extended view on hover; section headers as inset bands
  with a filled icon disc; rung ladder with state-only dots; proposal tickets; hero empty state.
- Icons enlarged and vertically centred; calm hover motion; "Current", not "today".

**Interaction**: hovering a dossier note lifts its node; a board hint in the hero and the notes header.

## 2. Mapping onto the dashboard

The dashboard is read-only and shows the built system, not a proposal. So some pieces carry over
unchanged, some change meaning, and some do not apply.

| Composer | Dashboard | Action |
|---|---|---|
| Cork board surface | `.graphCanvasBox` | Same CSS, shared |
| Pinned index-card node | `StageSvg` node | Same component, shared |
| State title bar | `railColor()` today | Same colours; add **starved** (dark amber) and **upcoming stage** (view-only grey) |
| Teal flag with hammer | none (no proposals) | Reuse the corner slot for **technical debt**: a flag in a debt colour with the receipt glyph |
| Slotted pulse and shadow | n/a | Not used |
| Selection brackets and brown outline | `SelectionReticle`, selected stroke | Same |
| Inspect affordance (`⌕` disc) | `.node-peek` | Drop: hover swing replaces it; click target is the whole card |
| Yarn edges | per-edge lines, `TriggerChip` | Same component; `TriggerChip` becomes the handle-chip style |
| Stage chevron tabs | `stageButton` strip with dashed pipe connectors and arcs | Stays; only status colours align with the title bars |
| Header, phase rail, metric gauges | `.header`, `PhaseOverview`, `MetricTab` | Stay as they are (blue, light panel) |
| Sidebar inspector | `detailsCard` | Band, chips, ledger rows, sections as bands |
| Legend | one "feedback loop" line | Real legend panel, dashboard version |
| Tooltips | `HoverTooltip` plus SVG `<title>` | All through the paper variant; SVG via the controller |

## 3. Work

### Step 0: extract, no visual change
The composer holds node, edge, palette and legend code inline. Move it so both screens use it:

- `components/graph/cardPalette.ts`: `CARD`, `nodeBar()`, `EDGE_ON_CORK`, `cardTilt()`, `BAR_H`.
- `components/graph/StageNode.tsx`: the pinned card. Props for state, selected, lit, icon, meter
  data, tilt, and optional `flag` (kind and colour) and `proposed`. Both screens call it.
- `components/graph/StageEdge.tsx`: yarn layers, markers, flow classes, optional handle.
- `components/graph/boardSurface.module.css`: the cork and frame, plus the board tokens.
- `components/graph/GraphLegend.tsx`: the hover panel, fed groups by each screen.
- Composer switches to these. Its tests and the build must be unchanged.

### Step 1: the dashboard canvas
- `StageSvg` renders `StageNode` and `StageEdge`; `NodeDefs theme="cork"` replaces `"dash"`.
- Broken nodes get the pin, so the swing about the top centre makes sense. **Note: this already
  matters today.** The shared `.node-broken` now rotates about the top centre, and the dashboard
  has no pin, so its broken nodes swing from nothing until step 1 lands.
- Cross-phase stubs use the cork colours; flow states keep their classes.
- Tooltips: connectors, the trigger chip and the meter use `useTooltipController`; remove SVG
  `<title>` children. Wrap the dashboard in `HoverTooltipTheme variant="paper"`.

### Step 2: the inspector
- Header band takes the selected component's bar colour; large owner badge; close as an X, not
  "Close" text. The "Back to Component List" buttons go.
- Chips: `AxisChip` for both axes, `DependencyChip` for held back, plus a **debt** chip when debt
  exists. Reuse `StatusChips`, `ComposeTagDetail`, and the section band styles.
- Replace the Bootstrap blocks: "Held back" and "Technical debt" become a chip and a band; "Runs X
  (set up for Y)" becomes "Current: X" with "Built for Y" in the tooltip; "Its output is" goes.
- Notes: `IntelNoteRows` (without board marks), same extended view and hover.
- Story: becomes the caption, in the sans, not an italic quote.
- Running services: ledger rows with a state chip.
- Component list: the same ledger rows with the icon disc and pips, and a short margin note on
  top; no hero (the list is the content).

### Step 3: make the rest agree with the board and inspector
The modal keeps its light panel, blue header, phase rail and metric gauges. The new brown board and
paper inspector sit inside it, so the job here is to stop the rest from looking foreign next to them,
not to restyle it.
- **Stage strip:** keep the buttons and the pipe connectors. Only bring the status colours onto the
  strip's palette (the same green, orange and red as the title bars) so a stage and its components
  read as one system. No pinned-card strip.
- **Stage subheader** (name, health badge, patterns, legend): keep as a light row above the board;
  add the Legend chip and the hover panel (the board's legend, dashboard groups). Pattern badges
  stay as they are unless they clash.
- **Cross-stage connections note and neighbour rails:** tint to match the board's frame colour.
- **Metric gauges:** untouched. Check them side by side with the new inspector at each phase and
  adjust only the board and inspector (not the gauges) if something clashes: the inspector's paper
  and the band colours are the things to tune.
- **Panel:** stays light. The board's brown frame and the inspector's paper are the two strong
  surfaces; keep the space between them quiet (no extra borders or fills).


### Step 4: check the layout in every phase
No layout work is planned. The dashboard uses the same `compactLayout` and `fitToBoxStyle` as the
composer, which already normalise every stage (including three-row ones) to the reference grid, so
node size should match across phases without changes.

The one thing to verify, not assume: the dashboard stacks the metric rail, stage strip and
subheader above the board, so its board may have less height than the composer's. After step 1,
screenshot each phase, including Deployment (three columns, three rows), and compare node size and
text legibility with the composer. Only if the cards come out noticeably smaller is there anything
to do, and then the first thing to try is trimming the subheader and patterns rows, not changing
the layout code.


### Step 5: polish and docs
- Hover swing, meter shimmer, glitch continuity; reduced motion.
- Contrast pass on the title bars, the cork and the paper.
- Update `docs/gameplay-flow.md` and the tooltip guidelines.

## 4. Verification
- Run only the touched suites: `stageCanvas.test.ts`, `HoverToolTip.test.tsx`, `noNativeTitle.test.ts`,
  the composer and case board tests, and the dashboard's own tests if present.
- Layout check as before: screenshot each phase (one with three rows), at 1080p with 100% and 125%
  scaling, and compare node size across phases.
- Check the dashboard opened from the simulation debrief (`focusComponentId`), since it jumps
  into a stage and a selection.

## 5. Decisions

1. **Panel:** the modal stays light. The look applies to the board and the inspector only.
2. **Header and phase rail:** stay blue, as they are. Hopefully they sit acceptably next to brown
   and paper; if they do not, the brass-on-brown frame around the board is the thing to soften,
   not the header.
3. **Metric gauges:** kept. The rest is adjusted to match them (step 3).
4. **Debt flag:** amber, with the receipt glyph. It must stay clearly different from the composer's
   teal "proposed" flag, which does not appear on this screen.
5. **Stage strip:** stays as buttons; only its status colours are aligned with the title bars.

Nothing else is open.

