import { addCollection, Icon, type IconifyJSON } from "@iconify/react";
import { BOX_H, BOX_W, NODE_COLORS, NODE_ICON_SIZE, NODE_PAD_X, RAIL_W } from "../../utils/stageCanvas";
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
 * Maturity as five notches rather than five dots: the filled run reads as a quantity, and a
 * notch dimmed to amber shows the gap between what was built and what actually runs.
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
        const isBrokenCell = i === 0 && nominal === 0;
        const isPreview = previewLevel !== undefined && i > nominal && i <= previewLevel;
        let fill = "#e3e9f0";
        let opacity = 1;
        if (isPreview) {
          fill = NODE_COLORS.selected;
          opacity = 0.4;
        } else if (isBrokenCell) fill = NODE_COLORS.broken;
        else if (built && running) fill = NODE_COLORS.healthy;
        else if (built) fill = NODE_COLORS.capped;
        return (
          <rect key={i} x={i * (cell + gap)} y={0} width={cell} height={4} rx={2} fill={fill} opacity={opacity} />
        );
      })}
    </g>
  );
}

/** A component's icon, sharing the title's row: 14px, left of the text. Content, not code -
 *  every component brings its own via `icon` in MlopsGraph.json. Iconify's React component
 *  renders a real `<svg>` tag (its default `mode="svg"`), so it nests directly as SVG - no
 *  foreignObject needed, which sidesteps that element's cross-browser sizing quirks. */
export function NodeIcon({ icon, color }: { icon: string; color: string }) {
  return (
    <g transform={`translate(${NODE_PAD_X}, 4)`}>
      <Icon icon={icon} width={NODE_ICON_SIZE} height={NODE_ICON_SIZE} color={color} />
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
 */
export const NODE_STATE_ANIM = `
@keyframes node-glitch-tick {
  0%, 88%, 100% { transform: translate(0, 0) skew(0deg); }
  90% { transform: translate(-1.5px, 1px) skew(-0.8deg); }
  92% { transform: translate(1.5px, -0.5px) skew(0.5deg); }
  94% { transform: translate(-0.8px, -1px) skew(0deg); }
  96% { transform: translate(1px, 0.8px) skew(-0.3deg); }
}
@keyframes node-scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(200%); } }
.node-broken { animation: node-glitch-tick 2.4s ease-in-out infinite; }
.node-scanline { animation: node-scanline 2.6s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .node-broken, .node-scanline { animation: none; }
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
export function TriggerChip({
  x,
  y,
  label,
  color,
}: {
  x: number;
  y: number;
  label: string;
  color: string;
}) {
  const w = Math.max(16, label.length * 7 + 8);
  return (
    <g transform={`translate(${x - w / 2}, ${y - 8})`} pointerEvents="none">
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
