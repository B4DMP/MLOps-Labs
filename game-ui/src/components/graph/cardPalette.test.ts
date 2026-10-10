import { describe, expect, it } from "vitest";
import { CARD, cardTilt, edgeMarkerForLevel, nodeBar } from "./cardPalette";

const calm = { otherPhase: false, broken: false, uncertain: false, capped: false };

describe("nodeBar", () => {
  it("is plain brown when nothing needs attention, and only then", () => {
    expect(nodeBar(calm).fill).toBe(CARD.bar);
    expect(nodeBar({ ...calm, capped: true }).fill).toBe(CARD.capped);
    expect(nodeBar({ ...calm, uncertain: true }).fill).toBe(CARD.uncertain);
    expect(nodeBar({ ...calm, starved: true }).fill).toBe(CARD.starved);
    expect(nodeBar({ ...calm, broken: true }).fill).toBe(CARD.broken);
  });

  it("lets a problem outrank a lesser one, and a stage you cannot work in outrank everything", () => {
    expect(nodeBar({ ...calm, broken: true, capped: true }).fill).toBe(CARD.broken);
    expect(nodeBar({ ...calm, capped: true, uncertain: true }).fill).toBe(CARD.uncertain);
    expect(nodeBar({ ...calm, otherPhase: true, broken: true }).fill).toBe(CARD.viewOnly);
  });
});

describe("edgeMarkerForLevel", () => {
  it("is red when the hand-off stalls, green when it runs, orange between, and orange when unrated", () => {
    expect(edgeMarkerForLevel(0)).toBe("arr-danger");
    expect(edgeMarkerForLevel(3)).toBe("arr-success");
    expect(edgeMarkerForLevel(1)).toBe("arr-warning");
    expect(edgeMarkerForLevel(undefined)).toBe("arr-warning");
  });
});

describe("cardTilt", () => {
  it("is fixed by the id and never more than a degree", () => {
    expect(cardTilt("req.kpi")).toBe(cardTilt("req.kpi"));
    for (const id of ["a", "req.kpi", "data.contracts", "deploy.canary_ab"]) {
      expect(Math.abs(cardTilt(id))).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });
});
