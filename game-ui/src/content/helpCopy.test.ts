import { describe, expect, it } from "vitest";
import { COACH_EYEBROW, COMPOSE_GUIDE, COACH_TIPS, ESCALATIONS, PITCH_GUIDE, SEAT_CHIPS, VETO_FEEDBACK } from "./helpCopy";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return strings((value as (...a: never[]) => unknown)("Bob" as never, "Opt" as never));
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("helpCopy", () => {
  it("has no digits, percentages or em dashes in player-facing copy", () => {
    const all = [PITCH_GUIDE, SEAT_CHIPS, COACH_EYEBROW, VETO_FEEDBACK].flatMap(strings);
    const tips = [COACH_TIPS.cardUsed(), COACH_TIPS.thinIntel(), COACH_TIPS.likelyVeto()].flatMap(strings);
    for (const text of [...all, ...tips]) {
      expect(text).not.toMatch(/[0-9%]/);
      expect(text).not.toContain("—");
    }
  });

  it("composer guide copy has no digits, percentages or em dashes",() => {
    const g = COMPOSE_GUIDE;
    const all = [g.canvas, g.dials, g.feeds, g.slots, g.pickNode("Data Ingestion"), g.pickNode("Data Ingestion", { fact: "Nobody owns the feed", driver: { who: "Bruce", text: "I want it collected while I sleep." } }), g.pickOption("Automate It", "Data Ingestion", "a platform runs it, no person needed", "Bruce"), g.pickOption("Automate It", "Data Ingestion", "x"), g.governance("Data Ingestion", "Spot Checks", true), g.governance("Data Ingestion", undefined, false)].flatMap(strings);
    for (const text of all) {
      expect(text).not.toMatch(/[0-9%]/);
      expect(text).not.toContain("—");
    }
  });

  it("chain, capped and driver copy is plain and uses live names", () => {
    const more = COMPOSE_GUIDE.raiseMore("Data Ingestion", "Fix It", "Automate It", true, "a platform runs it", "Bruce");
    const capped = [COACH_TIPS.cappedStep("Data Validation", "Data Ingestion"), COACH_TIPS.cappedStep("Data Validation")];
    const driver = [VETO_FEEDBACK.driver("Data Ingestion", "Automate It", { option: "Fix It", broken: true }), VETO_FEEDBACK.driver("Data Ingestion", "Automate It")];
    for (const text of [...strings(more), ...capped.flatMap(strings), ...driver]) {
      expect(text).not.toMatch(/[0-9%]/);
      expect(text).not.toContain("—");
    }
    expect(more.body).toMatch(/is broken.*first Fix It, then Automate It/);
    expect(more.body).not.toMatch(/Validation/);
    expect(capped[0].body).toMatch(/Fix Data Ingestion first/);
    expect(driver[1]).not.toMatch(/two steps/);
  });

  it("composer feeds hint points at the dossier without naming the fix", () => {
    expect(COMPOSE_GUIDE.feeds.body).toMatch(/dossier/);
    expect(COMPOSE_GUIDE.feeds.body).not.toMatch(/Validation/i);
  });

  it("states the level in every seat icon description", () => {
    expect(SEAT_CHIPS.power.high).toMatch(/^High power/);
    expect(SEAT_CHIPS.power.low).toMatch(/^Low power/);
    expect(SEAT_CHIPS.interest.high).toMatch(/^High interest/);
    expect(SEAT_CHIPS.interest.low).toMatch(/^Low interest/);
  });

  it("points the cast step at the bolt and eye next to each name", () => {
    expect(PITCH_GUIDE.cast).toMatch(/bolt and an eye/);
    expect(ESCALATIONS.hint(0)).not.toMatch(/[0-9]/);
  });
});
