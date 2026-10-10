import { describe, expect, it } from "vitest";
import { stubSideOccupied } from "./stageCanvas";

const positions = {
  a: { x: 100, y: 100 },
  b: { x: 400, y: 100 }, // level with a, to its right
  c: { x: 120, y: 400 }, // almost straight below a
};
const edges = [
  { from_id: "a", to_id: "b" },
  { from_id: "a", to_id: "c" },
];

describe("stubSideOccupied", () => {
  it("is true on the side a level neighbour's edge arrives at, in either direction of the edge", () => {
    expect(stubSideOccupied("a", true, edges, positions)).toBe(true);
    expect(stubSideOccupied("b", false, edges, positions)).toBe(true);
  });

  it("is false on the other side, and for an edge that meets the top or bottom instead", () => {
    expect(stubSideOccupied("a", false, edges, positions)).toBe(false);
    expect(stubSideOccupied("b", true, edges, positions)).toBe(false);
    expect(stubSideOccupied("c", true, [{ from_id: "a", to_id: "c" }], positions)).toBe(false);
    expect(stubSideOccupied("c", false, [{ from_id: "a", to_id: "c" }], positions)).toBe(false);
  });

  it("is false for a card with no edges or no position", () => {
    expect(stubSideOccupied("a", true, [], positions)).toBe(false);
    expect(stubSideOccupied("zzz", true, edges, positions)).toBe(false);
  });
});
