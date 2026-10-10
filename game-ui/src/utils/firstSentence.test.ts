import { describe, expect, it } from "vitest";
import { firstSentence } from "./firstSentence";

describe("firstSentence", () => {
  it("keeps only the first of two sentences", () => {
    expect(
      firstSentence(
        "Spells out what counts as done, so nobody argues about it at the end. Implement It Manually writes it by hand, and Owner Sign-off has the owner approve it."
      )
    ).toBe("Spells out what counts as done, so nobody argues about it at the end.");
  });

  it("does not split on an abbreviation or a lowercase continuation", () => {
    expect(firstSentence("Holds models, e.g. the champion. Second one.")).toBe("Holds models, e.g. the champion.");
    expect(firstSentence("Version 2.5 of the store. Next.")).toBe("Version 2.5 of the store.");
  });

  it("returns a single sentence, with or without a stop, and empty input unchanged", () => {
    expect(firstSentence("Just one sentence")).toBe("Just one sentence");
    expect(firstSentence("Just one.")).toBe("Just one.");
    expect(firstSentence(undefined)).toBe("");
    expect(firstSentence("   ")).toBe("");
  });
});
