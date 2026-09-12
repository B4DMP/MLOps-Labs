import { describe, expect, it } from "vitest";
import { phaseLabel, phaseShortLabel } from "./StakeholderDossier";
import type { PhaseData } from "./PhaseProvider";

describe("phaseLabel", () => {
  const phases: PhaseData[] = [
    { id: 0, phase_name: "Introduction" },
    { id: 1, phase_name: "Requirements" },
  ];

  it("returns 'earlier' when no phase index is given", () => {
    expect(phaseLabel(null, phases)).toBe("earlier");
    expect(phaseLabel(undefined, phases)).toBe("earlier");
  });

  it("uses the phase's own name when it has one", () => {
    // Regression test: phaseLabel used to read `.name`, a field PhaseData never had
    // (the real field is `phase_name`), so this always fell through to the numeric
    // fallback below even when a name was available.
    expect(phaseLabel(0, phases)).toBe("Introduction");
    expect(phaseLabel(1, phases)).toBe("Requirements");
  });

  it("falls back to a 1-indexed 'phase N' label when the name is missing", () => {
    expect(phaseLabel(5, phases)).toBe("phase 6");
    expect(phaseLabel(0, [])).toBe("phase 1");
    expect(phaseLabel(0, undefined)).toBe("phase 1");
  });

  it("falls back to the numeric label when phase_name is an empty string", () => {
    expect(phaseLabel(0, [{ id: 0, phase_name: "" }])).toBe("phase 1");
  });
});

describe("phaseShortLabel", () => {
  const phases: PhaseData[] = [
    { id: 0, phase_name: "Introduction" },
    { id: 1, phase_name: "Requirement Engineering" },
    { id: 2, phase_name: "Data Engineering" },
    { id: 3, phase_name: "Model Engineering" },
    { id: 4, phase_name: "Model Deployment" },
    { id: 5, phase_name: "Monitoring/ Usage" },
  ];

  it("gives every phase of the game a word that fits the dock", () => {
    expect([0, 1, 2, 3, 4, 5].map((phase) => phaseShortLabel(phase, phases))).toEqual([
      "INTRO",
      "REQ",
      "DATA",
      "MODEL",
      "DEPLOY",
      "OPS",
    ]);
  });

  it("falls back to a numbered label for a phase it cannot name", () => {
    expect(phaseShortLabel(6, phases)).toBe("P7");
    expect(phaseShortLabel(0, [{ id: 0, phase_name: "Retrospective" }])).toBe("P1");
    expect(phaseShortLabel(null, phases)).toBe("EARLIER");
  });
});
