/**
 * Geometry and labels shared by every stage-architecture canvas: the Performance Dashboard's
 * read-only view and the Compose Action Proposal editor. Both draw the same graph from the
 * same `graph:state` payload, so a node that is 150 wide in one and 140 in the other is a bug
 * waiting to happen, not a style choice.
 */

/**
 * Every component and edge sits on two independent axes rather than one maturity ladder
 * (docs/plans/graph-governance-automation-rework/00-plan.md §2.1): automation says whether a
 * person or tooling does the work (on an edge: whether the hand-off fires by itself), and
 * governance says how strictly the result (on an edge: the hand-off itself) is reviewed. A
 * target can be manual but strictly reviewed, or automated and unsupervised, so neither axis
 * is ever folded into the other - and neither label set is ever used for the other axis.
 */
export type Axis = "automation" | "governance";

/** 0 broken, 1 absent, 2 manual, 3 automated. Pipeline flow is capped on this axis only. */
export const AUTOMATION_LABELS = ["broken", "absent", "manual", "automated"];
/** 0 none, 1 partial_1, 2 partial_2, 3 full - in words a player can read. */
export const GOVERNANCE_LABELS = ["not reviewed", "partially reviewed", "mostly reviewed", "fully governed"];

export const AXIS_LABELS: Record<Axis, readonly string[]> = {
  automation: AUTOMATION_LABELS,
  governance: GOVERNANCE_LABELS,
};

/** The axis's own name, for headings and summaries. */
export const AXIS_TITLES: Record<Axis, string> = {
  automation: "Automation",
  governance: "Governance",
};

export function formatAxisLevel(axis: Axis, level: number | undefined | null): string {
  if (level === undefined || level === null) return "unknown";
  return AXIS_LABELS[axis][level] || `level ${level}`;
}

export function formatAxisLevelCap(axis: Axis, level: number | undefined | null): string {
  const lbl = formatAxisLevel(axis, level);
  return lbl.charAt(0).toUpperCase() + lbl.slice(1);
}

export function formatTrigger(trigger: string | undefined | null): string {
  if (!trigger) return "none";
  return trigger.replace(/^on_/, "on ").replace(/_/g, " ");
}

/** The non-zero rungs a target's `allowed_automation`/`allowed_governance` actually offers,
 *  ascending - the meter's notch count. Authored ladders are not always the full 1-2-3 climb:
 *  governance on most targets skips straight from none to full ([0, 3]), one notch, not three,
 *  and some automation ladders stop at manual ([0, 1, 2]). Falls back to the full ladder when a
 *  target ships no restriction (e.g. an edge's `allowed_governance` before it is authored). */
export function levelRungs(allowed?: number[]): number[] {
  if (!allowed || allowed.length === 0) return [1, 2, 3];
  const rungs = [...allowed].filter((r) => r > 0).sort((a, b) => a - b);
  return rungs.length > 0 ? rungs : [1, 2, 3];
}

/** The explanation a cross-phase dependency stub shows on click: components are grouped one
 *  diagram per phase, but an edge can still run between two of them, and the far side is never
 *  on this canvas - so the stub explains what it stands for instead of connecting to anywhere. */
export function crossPhaseExplanation(direction: "out" | "in", otherName: string, otherStageName: string): string {
  return direction === "out"
    ? `Depends on ${otherName} in ${otherStageName}, a different phase. Shown as a dangling line here because that component isn't part of this phase's diagram.`
    : `${otherName} in ${otherStageName}, a different phase, depends on this. Shown as a dangling line here because that component isn't part of this phase's diagram.`;
}

/** Keyed by the trigger ids `MlopsGraph.json` actually uses; the short legacy keys stay so an
 *  older payload still draws a glyph rather than "?". */
export const TRIGGER_ICONS: Record<string, string> = {
  none: "—",
  manual_request: "✋",
  scheduled: "⏰",
  on_commit: "📦",
  on_data_arrival: "📊",
  on_new_version: "🆕",
  on_metric_threshold: "📉",
  on_alert: "🚨",
  schedule: "⏰",
  commit: "📦",
  data_arrival: "📊",
  alert: "🚨",
  approval: "✅",
};

