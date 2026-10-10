import { addCollection, Icon, type IconifyJSON } from "@iconify/react";
import {
  BOX_H,
  BOX_W,
  LEVEL_EMPTY,
  LEVEL_ICON_SIZE,
  axisMeta,
  formatAxisLevel,
  NODE_TITLE_LH,
  NODE_TITLE_Y,
  NODE_ICON_DISC,
  NODE_COLORS,
  NODE_ICON_SIZE,
  NODE_PAD_X,
  RAIL_W,
} from "../../utils/stageCanvas";
import nodeIconSets from "../../assets/nodeIcons.json";

/**
 * Every icon a node or its chrome can draw with, registered offline at module load instead
 * of fetched from Iconify's API on demand: a component's icon is core content, not a nicety
 * that can sit blank while a network request is in flight (or fails - fetching a brand new
 * icon name the first time it is used should not depend on being online). `nodeIcons.json` is
 * a curated subset generated with `@iconify/utils` `getIcons()`, not the full icon sets.
 */
Object.values(nodeIconSets as Record<string, IconifyJSON>).forEach((iconSet) => addCollection(iconSet));

/**
 * Shared look of a stage-architecture node, used by the Performance Dashboard's read-only
 * canvas and by the Compose Action Proposal editor.
 *
 * The shape carries three things at a glance, in descending order of how often a player needs
 * them: what it is (title), how healthy it is (the status rail down the left edge), and how
 * far it has been built out (the segmented meter along the bottom). Everything else is a
 * hover or a click away.
 */

/**
 * Gradients and shadows every node draws with. Rendered once per SVG; the ids are prefixed
 * so two canvases on one screen cannot collide.
 *
 * Canvas-level texture (dot grid, vignette, grain) is CSS on the canvas container instead of
 * SVG in here: this defs block lives inside the diagram's own `<svg>`, which is centred and
 * capped at `MAX_ZOOM` rather than stretched to fill its box - texture drawn in its
 * coordinate space would cover only the diagram, not the panel around it. CSS backgrounds on
 * the container cover the whole panel regardless of how small the diagram scales.
 */
