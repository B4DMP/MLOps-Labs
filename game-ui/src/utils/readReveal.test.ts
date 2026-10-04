import { describe, expect, it } from "vitest";
import { isReadRevealed } from "./readReveal";

describe("isReadRevealed", () => {
  it("shows a stakeholder who spoke in the active pitch", () => {
    expect(isReadRevealed({ spokeNow: true, quiet: false, spokeEarlier: false })).toBe(true);
  });
  it("keeps a quiet stakeholder revealed from an earlier pitch", () => {
    expect(isReadRevealed({ spokeNow: false, quiet: true, spokeEarlier: true })).toBe(true);
  });
  it("blurs a stakeholder who never spoke", () => {
    expect(isReadRevealed({ spokeNow: false, quiet: true, spokeEarlier: false })).toBe(false);
  });
  it("blurs a non-quiet stakeholder while a new pitch is being debated", () => {
    expect(isReadRevealed({ spokeNow: false, quiet: false, spokeEarlier: true })).toBe(false);
  });
});