// ── Node geometry ────────────────────────────────────────────────────────────

export const BOX_W = 150;
/**
 * 64 could not hold the stack once the caption's glyph grew: 4px of top padding, a 20px icon
 * disc, a second title line, a 14px caption glyph and the meter come to about 66. Rather than
 * shaving each of them until something collides, the box takes the six pixels it needs. The
 * diagram scales to its canvas either way, so the cost is a slightly smaller drawing, not a
 * bigger panel.
 */
export const BOX_H = 70;
export const COL_GAP = 44;
export const ROW_GAP = 44;
export const CANVAS_PAD = 12;
/** How far a small diagram may be blown up to fill its box before it just looks silly. */
export const MAX_ZOOM = 1.6;

/** Where an edge between two node centres meets the two node borders. */
export function edgeEnds(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const halfW = BOX_W / 2 + 4;
  const halfH = BOX_H / 2 + 4;
  const scale = (w: number, h: number) => {
    const sx = dx === 0 ? Infinity : Math.abs(w / dx);
    const sy = dy === 0 ? Infinity : Math.abs(h / dy);
    return Math.min(sx, sy);
  };
  const s1 = scale(halfW, halfH);
  const s2 = scale(halfW, halfH);
  return [x1 + dx * s1, y1 + dy * s1, x2 - dx * s2, y2 - dy * s2];
}

