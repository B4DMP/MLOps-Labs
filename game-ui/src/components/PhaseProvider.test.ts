import { describe, expect, it } from "vitest";
import { isFirstPlayablePhase } from "./PhaseProvider";

const phase = (id: number, phase_name: string) => ({ id, phase_name }) as any;
const withDemo = [phase(0, "Introduction"), phase(1, "Requirement Engineering"), phase(2, "Data Engineering")];
const withoutDemo = [phase(0, "Requirement Engineering"), phase(1, "Data Engineering")];

describe("isFirstPlayablePhase", () => {
  it("counts phase 1 as the first real phase once the demo is behind the player", () => {
    expect(isFirstPlayablePhase(withDemo, 1)).toBe(true);
    expect(isFirstPlayablePhase(withDemo, 2)).toBe(false);
  });

  it("treats the demo itself as a first phase with nothing before it", () => {
    expect(isFirstPlayablePhase(withDemo, 0)).toBe(true);
  });

  it("is phase 0 when there is no demo phase", () => {
    expect(isFirstPlayablePhase(withoutDemo, 0)).toBe(true);
    expect(isFirstPlayablePhase(withoutDemo, 1)).toBe(false);
  });
});
