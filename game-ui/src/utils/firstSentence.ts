const ABBREVIATION_BEFORE = /\b(?:e\.g|i\.e|vs|etc|approx)\.$/i;

/**
 * The first sentence of authored help text. A component's `help` runs to two sentences: what it
 * is, then a restatement of the steps the option ladder already lists. The composer shows the first.
 */
export function firstSentence(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const stops = /[.!?](?=\s+[A-Z"'(]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = stops.exec(t))) {
    const head = t.slice(0, m.index + 1);
    if (!ABBREVIATION_BEFORE.test(head)) return head;
  }
  return t;
}