export function NodeDefs({ prefix, theme = "light" }: { prefix: string; theme?: "light" | "cork" }) {
  // "cork": an index card pinned to a corkboard. Warm paper, and a hard offset shadow, because a card
  // pinned to a board lifts off it at one corner rather than glowing all round.
  const cork = theme === "cork";
  const shadow = cork
    ? { dx: 2, dy: 3.5, sd: 1.1, color: "#2a1a0c", opacity: 0.5 }
    : { dx: 0, dy: 1.5, sd: 1.8, color: "#0f172a", opacity: 0.14 };
  const lifted = cork
    ? { dx: 3, dy: 6, sd: 2, color: "#2a1a0c", opacity: 0.55 }
    : { dx: 0, dy: 3, sd: 3.2, color: "#0f172a", opacity: 0.2 };
  return (
    <defs>
      <linearGradient id={`${prefix}-face`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={cork ? "#fcf8ec" : "#ffffff"} />
        <stop offset="100%" stopColor={cork ? "#f2e9d2" : "#f5f8fb"} />
      </linearGradient>
      <linearGradient id={`${prefix}-face-selected`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={cork ? "#fffbf0" : "#ffffff"} />
        <stop offset="100%" stopColor={cork ? "#f6ecd2" : "#e8f2f7"} />
      </linearGradient>
      <linearGradient id={`${prefix}-face-broken`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={cork ? "#fdeee8" : "#fffafa"} />
        <stop offset="100%" stopColor={cork ? "#f4cfc4" : "#fdeced"} />
      </linearGradient>
      <filter id={`${prefix}-shadow`} x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx={shadow.dx} dy={shadow.dy} stdDeviation={shadow.sd} floodColor={shadow.color} floodOpacity={shadow.opacity} />
      </filter>
      <filter id={`${prefix}-shadow-lifted`} x="-25%" y="-25%" width="150%" height="165%">
        <feDropShadow dx={lifted.dx} dy={lifted.dy} stdDeviation={lifted.sd} floodColor={lifted.color} floodOpacity={lifted.opacity} />
      </filter>

      {/* Broken nodes: fractal noise displaces the card's own outline so its edge reads as
          damaged, then a red glow sits under it and the usual drop shadow goes back on top
          (a filter replaces the one it supersedes, it does not stack with it).

          Applied to the face rect alone, never to the whole node: displacing the label with
          it would smear 11px text. `scale` is 2.5 rather than the reference's 4 - our card
          is smaller and its corners are rounder, so 4 chews the radius away. The glow is
          0.55 opacity rather than 0.8 because it sits on a white board, not a dark one.

          Turbulence is expensive per node. This is the one filter in the file that is not
          shared by every node, and it is only ever mounted on broken ones, of which there
          are rarely more than a couple. */}
      <filter id={`${prefix}-broken-face`} x="-35%" y="-35%" width="170%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05 0.9" numOctaves={1} result="noise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale={2.5}
          xChannelSelector="R"
          yChannelSelector="G"
          result="cracked"
        />
        {/* Chromatic aberration, on the shape rather than the label: the card is copied
            twice, shifted a pixel either way, each copy reduced to one side of the spectrum,
            and both are laid *under* the crisp card. Only the sliver either copy sticks out
            by is visible, so the result is a red fringe down one edge and a cyan fringe down
            the other - a real luminance edge to fringe against, which dark-on-light text
            does not offer. */}
        <feOffset in="cracked" dx="-1.2" dy="0" result="shiftL" />
        <feColorMatrix
          in="shiftL"
          type="matrix"
          values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.75 0"
          result="fringeRed"
        />
        <feOffset in="cracked" dx="1.2" dy="0" result="shiftR" />
        <feColorMatrix
          in="shiftR"
          type="matrix"
          values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.75 0"
          result="fringeCyan"
        />
        <feMerge result="aberrated">
          <feMergeNode in="fringeRed" />
          <feMergeNode in="fringeCyan" />
          <feMergeNode in="cracked" />
        </feMerge>

        <feDropShadow in="aberrated" dx="0" dy="0" stdDeviation="4" floodColor={NODE_COLORS.broken} floodOpacity="0.55" result="lit" />
        <feDropShadow in="lit" dx={shadow.dx} dy={shadow.dy} stdDeviation={shadow.sd} floodColor={shadow.color} floodOpacity={shadow.opacity} />
      </filter>
    </defs>
  );
}

/**
 * The two maturity axes, drawn as two short tracks on one row: automation (blue) on the left,
 * governance (violet) on the right, with a wider gap between them than between notches. Each
 * track draws one notch per non-zero rung the target's own `allowed_automation`/
 * `allowed_governance` actually offers (`levelRungs`) - not a fixed three, since most targets'
 * governance ladder skips straight from none to full (one notch) while automation ladders run
 * two or three rungs deep. Two tracks rather than one longer ladder because the axes are
 * independent - a manual but fully governed component must not read as "halfway up" anything.
 *
 * Each notch carries its own rung's colour permanently, so a track reports *position* and not
 * merely length: a glance at which colour the filled run ends on says which rung the target
 * sits on. An automation rung that was built but does not run (something upstream caps it) is
 * drawn in its own colour at a third opacity, a ghost of what was paid for. Governance never
 * caps (00-plan.md decision 1), so its track has no ghost state.
 *
 * A broken target lights its first automation notch in broken red instead of leaving the
 * track empty, so broken never reads as merely "absent".
 */
export function LevelMeter({
  automation,
  effectiveAutomation,
  governance,
  automationRungs = [1, 2, 3],
  governanceRungs = [1, 2, 3],
  previewAutomation,
  previewGovernance,
  y,
  width = BOX_W - NODE_PAD_X - 12,
  emptyColor = LEVEL_EMPTY,
  thickness = 4,
}: {
  /** Colour of the unbuilt cells, for a face the default pale grey would vanish on. */
  emptyColor?: string;
  /** Height of a notch; the composer draws them thicker so they read at a glance. */
  thickness?: number;
  automation: number;
  effectiveAutomation?: number;
  governance?: number;
  /** The non-zero rungs this target can actually reach on each axis, ascending
   *  (`levelRungs(target.allowed_automation)` / `levelRungs(target.allowed_governance)`). */
  automationRungs?: number[];
  governanceRungs?: number[];
  /** A slotted proposal's target rung per axis, in the compose canvas only: drawn as
   *  translucent notches ahead of what is actually built, so the proposed state reads on the
   *  diagram itself rather than only in the sidebar. */
  previewAutomation?: number;
  previewGovernance?: number;
  y: number;
  width?: number;
}) {
  const gap = 2.5;
  const groupGap = 9;
  const totalCells = automationRungs.length + governanceRungs.length;
  const cell = (width - groupGap - gap * (totalCells - 2)) / totalCells;
  const trackW = automationRungs.length * cell + (automationRungs.length - 1) * gap;
  const runsAt = effectiveAutomation ?? automation;
  const gov = governance ?? 0;

  // Built notches that run shimmer in a wave along the track; planned ones (your proposal) breathe.
  const notch = (key: string, x: number, fill: string, opacity: number, live?: "run" | "plan", order = 0) => (
    <rect
      key={key}
      className={live ? `notch-${live}` : undefined}
      style={live ? { animationDelay: `${order * 0.28}s` } : undefined}
      x={x}
      y={0}
      width={cell}
      height={thickness}
      rx={thickness / 2}
      fill={fill}
      opacity={opacity}
    />
  );

  return (
    <g transform={`translate(${NODE_PAD_X}, ${y})`}>
      <title>{`Automation: ${formatAxisLevel("automation", automation)}${
        effectiveAutomation !== undefined && effectiveAutomation < automation
          ? ` (runs as ${formatAxisLevel("automation", effectiveAutomation)})`
          : ""
      } · Governance: ${formatAxisLevel("governance", gov)}`}</title>
      {automationRungs.map((r, i) => {
        const x = i * (cell + gap);
        const isPreview = previewAutomation !== undefined && r > automation && r <= previewAutomation;
        if (isPreview) return notch(`a${r}`, x, NODE_COLORS.selected, 0.4, "plan", i);
        if (automation === 0 && r === automationRungs[0]) return notch(`a${r}`, x, axisMeta("automation", 0).color, 1);
        if (r <= automation) {
          // Paid for but not delivering: its own rung colour, ghosted.
          return notch(`a${r}`, x, axisMeta("automation", r).color, r <= runsAt ? 1 : 0.33, r <= runsAt ? "run" : undefined, i);
        }
        return notch(`a${r}`, x, emptyColor, 1);
      })}
      {governanceRungs.map((r, i) => {
        const x = trackW + groupGap + i * (cell + gap);
        const isPreview = previewGovernance !== undefined && r > gov && r <= previewGovernance;
        if (isPreview) return notch(`g${r}`, x, NODE_COLORS.selected, 0.4, "plan", automationRungs.length + i);
        if (r <= gov) return notch(`g${r}`, x, axisMeta("governance", r).color, 1, "run", automationRungs.length + i);
        return notch(`g${r}`, x, emptyColor, 1);
      })}
    </g>
  );
}

/** A component's icon, sharing the title's row, seated on a disc tinted with the node's own
 *  status colour. Content, not code - every component brings its own via `icon` in
 *  MlopsGraph.json. Iconify's React component renders a real `<svg>` tag (its default
 *  `mode="svg"`), so it nests directly as SVG - no foreignObject needed, which sidesteps that
 *  element's cross-browser sizing quirks. */
export function NodeIcon({
  icon,
  color,
  cy = 4 + NODE_ICON_DISC,
  cx = NODE_PAD_X + NODE_ICON_DISC,
  discOpacity = 0.13,
}: {
  icon: string;
  color: string;
  /** Vertical centre, for a node whose title sits in a bar rather than at the top of the face. */
  cy?: number;
  /** Horizontal centre, for a node that seats the icon midway between its edge and its title. */
  cx?: number;
  discOpacity?: number;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={NODE_ICON_DISC} fill={color} opacity={discOpacity} />
      <g transform={`translate(${cx - NODE_ICON_SIZE / 2}, ${cy - NODE_ICON_SIZE / 2})`}>
        <Icon icon={icon} width={NODE_ICON_SIZE} height={NODE_ICON_SIZE} color={color} />
      </g>
    </g>
  );
}

/**
 * The colour-split copies of a broken node's label, drawn under the real text and revealed
 * only during the glitch tick. Same coordinates and metrics as the crisp lines, so they sit
 * exactly behind them and peek out by the offset alone.
 */
export function NodeTitleAberration({
  lines,
  x,
  fontWeight,
  y = (i: number) => NODE_TITLE_Y + i * NODE_TITLE_LH,
  offset = 1.2,
  fontSize = 11,
}: {
  lines: string[];
  /** One x per line: the title indents every line clear of the icon when the node carries one. */
  x: (lineIndex: number) => number;
  fontWeight: number | string;
  /** Baseline per line; the default is the standard top-of-face title. */
  y?: (lineIndex: number) => number;
  offset?: number;
  fontSize?: number;
}) {
  const ghosts: Array<[number, string]> = [
    [-offset, "#00c8e0"],
    [offset, "#ff0055"],
  ];
  return (
    <g className="node-aberration" pointerEvents="none" aria-hidden>
      {ghosts.map(([dx, fill]) =>
        lines.map((line, i) => (
          <text
            key={`${dx}-${i}`}
            x={x(i) + dx}
            y={y(i)}
            fill={fill}
            fontSize={fontSize}
            fontWeight={fontWeight}
            letterSpacing="0.1"
          >
            {line}
          </text>
        )),
      )}
    </g>
  );
}

/**
 * The level caption: the automation rung's icon and its word, in the rung's colour. Drawn
 * wherever a node reports what it runs at, so the same colour that ends the automation
 * track's filled run also carries the word for it. When the target has any governance, that
 * rung's glyph sits at the right end of the row (spelled out on hover) - the word itself would
 * not fit beside the automation word at caption size.
 */
export function LevelCaption({
  level,
  governance,
  y,
  size = 8,
  text,
  color,
}: {
  /** The automation rung the target runs at. */
  level: number;
  /** The governance rung; its glyph is drawn only from partial_1 upwards. */
  governance?: number;
  y: number;
  /** Caption font size; the default suits a node drawn at the dashboard's scale. */
  size?: number;
  /** Overrides the rung's own word, for the cases that are about something else: a starved
   *  component, a stage the player may only look at, an uncertain upstream. */
  text?: string;
  /** Overrides the rung's colour, for those same cases. */
  color?: string;
}) {
  const meta = axisMeta("automation", level);
  const govMeta = governance !== undefined && governance > 0 ? axisMeta("governance", governance) : null;
  const tint = color ?? meta.ink;
  // The glyph is centred on the caption's own baseline, so a 14px icon sits beside 8px text
  // without either one hanging off the row.
  const iconTop = y - LEVEL_ICON_SIZE + 3;
  return (
    <g>
      <Icon
        icon={meta.icon}
        width={LEVEL_ICON_SIZE}
        height={LEVEL_ICON_SIZE}
        color={tint}
        x={NODE_PAD_X}
        y={iconTop}
      />
      <text
        x={NODE_PAD_X + LEVEL_ICON_SIZE + 3}
        y={y}
        fill={tint}
        fontSize={size}
        fontWeight={700}
        letterSpacing="0.6"
      >
        {(text ?? meta.label).toUpperCase()}
      </text>
      {govMeta && (
        <g>
          <title>{`Governance: ${govMeta.label}`}</title>
          <Icon
            icon={govMeta.icon}
            width={LEVEL_ICON_SIZE - 2}
            height={LEVEL_ICON_SIZE - 2}
            color={govMeta.ink}
            x={BOX_W - 12 - (LEVEL_ICON_SIZE - 2)}
            y={iconTop + 1}
          />
        </g>
      )}
    </g>
  );
}

/**
 * The border of a broken node, animated as broken: a dim solid outline under a bright one whose
 * dashes crawl and flicker, plus a cyan and a magenta copy that tear away from it in bursts. Mount
 * inside the `.node-broken` group so it wiggles with the node; the classes are in `NODE_STATE_ANIM`.
 */
export function BrokenBorder({
  width = BOX_W,
  height = BOX_H,
  color = NODE_COLORS.broken,
  rx = 0,
}: {
  width?: number;
  height?: number;
  color?: string;
  rx?: number;
}) {
  const edge = { width, height, rx, fill: "none" } as const;
  return (
    <g pointerEvents="none" aria-hidden>
      <rect className="node-border-split-a" {...edge} stroke="#00b8d4" strokeWidth={1.5} />
      <rect className="node-border-split-b" {...edge} stroke="#ff2a6d" strokeWidth={1.5} />
      <rect className="node-border-dim" {...edge} stroke={color} strokeWidth={1.75} />
      <rect className="node-border-crawl" {...edge} stroke={color} strokeWidth={2} />
    </g>
  );
}

/** Selection as four corner brackets rather than a thicker border: reads as a game target,
 *  and survives being scaled down better than a border-weight change does. */
export function SelectionReticle({
  width = BOX_W,
  height = BOX_H,
  color = NODE_COLORS.selected,
  len = 9,
  off = 3,
}: {
  width?: number;
  height?: number;
  color?: string;
  len?: number;
  off?: number;
}) {
  const corners: Array<[number, number, number, number]> = [
    [-off, -off, 1, 1],
    [width + off, -off, -1, 1],
    [-off, height + off, 1, -1],
    [width + off, height + off, -1, -1],
  ];
  return (
    <g stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" pointerEvents="none">
      {corners.map(([x, y, dx, dy], i) => (
        <path key={i} d={`M ${x} ${y + dy * len} L ${x} ${y} L ${x + dx * len} ${y}`} />
      ))}
    </g>
  );
}

/**
 * State in motion: three states, three treatments, nothing else animates. One `<style>`
 * shared by both canvases (rendered once per SVG, alongside `NodeDefs`) rather than copied
 * into each - class names are global, so this is the one place they are defined.
 *
 * Broken is a micro-glitch tick rather than a slow fade: the node holds still for most of a
 * 2.4s cycle, then stutters for about a tenth of a second. A player notices the twitch in
 * peripheral vision, which a gentle opacity pulse never achieved, and because it is still
 * for 90% of the time it does not pull the eye away from the rest of the board. Pattern
 * taken from the reference pipeline mock; the colours here stay as they were.
 *
 * `.node-broken` must sit on a group *inside* the one carrying the node's `transform`
 * attribute: a CSS transform animation on that outer group would override the attribute and
 * throw the node to the origin.
 *
 * `.node-aberration` rides the same 2.4s cycle as the tick, so the colour fringes on a
 * broken node's label appear only while it is already stuttering. Both animations start when
 * the node mounts, so they stay in phase without being coordinated. A permanent fringe on an
 * 11px label would cost more legibility than the effect is worth; a tenth of a second of it
 * costs none, and a transient artifact is what a real signal glitch looks like anyway.
 */
export const NODE_STATE_ANIM = `
/* One timeline drives every part of a broken node (the wiggle, the title fringe, the border
   split), so they always happen together: a constant low jitter and fringe, and two bursts a
   cycle (a small one at ~40%, the big one at ~90%) where all of them peak at the same moment. */
/* The node hangs from its pin, so it never slides: it swings about the pin's point (top centre). A
   constant small sway, and two bursts of a bigger one. */
@keyframes node-glitch-tick {
  0%, 100% { transform: rotate(0deg); }
  10% { transform: rotate(0.35deg); }
  20% { transform: rotate(-0.3deg); }
  30% { transform: rotate(0.25deg); }
  38% { transform: rotate(1.6deg); }
  40% { transform: rotate(-2deg); }
  42% { transform: rotate(0.8deg); }
  50% { transform: rotate(-0.35deg); }
  60% { transform: rotate(0.3deg); }
  70% { transform: rotate(-0.25deg); }
  80% { transform: rotate(0.35deg); }
  90% { transform: rotate(-4deg); }
  92% { transform: rotate(3.4deg); }
  94% { transform: rotate(-1.8deg); }
  96% { transform: rotate(1.2deg); }
}
@keyframes node-aberration-tick {
  0%, 100% { opacity: 0.3; }
  10% { opacity: 0.45; }
  20% { opacity: 0.25; }
  30% { opacity: 0.4; }
  38%, 40%, 42% { opacity: 0.85; }
  50% { opacity: 0.3; }
  60% { opacity: 0.45; }
  70% { opacity: 0.25; }
  80% { opacity: 0.4; }
  90%, 92%, 94%, 96% { opacity: 0.95; }
}
.node-broken { transform-box: fill-box; transform-origin: 50% 1.5px; animation: node-glitch-tick 2.4s linear infinite; }
.node-aberration { opacity: 0.3; animation: node-aberration-tick 2.4s linear infinite; }

/* The broken border: a dim solid outline, a bright one that is always breaking up (dashes that crawl
   around the edge), and cyan and magenta copies that stay a pixel or two apart and tear away in the bursts. */
@keyframes border-crawl { to { stroke-dashoffset: -68; } }
@keyframes border-flicker {
  0%, 30%, 50%, 80%, 100% { opacity: 1; }
  10% { opacity: 0.8; }
  20% { opacity: 0.9; }
  38%, 41% { opacity: 0.35; }
  60% { opacity: 0.85; }
  70% { opacity: 0.95; }
  90%, 93% { opacity: 0.25; }
  95% { opacity: 1; }
}
/* The fringe copies swing about the same pin, a little further than the card, so they fan out of it. */
@keyframes border-split-a {
  0%, 100% { opacity: 0.5; transform: rotate(-0.5deg); }
  10% { opacity: 0.6; transform: rotate(-0.7deg); }
  20% { opacity: 0.4; transform: rotate(-0.4deg); }
  30% { opacity: 0.55; transform: rotate(-0.6deg); }
  38% { opacity: 0.95; transform: rotate(-1.6deg); }
  41% { opacity: 0.8; transform: rotate(1.2deg); }
  50% { opacity: 0.5; transform: rotate(-0.5deg); }
  60% { opacity: 0.6; transform: rotate(-0.7deg); }
  70% { opacity: 0.4; transform: rotate(-0.4deg); }
  80% { opacity: 0.55; transform: rotate(-0.6deg); }
  90% { opacity: 1; transform: rotate(-3deg); }
  93% { opacity: 0.9; transform: rotate(2.4deg); }
  96% { opacity: 0.6; transform: rotate(-0.5deg); }
}
@keyframes border-split-b {
  0%, 100% { opacity: 0.5; transform: rotate(0.5deg); }
  10% { opacity: 0.6; transform: rotate(0.7deg); }
  20% { opacity: 0.4; transform: rotate(0.4deg); }
  30% { opacity: 0.55; transform: rotate(0.6deg); }
  38% { opacity: 0.95; transform: rotate(1.6deg); }
  41% { opacity: 0.8; transform: rotate(-1.2deg); }
  50% { opacity: 0.5; transform: rotate(0.5deg); }
  60% { opacity: 0.6; transform: rotate(0.7deg); }
  70% { opacity: 0.4; transform: rotate(0.4deg); }
  80% { opacity: 0.55; transform: rotate(0.6deg); }
  90% { opacity: 1; transform: rotate(3deg); }
  93% { opacity: 0.9; transform: rotate(-2.4deg); }
  96% { opacity: 0.6; transform: rotate(0.5deg); }
}
/* The meter: built notches that run shimmer in a wave, planned ones breathe. Only opacity moves. */
@keyframes notch-run { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } }
@keyframes notch-plan { 0%, 100% { opacity: 0.22; } 50% { opacity: 0.75; } }
.notch-run { animation: notch-run 2.6s ease-in-out infinite; }
.notch-plan { animation: notch-plan 1.5s ease-in-out infinite; }
.node-border-dim { opacity: 0.4; }
.node-border-crawl { stroke-dasharray: 30 6 10 8 4 10; animation: border-crawl 2.4s linear infinite, border-flicker 2.4s linear infinite; }
.node-border-split-a { transform-box: fill-box; transform-origin: 50% 1.5px; opacity: 0.5; animation: border-split-a 2.4s linear infinite; }
.node-border-split-b { transform-box: fill-box; transform-origin: 50% 1.5px; opacity: 0.5; animation: border-split-b 2.4s linear infinite; }

/* Edge handles: they grow a little under the pointer, and announce themselves once when the
   canvas opens so a player learns the lines are targets without being told. */
.edge-handle { cursor: pointer; transform-box: fill-box; transform-origin: center; }
.edge-handle-body { transition: filter .12s ease, stroke-width .12s ease; }
.edge-handle:hover .edge-handle-body { filter: drop-shadow(0 1px 3px rgba(15, 23, 42, 0.3)); stroke-width: 2; }
@keyframes edge-handle-reveal {
  0% { transform: scale(1); }
  35% { transform: scale(1.45); }
  70% { transform: scale(1); }
  100% { transform: scale(1); }
}
.edge-handle-reveal { animation: edge-handle-reveal 1.1s ease-in-out 1 both; }
@media (prefers-reduced-motion: reduce) {
  .node-broken, .node-aberration, .edge-handle-reveal,
  .node-border-crawl, .node-border-split-a, .node-border-split-b, .notch-run, .notch-plan { animation: none; }
  .node-border-split-a, .node-border-split-b, .node-aberration { opacity: 0; }
}
`;

/**
 * The flowing look of an automated edge: a travelling dash pattern, speed and liveliness set by
 * the automation rung it runs at. Shared by both canvases so an edge reads the same whichever
 * one draws it - the Compose editor's own copy of this only had `FlowParticle`'s single dot,
 * which read as far less alive than the Dashboard's flowing line.
 */
export const EDGE_FLOW_ANIM = `
@keyframes pipeFlow { to { stroke-dashoffset: -24; } }
@keyframes pipePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
.pipe-flow { stroke-dasharray: 6 6; animation: pipeFlow 1.1s linear infinite; }
.pipe-flow-slow { stroke-dasharray: 4 8; animation: pipeFlow 2.6s linear infinite; }
.pipe-dead { stroke-dasharray: 3 5; animation: pipePulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .pipe-flow, .pipe-flow-slow, .pipe-dead { animation: none; }
}
`;

/** Capped: a small chain-link glyph on the rail, marking a component whose build has hit a
 *  ceiling it cannot climb past on its own. */
export function CappedChainGlyph({ color = NODE_COLORS.capped }: { color?: string }) {
  return (
    <g transform={`translate(${RAIL_W / 2 - 6}, ${BOX_H - 22})`}>
      <circle cx={6} cy={6} r={6} fill="#ffffff" stroke={color} strokeWidth={1.25} />
      <g transform="translate(2, 2)">
        <Icon icon="ph:link-simple-bold" width={8} height={8} color={color} />
      </g>
    </g>
  );
}

/** A moving dot along an automated edge: real motion via SMIL, not just an animated dash -
 *  `path` takes plain path data directly, no separate `<path>`/`mpath` needed. */
export function FlowParticle({
  x1,
  y1,
  x2,
  y2,
  color,
  dur = "1.1s",
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dur?: string;
}) {
  return (
    <circle r={2} fill={color} pointerEvents="none">
      <animateMotion dur={dur} repeatCount="indefinite" path={`M ${x1} ${y1} L ${x2} ${y2}`} />
    </circle>
  );
}

/** An edge's trigger, in a bordered chip rather than bare text sitting on the line. */
/**
 * The handle that makes an edge look like a control.
 *
 * A 1.5px line with an invisible 18px hit area is clickable but does not look it, and next
 * to nodes that carry shadows, rails and icons a player reads the lines as decoration and
 * never tests them. A chip at the midpoint is an object: it has an edge, a fill and a
 * shadow, so it reads as something to press. It carries the trigger glyph when the edge has
 * one and a neutral dot when it does not, which also means every editable edge has a handle
 * rather than only the triggered ones.
 *
 * Unlike the old chip this is the click target itself, so where you click is where the
 * affordance is.
 */
export function EdgeHandle({
  x,
  y,
  glyph,
  title,
  color,
  active,
  className,
  revealDelay,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  x: number;
  y: number;
  /** The trigger's glyph, or nothing for an edge that runs on no trigger at all. */
  glyph?: string;
  title?: string;
  color: string;
  active?: boolean;
  className?: string;
  /** Staggers the opening reveal so the handles announce themselves in sequence. */
  revealDelay?: number;
  onClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const w = glyph ? Math.max(18, glyph.length * 7 + 10) : 14;
  const h = glyph ? 18 : 14;
  return (
    // Two groups, not one: the outer carries the `transform` attribute that places the
    // handle on the edge, the inner carries the classes. A CSS transform animation replaces
    // the attribute outright, so animating the placed group sends the handle to the origin -
    // which is exactly what the reveal did.
    <g transform={`translate(${x - w / 2}, ${y - h / 2})`}>
      <g
        className={`edge-handle ${className ?? ""}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{ cursor: "pointer", animationDelay: revealDelay ? `${revealDelay}ms` : undefined }}
      >
        {title && <title>{title}</title>}
        <rect
          className="edge-handle-body"
          width={w}
          height={h}
          rx={h / 2}
          fill="#ffffff"
          stroke={color}
          strokeWidth={active ? 2 : 1.25}
        />
        {glyph ? (
          <text x={w / 2} y={h / 2 + 3.5} fontSize={9} textAnchor="middle" fill={color} fontWeight={700}>
            {glyph}
          </text>
        ) : (
          <circle cx={w / 2} cy={h / 2} r={2.5} fill={color} />
        )}
      </g>
    </g>
  );
}

export function TriggerChip({
  x,
  y,
  label,
  title,
  color,
}: {
  x: number;
  y: number;
  label: string;
  /** Spelled out on hover, since the chip itself carries only a glyph. */
  title?: string;
  color: string;
}) {
  const w = Math.max(16, label.length * 7 + 8);
  return (
    <g transform={`translate(${x - w / 2}, ${y - 8})`} pointerEvents="none">
      {title && <title>{title}</title>}
      <rect width={w} height={16} rx={8} fill="#ffffff" stroke={color} strokeWidth={1.25} />
      <text x={w / 2} y={11.5} fontSize={9} textAnchor="middle" fill={color} fontWeight={700}>
        {label}
      </text>
    </g>
  );
}

/** Edge stroke width by automation rung: a flat "automated or not" split reads as binary, but
 *  the ladder from broken to automated is four rungs, and the line should say which one.
 *  Governance deliberately does not widen the line - it never changes what flows. */
export function edgeStrokeWidth(level: number | undefined | null): number {
  if (level === undefined || level === null) return 1.5;
  return 1.25 + level * 0.4;
}

/**
 * A dependency that crosses the phase boundary: components are grouped one diagram per phase,
 * but an edge can still run between two of them (e.g. the feature store feeding the CI/CD
 * pipeline two phases later). The other component is never on this canvas, so the edge cannot
 * be drawn as a line to anywhere - instead it leaves the node as a short dashed line that fades
 * to nothing, `forward` toward later phases (right) or back toward earlier ones (left, a
 * feedback loop). Purely informational: no automation, no governance, no options - clicking it
 * only explains that the dependency exists, never anything to build or sign off on.
 */
export function CrossPhaseStub({
  x,
  y,
  forward,
  lane = 0,
  prefix,
  id,
  active,
  onClick,
  length = 30,
  idleColor = "#0891b2",
  activeColor = NODE_COLORS.selected,
}: {
  x: number;
  y: number;
  forward: boolean;
  /** For a canvas whose ground the default colours do not read on. */
  idleColor?: string;
  activeColor?: string;
  /** Vertical offset (in stacked slots) when a node carries more than one stub on the same
   *  side, so they fan out instead of drawing on top of each other. */
  lane?: number;
  prefix: string;
  id: string;
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  length?: number;
}) {
  const dir = forward ? 1 : -1;
  const ly = y + lane * 10;
  const x1 = x + dir * (BOX_W / 2);
  const x2 = x1 + dir * length;
  const gradId = `${prefix}-stub-${id.replace(/\./g, "_")}`;
  // Its own identity colour, not the muted grey used elsewhere for "unknown" or "view only" -
  // a cross-phase dependency is a known, real fact about the diagram, not a fogged-out one.
  const color = active ? activeColor : idleColor;
  return (
    <g style={{ cursor: onClick ? "pointer" : undefined }} onClick={onClick}>
      <defs>
        <linearGradient id={gradId} x1={x1} y1={ly} x2={x2} y2={ly} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity={0.9} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={x1} y1={ly} x2={x2} y2={ly} stroke={`url(#${gradId})`} strokeWidth={active ? 2.5 : 2} strokeDasharray="4 3" />
      <circle cx={x1} cy={ly} r={2.5} fill={color} />
      {/* Wide transparent hit area, same trick every other clickable line in this file uses. */}
      <line x1={x1} y1={ly} x2={x2} y2={ly} stroke="transparent" strokeWidth={16} />
    </g>
  );
}
