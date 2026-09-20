/**
 * Geometry and labels shared by every stage-architecture canvas: the Performance Dashboard's
 * read-only view and the Compose Action Proposal editor. Both draw the same graph from the
 * same `graph:state` payload, so a node that is 150 wide in one and 140 in the other is a bug
 * waiting to happen, not a style choice.
 */

export const LEVEL_LABELS = ["broken", "absent", "manual", "automated", "governed"];

export function formatLevel(level: number | undefined | null): string {
  if (level === undefined || level === null) return "unknown";
  return LEVEL_LABELS[level] || `level ${level}`;
}

export function formatLevelCap(level: number | undefined | null): string {
  const lbl = formatLevel(level);
  return lbl.charAt(0).toUpperCase() + lbl.slice(1);
}

export function formatTrigger(trigger: string | undefined | null): string {
  if (!trigger) return "none";
  return trigger.replace(/_/g, " ");
}

export const TRIGGER_ICONS: Record<string, string> = {
  none: "—",
  manual_request: "✋",
  schedule: "⏰",
  commit: "📦",
  data_arrival: "📊",
  alert: "🚨",
  approval: "✅",
};

// ── Node geometry ────────────────────────────────────────────────────────────

export const BOX_W = 150;
export const BOX_H = 64;
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
export function compactLayout(nodes: PlacedNode[]): CompactedLayout {
  const placed = nodes.filter((n) => n.layout);
  const cols = axisIndex(placed.map((n) => n.layout!.x));
  const rows = axisIndex(placed.map((n) => n.layout!.y));
  const colCount = new Set(cols.values()).size;
  const rowCount = new Set(rows.values()).size;

  const positions: Record<string, { x: number; y: number }> = {};
  placed.forEach((n) => {
    positions[n.id] = {
      x: CANVAS_PAD + cols.get(n.layout!.x)! * (BOX_W + COL_GAP) + BOX_W / 2,
      y: CANVAS_PAD + rows.get(n.layout!.y)! * (BOX_H + ROW_GAP) + BOX_H / 2,
    };
  });

  return {
    positions,
    width: CANVAS_PAD * 2 + Math.max(colCount, 1) * (BOX_W + COL_GAP) - COL_GAP,
    height: CANVAS_PAD * 2 + Math.max(rowCount, 1) * (BOX_H + ROW_GAP) - ROW_GAP,
  };
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

/** What a node's status rail says, in the order a player needs to hear it. */
export const NODE_COLORS = {
  healthy: "#16a34a",
  capped: "#ea580c",
  broken: "#dc3545",
  unknown: "#94a3b8",
  stale: "#d97706",
  selected: "var(--primary-bg, #266682)",
} as const;

/** Which face gradient a node draws with, by state. Ids come from `NodeDefs`. */
export function nodeFace(
  prefix: string,
  opts: { selected?: boolean; unknown?: boolean; broken?: boolean },
): string {
  if (opts.unknown) return `url(#${prefix}-face-unknown)`;
  if (opts.selected) return `url(#${prefix}-face-selected)`;
  if (opts.broken) return `url(#${prefix}-face-broken)`;
  return `url(#${prefix}-face)`;
}
