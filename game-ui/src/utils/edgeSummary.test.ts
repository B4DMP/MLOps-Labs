import { describe, expect, it } from "vitest";
import { describeHandoff } from "./edgeSummary";

describe("describeHandoff", () => {
  it("describes a manual hand-off with no sign-off", () => {
    expect(describeHandoff("A", "B", { automation: 2, governance: 0 })).toBe(
      "Hand-off from A to B. Fires only when asked (manual). Needs no sign-off (not reviewed).",
    );
  });

  it("describes an automated, governed hand-off", () => {
    const s = describeHandoff("A", "B", { automation: 3, governance: 3 });
    expect(s).toContain("Fires by itself (automated).");
    expect(s).toContain("Needs sign-off (fully governed).");
  });

  it("says nothing flows when the hand-off is not working", () => {
    expect(describeHandoff("A", "B", { automation: 0 })).toContain("Broken, so nothing flows.");
    expect(describeHandoff("A", "B", { automation: 1 })).toContain("Not set up yet");
  });

  it("never contains digits", () => {
    expect(describeHandoff("A", "B", { automation: 3, governance: 3 })).not.toMatch(/\d/);
  });
});
