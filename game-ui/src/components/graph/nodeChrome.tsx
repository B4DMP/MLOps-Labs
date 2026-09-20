import { addCollection, Icon, type IconifyJSON } from "@iconify/react";
import {
  BOX_H,
  BOX_W,
  LEVEL_EMPTY,
  LEVEL_ICON_SIZE,
  levelMeta,
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
export function NodeDefs({ prefix }: { prefix: string }) {
  return (
    <defs>
      <linearGradient id={`${prefix}-face`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f5f8fb" />
      </linearGradient>
      <linearGradient id={`${prefix}-face-selected`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#e8f2f7" />
      </linearGradient>
      <linearGradient id={`${prefix}-face-broken`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fffafa" />
        <stop offset="100%" stopColor="#fdeced" />
      </linearGradient>
      <filter id={`${prefix}-shadow`} x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.8" floodColor="#0f172a" floodOpacity="0.14" />
      </filter>
      <filter id={`${prefix}-shadow-lifted`} x="-25%" y="-25%" width="150%" height="165%">
        <feDropShadow dx="0" dy="3" stdDeviation="3.2" floodColor="#0f172a" floodOpacity="0.2" />
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
        <feDropShadow in="lit" dx="0" dy="1.5" stdDeviation="1.8" floodColor="#0f172a" floodOpacity="0.14" />
      </filter>

      {/* Another phase: flat, pale, and plainly not the hatch. Known, just not yours to
          change from here. */}
      <linearGradient id={`${prefix}-face-viewonly`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#eef2f7" />
      </linearGradient>

      {/* Undiscovered nodes: a diagonal hatch instead of flat grey - fog you can see beats
          absence. 8px tile so it stays crisp at MAX_ZOOM (a 2px hatch turns to mush). */}
      <pattern id={`${prefix}-face-unknown`} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={8} height={8} fill="#fbfcfe" />
        <line x1={0} y1={0} x2={0} y2={8} stroke="#dbe3ec" strokeWidth={2} />
      </pattern>
    </defs>
  );
}

/**
 * The maturity ladder, drawn as five notches.
 *
 * Each notch carries its own rung's colour permanently, so the meter reports *position* and
 * not merely length: a glance at which colour the filled run ends on says which rung the
 * component sits on. A rung that was built but does not run (something upstream caps it) is
 * drawn in its own colour at a third opacity, a ghost of what was paid for.
 */
export function LevelMeter({
  nominal,
  effective,
  previewLevel,
  y,
  width = BOX_W - NODE_PAD_X - 12,
}: {
  nominal: number;
  effective?: number;
  /** A slotted proposal's target level, in the compose canvas only: drawn as translucent
   *  rungs ahead of what is actually built, so the proposed state reads on the diagram
   *  itself rather than only in the sidebar. */
  previewLevel?: number;
  y: number;
  width?: number;
}) {
  const CELLS = 5;
  const gap = 2.5;
  const cell = (width - gap * (CELLS - 1)) / CELLS;
  const runsAt = effective ?? nominal;

  return (
    <g transform={`translate(${NODE_PAD_X}, ${y})`}>
      {Array.from({ length: CELLS }, (_, i) => {
        const built = i <= nominal;
        const running = i <= runsAt;
        const isPreview = previewLevel !== undefined && i > nominal && i <= previewLevel;

        let fill = LEVEL_EMPTY;
        let opacity = 1;
        if (isPreview) {
          fill = NODE_COLORS.selected;
          opacity = 0.4;
        } else if (built && running) {
          fill = levelMeta(i).color;
        } else if (built) {
          // Paid for, not delivering: its own rung colour, ghosted.
          fill = levelMeta(i).color;
          opacity = 0.33;
        }
        return (
          <rect key={i} x={i * (cell + gap)} y={0} width={cell} height={4} rx={2} fill={fill} opacity={opacity} />
        );
      })}
    </g>
  );
}

/** A component's icon, sharing the title's row, seated on a disc tinted with the node's own
 *  status colour. Content, not code - every component brings its own via `icon` in
 *  MlopsGraph.json. Iconify's React component renders a real `<svg>` tag (its default
 *  `mode="svg"`), so it nests directly as SVG - no foreignObject needed, which sidesteps that
 *  element's cross-browser sizing quirks. */
export function NodeIcon({ icon, color }: { icon: string; color: string }) {
  const cx = NODE_PAD_X + NODE_ICON_DISC;
  const cy = 4 + NODE_ICON_DISC;
  return (
    <g>
      <circle cx={cx} cy={cy} r={NODE_ICON_DISC} fill={color} opacity={0.13} />
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
  offset = 1.2,
}: {
  lines: string[];
  /** One x per line: the title indents its first line when the node carries an icon. */
  x: (lineIndex: number) => number;
  fontWeight: number | string;
  offset?: number;
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
            y={NODE_TITLE_Y + i * NODE_TITLE_LH}
            fill={fill}
            fontSize={11}
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
 * The level caption: the rung's icon and its word, in the rung's colour. Drawn wherever a
 * node reports what it runs at, so the same colour that ends the meter's filled run also
 * carries the word for it.
 */
export function LevelCaption({
  level,
  y,
  text,
  color,
}: {
  level: number;
  y: number;
  /** Overrides the rung's own word, for the cases that are about something else: a starved
   *  component, a stage the player may only look at, an uncertain upstream. */
  text?: string;
  /** Overrides the rung's colour, for those same cases. */
  color?: string;
}) {
  const meta = levelMeta(level);
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
        fontSize={8}
        fontWeight={700}
        letterSpacing="0.6"
      >
        {(text ?? meta.label).toUpperCase()}
      </text>
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
@keyframes node-glitch-tick {
  0%, 88%, 100% { transform: translate(0, 0) skew(0deg); }
  90% { transform: translate(-1.5px, 1px) skew(-0.8deg); }
  92% { transform: translate(1.5px, -0.5px) skew(0.5deg); }
  94% { transform: translate(-0.8px, -1px) skew(0deg); }
  96% { transform: translate(1px, 0.8px) skew(-0.3deg); }
}
@keyframes node-aberration-tick {
  0%, 88%, 100% { opacity: 0; }
  90%, 96% { opacity: 0.8; }
  97% { opacity: 0; }
}
@keyframes node-scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(200%); } }
.node-broken { animation: node-glitch-tick 2.4s ease-in-out infinite; }
.node-aberration { opacity: 0; animation: node-aberration-tick 2.4s ease-in-out infinite; }

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
.node-scanline { animation: node-scanline 2.6s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .node-broken, .node-scanline, .node-aberration, .edge-handle-reveal { animation: none; }
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

/** Stale: a faint scanline sliding down the face, clipped to the node's own rounded shape
 *  (reusing the clip already made for the status rail). */
export function StaleScanline({ clipPathId }: { clipPathId: string }) {
  return (
    <rect
      className="node-scanline"
      x={0}
      y={-BOX_H}
      width={BOX_W}
      height={BOX_H / 3}
      fill="url(#scanline-gradient)"
      opacity={0.5}
      clipPath={`url(#${clipPathId})`}
      pointerEvents="none"
    />
  );
}

/** The gradient `StaleScanline` paints with: one definition, reused by every stale node on
 *  either canvas. */
export function ScanlineDefs() {
  return (
    <linearGradient id="scanline-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#ffffff" stopOpacity={0} />
      <stop offset="50%" stopColor="#ffffff" stopOpacity={0.9} />
      <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
    </linearGradient>
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

/** Edge stroke width by level: a flat "automated or not" split reads as binary, but the
 *  ladder from broken to governed is five rungs, and the line should say which one. */
export function edgeStrokeWidth(level: number | undefined | null): number {
  if (level === undefined || level === null) return 1.5;
  return 1.25 + level * 0.4;
}