/** Node label, wrapped to at most two lines. */
export function wrapLabel(name: string, max: number): string[] {
  const words = name.split(" ");
  const lines: string[] = [];
  let current = "";
  words.forEach((w) => {
    if ((current + " " + w).trim().length <= max) {
      current = (current + " " + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

// ── Layout compaction ────────────────────────────────────────────────────────

/** Groups coordinates that are within `tolerance` of each other into one row or column. */
export function axisIndex(values: number[], tolerance = 30): Map<number, number> {
  const sorted = Array.from(new Set(values)).sort((a, b) => a - b);
  const index = new Map<number, number>();
  let slot = -1;
  let prev: number | null = null;
  sorted.forEach((v) => {
    if (prev === null || v - prev > tolerance) slot += 1;
    index.set(v, slot);
    prev = v;
  });
  return index;
}

export interface PlacedNode {
  id: string;
  layout?: { x: number; y: number };
}

export interface CompactedLayout {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/**
 * Authored layouts use absolute pixel coordinates with uneven gaps, which leaves the canvas
 * mostly whitespace. This keeps the relative arrangement - who sits left of whom, who shares a
 * row - but snaps every coordinate onto a tight, even grid, so the diagram fills the space it
 * is given instead of floating in the middle of it.
 */
/**
 * The grid every stage is measured against: three columns by two rows. Stages differ in how
 * many components they hold, and a canvas that simply fits each diagram to its box draws a
 * two-column stage at nearly three times the node size of a four-column one. Sizing against
 * a fixed reference instead keeps a node roughly the same size wherever the player is.
 */
export const REF_COLS = 3;
export const REF_ROWS = 2;

/** How tight the grid may pull before node size has to give instead. */
const MIN_COL_GAP = 26;
const MIN_ROW_GAP = 26;

/** Natural size of the reference grid, which every stage's viewBox is padded out to. */
export function referenceCanvas() {
  return {
    width: CANVAS_PAD * 2 + REF_COLS * BOX_W + (REF_COLS - 1) * COL_GAP,
    height: CANVAS_PAD * 2 + REF_ROWS * BOX_H + (REF_ROWS - 1) * ROW_GAP,
  };
}

/**
 * Gap for an axis that may hold more tracks than the reference does. A wider stage first
 * gives up spacing, down to `minGap`, and only then gives up node size: squeezing the gaps
 * costs a little air, while scaling down costs legibility everywhere on the node.
 */
function axisGap(count: number, box: number, refCount: number, refGap: number, minGap: number): number {
  if (count <= refCount || count < 2) return refGap;
  const refTotal = refCount * box + (refCount - 1) * refGap;
  return Math.max(minGap, (refTotal - count * box) / (count - 1));
}

/**
 * Authored layouts use absolute pixel coordinates with uneven gaps, which leaves the canvas
 * mostly whitespace. This keeps the relative arrangement - who sits left of whom, who shares a
 * row - but snaps every coordinate onto a tight, even grid, so the diagram fills the space it
 * is given instead of floating in the middle of it.
 *
 * The result is then padded out to the reference grid and the content centred inside it, so a
 * stage with fewer components draws at the same node size as one with more rather than being
 * magnified to fill the panel.
 */
export function compactLayout(nodes: PlacedNode[]): CompactedLayout {
  const placed = nodes.filter((n) => n.layout);
  const cols = axisIndex(placed.map((n) => n.layout!.x));
  const rows = axisIndex(placed.map((n) => n.layout!.y));
  const colCount = Math.max(new Set(cols.values()).size, 1);
  const rowCount = Math.max(new Set(rows.values()).size, 1);

  const colGap = axisGap(colCount, BOX_W, REF_COLS, COL_GAP, MIN_COL_GAP);
  const rowGap = axisGap(rowCount, BOX_H, REF_ROWS, ROW_GAP, MIN_ROW_GAP);

  const contentW = CANVAS_PAD * 2 + colCount * BOX_W + (colCount - 1) * colGap;
  const contentH = CANVAS_PAD * 2 + rowCount * BOX_H + (rowCount - 1) * rowGap;

  const ref = referenceCanvas();
  const width = Math.max(contentW, ref.width);
  const height = Math.max(contentH, ref.height);
  const offsetX = (width - contentW) / 2;
  const offsetY = (height - contentH) / 2;

  const positions: Record<string, { x: number; y: number }> = {};
  placed.forEach((n) => {
    positions[n.id] = {
      x: offsetX + CANVAS_PAD + cols.get(n.layout!.x)! * (BOX_W + colGap) + BOX_W / 2,
      y: offsetY + CANVAS_PAD + rows.get(n.layout!.y)! * (BOX_H + rowGap) + BOX_H / 2,
    };
  });

  return { positions, width, height };
}

/** Style for an SVG that should scale to fill its container without over-magnifying. */
export function fitToBoxStyle(width: number, height: number): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: "100%",
    maxWidth: width * MAX_ZOOM,
    maxHeight: height * MAX_ZOOM,
    margin: "0 auto",
  };
}

// ── Node chrome tokens ───────────────────────────────────────────────────────

export const NODE_RX = 10;
export const RAIL_W = 4;
/** Left edge of node content: clear of the status rail. */
export const NODE_PAD_X = RAIL_W + 10;
/**
 * Size of a component's icon, sharing the title's row.
 *
 * Small glyphs fail for two reasons, and size is only one of them: a 14px outline icon puts
 * three or four strokes into the same handful of pixels, and it floats on the card with
 * nothing to separate it from the text beside it. So the icon sits a little larger on a
 * tinted disc, which gives it a silhouette at any scale and lifts it off the face even when
 * the whole diagram is scaled down to fit a short canvas.
 */
export const NODE_ICON_SIZE = 15;
/** Radius of the tinted disc the icon sits on. */
export const NODE_ICON_DISC = 10;
/** How far the title shifts right to make room for the icon, when the node has one. */
export const NODE_ICON_OFFSET = NODE_ICON_DISC * 2 + 2;

/**
 * The maturity ladder, as colour and icon.
 *
 * Deliberately a cool ramp that darkens as it climbs, because the node already spends
 * red/orange/green on health: the rail answers "how is it doing", this answers "which rung is
 * it on", and the two must never be mistaken for one another. Depth carries the ordering even
 * in greyscale, so the ladder still reads without colour vision.
 *
 * Broken is the exception that keeps health's red: it is not a rung of the ladder, it is a
 * fault, and a player should read it as one.
 *
 * The rung's mark is a pictograph, drawn at `LEVEL_ICON_SIZE` rather than at caption size.
 * The earlier 11px version was too small to tell a hand from a bolt; the answer is to give
 * the glyph room, not to replace it with a digit, which says the rung's ordinal but nothing
 * about what the rung means.
 *
 * Three colours per rung, because one cannot do three jobs: `color` fills a shape (a meter
 * notch, a swatch, a selected segment), `ink` writes on a light ground (the node caption,
 * where `absent`'s pale slate would otherwise be invisible on a white card), and `onFill`
 * writes on top of `color` itself (white over the dark rungs, dark over the pale ones).
 *
 * Two ladders, one per axis. Automation keeps the cool blue ramp; governance gets its own
 * violet ramp (the colour the old combined "governed" rung used), so the two tracks sitting
 * side by side on a node can never be read as one longer ladder.
 */
export interface RungMeta {
  label: string;
  color: string;
  ink: string;
  onFill: string;
  icon: string;
}

export const AUTOMATION_META: readonly RungMeta[] = [
  { label: "broken", color: "#dc3545", ink: "#b91c1c", onFill: "#ffffff", icon: "ph:warning-octagon-fill" },
  { label: "absent", color: "#cbd5e1", ink: "#64748b", onFill: "#334155", icon: "ph:circle-dashed" },
  { label: "manual", color: "#38bdf8", ink: "#0284c7", onFill: "#0c4a6e", icon: "ph:hand-fill" },
  { label: "automated", color: "#0284c7", ink: "#075985", onFill: "#ffffff", icon: "ph:lightning-fill" },
];

/** Icons come from the offline set in `assets/nodeIcons.json` - no new icon names. */
export const GOVERNANCE_META: readonly RungMeta[] = [
  { label: GOVERNANCE_LABELS[0], color: "#e4dcfb", ink: "#7c6f99", onFill: "#4c1d95", icon: "ph:circle-dashed" },
  { label: GOVERNANCE_LABELS[1], color: "#a78bfa", ink: "#7c3aed", onFill: "#2e1065", icon: "ph:eye-bold" },
  { label: GOVERNANCE_LABELS[2], color: "#8b5cf6", ink: "#6d28d9", onFill: "#ffffff", icon: "ph:shield-check-bold" },
  { label: GOVERNANCE_LABELS[3], color: "#6d28d9", ink: "#5b21b6", onFill: "#ffffff", icon: "ph:shield-check-fill" },
];

const AXIS_META: Record<Axis, readonly RungMeta[]> = {
  automation: AUTOMATION_META,
  governance: GOVERNANCE_META,
};

/** The rung a level sits on, clamped so an out-of-range level cannot blank the node. Unknown
 *  defaults to automation's `absent` / governance's `none`. */
export function axisMeta(axis: Axis, level: number | undefined | null): RungMeta {
  const meta = AXIS_META[axis];
  const fallback = axis === "automation" ? 1 : 0;
  const i = level === undefined || level === null ? fallback : Math.max(0, Math.min(meta.length - 1, level));
  return meta[i];
}

/**
 * The node's vertical rhythm, in one place because two canvases draw it and they drifted
 * apart the last time these were literals at the call sites. Everything below the title is
 * measured from the bottom edge, so the stack stays put if the box height changes again.
 */
export const NODE_TITLE_Y = 18;
/** Baseline-to-baseline distance between the title's two lines. */
export const NODE_TITLE_LH = 12;
/** Baseline of the level caption. */
export const NODE_CAPTION_Y = BOX_H - 23;
/** Top of the maturity meter. */
export const NODE_METER_Y = BOX_H - 13;

/**
 * How large a rung's icon is drawn. Deliberately larger than the caption text beside it:
 * a glyph needs more pixels than a letter to stay recognisable, because its meaning is in
 * its shape rather than in a shape the reader already knows by heart.
 */
export const LEVEL_ICON_SIZE = 14;

/** Colour of an unbuilt rung on the meter. */
export const LEVEL_EMPTY = "#e3e9f0";

/** What a node's status rail says, in the order a player needs to hear it. */
export const NODE_COLORS = {
  healthy: "#16a34a",
  capped: "#ea580c",
  broken: "#dc3545",
  selected: "var(--primary-bg, #266682)",
} as const;

/** Which face a node draws with, by state. Ids come from `NodeDefs`. */
export function nodeFace(
  prefix: string,
  opts: { selected?: boolean; broken?: boolean },
): string {
  if (opts.selected) return `url(#${prefix}-face-selected)`;
  if (opts.broken) return `url(#${prefix}-face-broken)`;
  return `url(#${prefix}-face)`;
}
