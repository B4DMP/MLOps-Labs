import { BOX_W, NODE_COLORS, NODE_PAD_X } from "../../utils/stageCanvas";

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
 * Gradients and shadows every node draws with. Rendered once per SVG; the ids are prefixed so
 * two canvases on one screen cannot collide.
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
      <linearGradient id={`${prefix}-face-unknown`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fbfcfe" />
        <stop offset="100%" stopColor="#f1f5f9" />
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
  y,
  width = BOX_W - NODE_PAD_X - 12,
}: {
  nominal: number;
  effective?: number;
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
        let fill = "#e3e9f0";
        if (isBrokenCell) fill = NODE_COLORS.broken;
        else if (built && running) fill = NODE_COLORS.healthy;
        else if (built) fill = NODE_COLORS.capped;
        return <rect key={i} x={i * (cell + gap)} y={0} width={cell} height={4} rx={2} fill={fill} />;
      })}
    </g>
  );
}
