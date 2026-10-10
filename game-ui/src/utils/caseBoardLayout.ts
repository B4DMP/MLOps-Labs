/** Placement and thread geometry for the case board (a wide, short 760 x 290 cork surface). Pure. */

export const BOARD_W = 760;
export const BOARD_H = 290;
export const PORTRAIT_W = 96;
export const PORTRAIT_H = 92;

export interface Place {
  x: number;
  y: number;
  rot: number;
  /** Mirror the avatar so it faces the middle of the board. */
  flip: boolean;
}

export interface Point {
  x: number;
  y: number;
}

const hash = (text: string): number => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
};

/**
 * Portrait centres on an ellipse, in id order so a person keeps their spot between renders and
 * visits. Three to six people fit the board; more are still placed, only closer together.
 */
export const layoutPortraits = (ids: string[]): Record<string, Place> => {
  const sorted = [...new Set(ids)].sort();
  const n = sorted.length;
  const cx = BOARD_W / 2;
  const cy = BOARD_H / 2;
  const rx = BOARD_W / 2 - PORTRAIT_W / 2 - 14;
  const ry = BOARD_H / 2 - PORTRAIT_H / 2 - 3;
  const places: Record<string, Place> = {};
  sorted.forEach((id, i) => {
    const angle = n === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = Math.round((n === 1 ? cx : cx + rx * Math.cos(angle)) * 10) / 10;
    // Right of centre faces left, left of centre faces right; in the middle it is a per-person coin flip.
    const flip = x > cx + 1 ? true : x < cx - 1 ? false : hash(`${id}:flip`) % 2 === 0;
    places[id] = {
      x,
      y: Math.round((n === 1 ? cy : cy + ry * Math.sin(angle)) * 10) / 10,
      rot: (hash(id) % 7) - 3,
      flip,
    };
  });
  return places;
};

/** Where a thread leaves a portrait's edge on its way to another. */
export const anchor = (from: Place, to: Place): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const t = Math.min(
    dx ? (PORTRAIT_W / 2 + 3) / Math.abs(dx) : Infinity,
    dy ? (PORTRAIT_H / 2 + 3) / Math.abs(dy) : Infinity,
  );
  return { x: from.x + dx * t, y: from.y + dy * t };
};

export interface ThreadGeometry {
  a: Point;
  b: Point;
  control: Point;
  mid: Point;
}

/**
 * A curved thread between two places. `lane` bows parallel threads between the same pair apart
 * (0, 1, 2 ...), alternating sides, so none hides another.
 */
export const threadGeometry = (from: Place, to: Place, lane = 0): ThreadGeometry => {
  const a = anchor(from, to);
  const b = anchor(to, from);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const bow = (30 + 18 * Math.floor(lane / 2)) * (lane % 2 === 0 ? 1 : -1);
  const control = { x: mx - ((b.y - a.y) / length) * bow, y: my + ((b.x - a.x) / length) * bow };
  const mid = { x: (a.x + 2 * control.x + b.x) / 4, y: (a.y + 2 * control.y + b.y) / 4 };
  return { a, b, control, mid };
};

/** The portrait under a point, if any, other than `exclude`. */
export const portraitAt = (places: Record<string, Place>, point: Point, exclude?: string): string | null => {
  for (const [id, p] of Object.entries(places)) {
    if (id === exclude) continue;
    if (Math.abs(point.x - p.x) <= PORTRAIT_W / 2 + 4 && Math.abs(point.y - p.y) <= PORTRAIT_H / 2 + 4) return id;
  }
  return null;
};
