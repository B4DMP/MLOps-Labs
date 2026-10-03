import type { AtomicChange } from "../types/ActionCard";

const key = (c: AtomicChange) =>
  JSON.stringify([c.target, c.kind ?? "raise_to", c.axis ?? null, String(c.value ?? ""), c.trigger ?? null]);

/** Mirrors the server's `same_card`: same changes, slot order ignored. An empty last pitch
 *  never counts as a match, since nothing has been pitched yet. */
export function sameAsLastPitch(current: AtomicChange[], last: AtomicChange[]): boolean {
  if (last.length === 0 || current.length !== last.length) return false;
  const a = current.map(key).sort();
  const b = last.map(key).sort();
  return a.every((k, i) => k === b[i]);
}
