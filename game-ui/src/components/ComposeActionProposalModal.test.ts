import { describe, expect, it, vi } from "vitest";
import type { AtomicChange } from "../types/ActionCard";
// jsdom cannot run the Lottie player (the composer imports the guide hint).
vi.mock("@lordicon/react", () => ({ Player: () => null }));
import { dedupeAtomicChanges } from "./ComposeActionProposalModal";

/**
 * dedupeAtomicChanges only ever removes a change indistinguishable in every field from another -
 * a target can legitimately carry several different steps chained on the same axis ("Implement
 * It" then "Automate It", one slot each), and those must survive untouched.
 */
describe("dedupeAtomicChanges", () => {
  it("drops an exact duplicate slot", () => {
    const changes: AtomicChange[] = [
      { target: "a", kind: "raise_to", axis: "automation", value: 2 },
      { target: "a", kind: "raise_to", axis: "automation", value: 2 },
    ];
    expect(dedupeAtomicChanges(changes)).toEqual([changes[0]]);
  });

  it("keeps a chain of different steps on the same axis, in order", () => {
    const implementIt: AtomicChange = { target: "req.data_contracts", kind: "raise_to", axis: "automation", value: 2 };
    const automateIt: AtomicChange = { target: "req.data_contracts", kind: "raise_to", axis: "automation", value: 3 };
    expect(dedupeAtomicChanges([implementIt, automateIt])).toEqual([implementIt, automateIt]);
  });

  it("keeps a change on each axis for the same target", () => {
    const automation: AtomicChange = { target: "a", kind: "raise_to", axis: "automation", value: 2 };
    const governance: AtomicChange = { target: "a", kind: "raise_to", axis: "governance", value: 3 };
    expect(dedupeAtomicChanges([automation, governance])).toEqual([automation, governance]);
  });

});
