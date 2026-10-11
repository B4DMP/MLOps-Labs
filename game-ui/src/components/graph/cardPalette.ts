/**
 * The look of the graph on the corkboard, shared by every screen that draws it (the pitch composer and
 * the Performance Dashboard). Nodes are index cards pinned to the board; hand-offs are yarn.
 */

/** Warm ink for outlines and text, and a state colour for the title bar only when something needs attention. */
export const CARD = {
  ink: "#2b2118",
  bar: "#3b2a1e",
  select: "#3b2412",
  predecessor: "#1d4ed8",
  empty: "#bfae8a",
  broken: "#9d1c2a",
  capped: "#9a3f0b",
  uncertain: "#76530b",
  starved: "#7a4a12",
  viewOnly: "#6e5f4d",
  /** "A step of yours is in the proposal" (the composer's flag, the sidebar's teal). */
  proposed: "#1d7f94",
  /** "This component carries technical debt" (the dashboard's flag). */
  debt: "#b7791f",
} as const;

/** Height of a node's title bar: two lines of title, centred. */
export const BAR_H = 34;

/**
 * A node's title bar carries its state. Healthy is plain brown: only what needs attention takes a
 * colour, so a problem is the first thing the eye lands on. The inspector's header mirrors it.
 */
export function nodeBar(s: {
  otherPhase: boolean;
  broken: boolean;
  uncertain: boolean;
  capped: boolean;
  starved?: boolean;
}): { fill: string; ink: string } {
  const fill = s.otherPhase
    ? CARD.viewOnly
    : s.broken
    ? CARD.broken
    : s.starved
    ? CARD.starved
    : s.uncertain
    ? CARD.uncertain
    : s.capped
    ? CARD.capped
    : CARD.bar;
  return { fill, ink: "#ffffff" };
}

/** Strings on the board: the line colours, chosen to read on cork. Arrowheads use the same. */
export const EDGE_ON_CORK: Record<string, string> = {
  "arr-default": "#efe3c8",
  "arr-viewonly": "#c4b595",
  "arr-primary": "#7fdcec",
  "arr-predecessor": "#9dbcff",
  "arr-success": "#55d38c",
  "arr-danger": "#ff6678",
  "arr-warning": "#ffa04a",
};

export const LIT_GLOW = "rgba(255, 246, 205, 0.95)";

/** Which string a hand-off at this automation level is: red when it stalls, green when it runs, orange between. */
export function edgeMarkerForLevel(level: number | null | undefined): string {
  if (level === 0) return "arr-danger";
  if (level != null && level >= 3) return "arr-success";
  return "arr-warning";
}

/** A card's tilt, fixed by its id: pinned cards are never quite square to the board. */
export function cardTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return ((h % 5) - 2) * 0.3;
}
