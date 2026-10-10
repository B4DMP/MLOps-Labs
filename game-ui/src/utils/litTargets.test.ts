import { describe, expect, it } from "vitest";
import { litTargets } from "./litTargets";

const pages = [
  { intel_items: [{ id: "a", target: "c.store" }, { id: "b", debug: { target: "e.store.reg" } }, { id: "c" }] },
  { intel_items: [{ id: "d", target: "c.other" }] },
];
const stageOf = (id: string) => ({ "c.store": "data", "e.store.reg": "data", "c.other": "model" }[id]);

describe("litTargets", () => {
  it("resolves lit notes to their targets and stages", () => {
    const { targets, stages } = litTargets(new Map([["a", "#fff"], ["b", "#fff"]]), pages, stageOf);
    expect([...targets].sort()).toEqual(["c.store", "e.store.reg"]);
    expect([...stages]).toEqual(["data"]);
  });

  it("ignores notes with no target, unknown ids and an empty set", () => {
    expect(litTargets(new Map([["c", "#fff"], ["zzz", "#fff"]]), pages, stageOf).targets.size).toBe(0);
    expect(litTargets(new Map(), pages, stageOf).targets.size).toBe(0);
  });
});
