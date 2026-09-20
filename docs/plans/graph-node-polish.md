# Graph node polish

Status: **1-4 built.** 5-8 (texture, motion, edges, entrance) not yet started.

Nodes look like web UI. They should look like game UI. Same footprint: 150 x 64. No card
anatomy, no header band, no footer well - those cost space we do not have.

Applies to both canvases: `PerformanceDashboard` (read-only) and `ComposeActionProposalModal`
(editor). Shared parts go in `components/graph/nodeChrome.tsx` and `utils/stageCanvas.ts`.

## 1. Icons per component

Every node looks the same. A feature store should not look like an IAM policy.

Add `icon` to each component in `MlopsGraph.json`, next to `layout`. Iconify names. Render
nested inside the node SVG, 14px, left of the title, sharing the title's row.

Content, not code. New components bring their own icon.

## 2. Owner chip

The owner only appears after a click. Put it on the node: a 12px avatar circle, bottom right,
tinted with the stakeholder's colour. Reuse `StakeholderAvatarComponent` and `emotionColors`.

The game is about who owns what. The board should say so.

## 3. Proposal preview in the meter

Compose canvas only. A slotted upgrade draws its target rungs as translucent segments in the
level meter. The player sees the proposed state on the diagram, not only in the sidebar.

The meter is already segmented. Near free.

## 4. Selection reticle

Selection is a thicker border. Replace with four corner brackets. Reads as a game target.
Survives small scale better than a border weight change.

## 5. Texture, once

Not per node. Canvas level only:

- dot grid on the board
- soft vignette at the edges
- `feTurbulence` grain at 2-3%
- diagonal hatch `<pattern>` fill for undiscovered nodes, replacing flat grey

Fog you can see beats absence.

## 6. State in motion

- broken: slow pulse on the status rail (`pipeFailing` keyframes exist)
- capped: small chain glyph on the rail
- stale: faint scanline over the face

Three states, three treatments. Nothing else animates.

## 7. Edges

- flow particles along automated pipeline edges, `animateMotion`
- stroke width by level
- trigger glyph in a bordered chip, not bare text

## 8. Entrance and change

- nodes fade and rise 4px on load, staggered 20ms
- a node whose level changed after simulation pulses once

Motion at the moment of change. Nowhere else.

## Order

1, 2, 3, then 4. Those four change how the board reads and add no new concept to learn. The
rest is finish.

## Constraints

- Everything must hold at `MAX_ZOOM` 1.6. A 2px hatch turns to mush.
- One shared `feDropShadow` for all nodes. No per-node filters.
- Decoration never replaces state. Rail, meter and marks stay readable first.
