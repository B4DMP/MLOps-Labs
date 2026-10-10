import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Native `title` tooltips are slow, unstyled and invisible on touch. Use <HoverTooltip>
// (components/HoverToolTip.tsx) instead. Existing offenders are ratcheted in BASELINE: the count
// per file may only go down, and the entry must be deleted once it reaches zero.
const SRC = join(process.cwd(), "src");

// The admin panel keeps native tooltips by decision.
const EXEMPT = new Set(["components/Admin.tsx"]);

// Custom components that forward `title` to a DOM element. Others (Section, CoachTip, ...) use
// `title` as a heading prop and are fine.
const FORWARDING_COMPONENTS = new Set(["IconButton", "Avatar"]);

function forwardsToDom(tag: string): boolean {
  return /^[a-z]/.test(tag) || tag.startsWith("motion.") || FORWARDING_COMPONENTS.has(tag);
}

const BASELINE: Record<string, number> = {};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

function nativeTitleUses(file: string): { line: number; tag: string }[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: { line: number; tag: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "title") {
      const opening = node.parent.parent;
      const tag = (opening as ts.JsxOpeningLikeElement).tagName.getText(sf);
      if (forwardsToDom(tag)) {
        hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, tag });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("native title tooltips", () => {
  const found = new Map<string, { line: number; tag: string }[]>();
  for (const file of sourceFiles(SRC)) {
    const hits = nativeTitleUses(file);
    const rel = relative(SRC, file).replace(/\\/g, "/");
    if (hits.length && !EXEMPT.has(rel)) found.set(rel, hits);
  }

  it("are not introduced beyond the baseline", () => {
    const over = [...found].filter(([f, hits]) => hits.length > (BASELINE[f] ?? 0));
    expect(
      over.map(([f, hits]) => `${f}: ${hits.map((h) => `<${h.tag}> L${h.line}`).join(", ")}`),
      "use <HoverTooltip> instead of title="
    ).toEqual([]);
  });

  it("baseline only lists files that still have offenders", () => {
    const stale = Object.entries(BASELINE).filter(([f, n]) => (found.get(f)?.length ?? 0) < n);
    expect(stale.map(([f]) => f), "lower or delete these BASELINE entries").toEqual([]);
  });
});
