/**
 * Colours for the results charts.
 *
 * The categorical slots are the validated default palette from the data-viz method (adjacent
 * colour-vision separation of at least 9 dE, normal-vision separation of at least 19 dE). Three of
 * its slots sit under 3:1 contrast on a light surface, which obliges every chart that uses them to
 * ship visible labels and a table view: `ChartTable` in `parts.tsx` is that relief.
 */

export const SERIES_COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

/** Text and chrome for charts on the light results panel: text always wears an ink token, never
 * the series colour. */
export const CHART_INK = {
  primary: "#1e293b",
  secondary: "#475569",
  grid: "rgba(100, 116, 139, 0.18)",
};

/**
 * A stakeholder's colour, bound to the stakeholder rather than to its rank in this run.
 *
 * `order` is the full configured cast, so a stakeholder keeps their colour whether or not everyone
 * else appeared: a reader who learned that one colour is one person must not be repainted by a
 * run that happened to leave someone out.
 */
export function stakeholderColor(id: string, order: string[]): string {
  const index = order.indexOf(id);
  return SERIES_COLORS[(index < 0 ? 0 : index) % SERIES_COLORS.length];
}

/** Falls back to something readable when the API has no name, rather than showing a raw id. */
export function prettify(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
