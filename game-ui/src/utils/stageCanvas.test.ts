import { describe, expect, it } from "vitest";
import {
  BOX_H,
  BOX_W,
  COL_GAP,
  compactLayout,
  referenceCanvas,
  ROW_GAP,
  type PlacedNode,
} from "./stageCanvas";

/**
 * A node should look about the same size in every stage. It does not, if each diagram is
 * simply fitted to its panel: the two-column requirements stage then draws at nearly three
 * times the node size of the four-column deployment one, because fitting scales a small
 * drawing up and a large one down.
 *
 * These tests pin the rule that keeps them comparable: every stage's canvas is at least the
 * reference grid, and a stage wider than the reference gives up spacing before it gives up
 * node size.
 */

/** Nodes on a grid, in the authored coordinate space the real config uses. */
function grid(cols: number, rows: number): PlacedNode[] {
  const nodes: PlacedNode[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      nodes.push({ id: `n${r}-${c}`, layout: { x: 80 + c * 180, y: 100 + r * 120 } });
    }
  }
  return nodes;
}

/** Distance between the centres of two neighbouring columns. */
function colPitch(nodes: PlacedNode[]) {
  const { positions } = compactLayout(nodes);
  return positions["n0-1"].x - positions["n0-0"].x;
}

describe("stage canvas sizing", () => {
  const ref = referenceCanvas();

  it("draws a small stage on the same canvas as the reference grid", () => {
    // Two columns by two rows: the requirements stage. Without the reference floor this
    // canvas would be far smaller than the others, so fitting it to the panel magnified it.
    const small = compactLayout(grid(2, 2));
    expect(small.width).toBe(ref.width);
    expect(small.height).toBe(ref.height);
  });

  it.each([
    [2, 2],
    [3, 2],
  ])("keeps the reference spacing at %ix%i, which fits the reference grid", (cols, rows) => {
    expect(colPitch(grid(cols, rows))).toBe(BOX_W + COL_GAP);
  });

  it("centres a small stage inside the reference canvas rather than pinning it left", () => {
    const { positions } = compactLayout(grid(2, 2));
    const left = positions["n0-0"].x - BOX_W / 2;
    const right = ref.width - (positions["n0-1"].x + BOX_W / 2);
    expect(left).toBeCloseTo(right, 5);
  });

  it("tightens spacing before shrinking nodes when a stage is wider than the reference", () => {
    const wide = colPitch(grid(4, 2));
    expect(wide).toBeLessThan(BOX_W + COL_GAP);
    // Never tighter than the floor: past that, scaling takes over.
    expect(wide).toBeGreaterThanOrEqual(BOX_W + 26);
  });

  it("does the same for a stage that is taller than the reference", () => {
    const { positions } = compactLayout(grid(3, 3));
    const rowPitch = positions["n1-0"].y - positions["n0-0"].y;
    expect(rowPitch).toBeLessThan(BOX_H + ROW_GAP);
    expect(rowPitch).toBeGreaterThanOrEqual(BOX_H + 26);
  });

  it("holds every real stage within a narrow band of the reference node size", () => {
    // The shapes the six stages actually have, from MlopsGraph.json.
    const stages: Array<[string, number, number]> = [
      ["requirements", 2, 2],
      ["data", 4, 2],
      ["modeling", 4, 2],
      ["deployment", 4, 2],
      ["ops", 3, 2],
    ];
    const scales = stages.map(([, cols, rows]) => {
      const { width, height } = compactLayout(grid(cols, rows));
      // How large a node renders, relative to the reference, once the canvas is fitted.
      return Math.min(ref.width / width, ref.height / height);
    });
    expect(Math.min(...scales)).toBeGreaterThan(0.75);
    expect(Math.max(...scales)).toBe(1);
  });
});
