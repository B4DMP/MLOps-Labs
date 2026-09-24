import { describe, expect, it } from "vitest";
import type { AtomicChange } from "../types/ActionCard";
import {
  addOption,
  changeForOption,
  describeAtomicChange,
  dropUnscopedChanges,
  findGraphTarget,
  optionStatus,
  projectedOn,
  removeChangeAt,
  toggleAttributeOption,
  type OptionTarget,
} from "./graphOptions";

/**
 * The composer's slot rules under the two-axis model
 * (docs/plans/graph-governance-automation-rework/00-plan.md §2.3): one option is one step on
 * one axis and costs one slot, only the next step on an axis can be added, and a step cannot
 * stay in the proposal once the step it builds on is taken out.
 */

const ingestion: OptionTarget = {
  id: "data.ingestion",
  nominal_automation: 1,
  nominal_governance: 0,
  allowed_automation: [0, 1, 2, 3],
  allowed_governance: [0, 1, 2, 3],
  automation_options: [
    { to_level: 3, name: "Managed platform", description: "Runs on a managed automation platform" },
    { to_level: 2, name: "Script by hand", description: "Someone runs a script by hand" },
  ],
  governance_options: [
    { to_level: 1, name: "Spot-check", description: "Spot-check incoming data" },
    { to_level: 2, name: "Lineage", description: "Lineage documentation" },
    { to_level: 3, name: "Board sign-off", description: "Data-governance-board sign-off" },
  ],
  attribute_options: {
    hosting: [
      { to_value: "cloud", name: "Managed cloud", description: "Managed cloud service" },
      { to_value: "on_prem", name: "On-prem", description: "On-prem cluster" },
    ],
  },
};

const handoff: OptionTarget = {
  id: "e.ingest_validate",
  from_id: "data.ingestion",
  automation: 2,
  governance: 0,
  allowed_automation: [0, 1, 2, 3],
  allowed_governance: [0, 3],
  automation_options: [
    { to_level: 2, trigger: "manual_request", name: "Trigger by hand", description: "" },
    { to_level: 3, trigger: "on_data_arrival", name: "On new data", description: "" },
  ],
  governance_options: [{ to_level: 3, name: "Versioned rules", description: "" }],
};

const [scriptStep, platformStep] = [ingestion.automation_options![1], ingestion.automation_options![0]];

describe("option status", () => {
  it("offers only the step directly above the current rung", () => {
    expect(optionStatus(ingestion, "automation", scriptStep, [])).toBe("next");
    expect(optionStatus(ingestion, "automation", platformStep, [])).toBe("later");
  });

  it("offers the following step once the one below it is slotted", () => {
    const changes = addOption([], ingestion, "automation", scriptStep, 3);
    expect(optionStatus(ingestion, "automation", scriptStep, changes)).toBe("slotted");
    expect(optionStatus(ingestion, "automation", platformStep, changes)).toBe("next");
    expect(projectedOn(ingestion, "automation", changes)).toBe(3 - 1);
  });

  it("keeps the axes apart: a governance step does not move automation", () => {
    const changes = addOption([], ingestion, "governance", ingestion.governance_options![0], 3);
    expect(projectedOn(ingestion, "automation", changes)).toBe(1);
    expect(projectedOn(ingestion, "governance", changes)).toBe(1);
  });

  it("marks steps at or below the built rung as done", () => {
    expect(optionStatus(handoff, "automation", handoff.automation_options![0], [])).toBe("done");
    expect(optionStatus(handoff, "automation", handoff.automation_options![1], [])).toBe("next");
  });

  it("follows a target's own rungs when it skips intermediate ones", () => {
    // allowed_governance [0, 3]: one step goes straight to full.
    expect(optionStatus(handoff, "governance", handoff.governance_options![0], [])).toBe("next");
  });
});

describe("adding and removing steps", () => {
  it("always names the axis on a raise, and carries an edge option's trigger", () => {
    expect(changeForOption(handoff, "automation", handoff.automation_options![1])).toEqual({
      target: "e.ingest_validate",
      kind: "raise_to",
      axis: "automation",
      value: 3,
      trigger: "on_data_arrival",
    });
    // A component option never carries a trigger.
    expect(changeForOption(ingestion, "automation", scriptStep).trigger).toBeUndefined();
  });

  it("refuses a step that is not next, and refuses past the slot limit", () => {
    expect(addOption([], ingestion, "automation", platformStep, 3)).toEqual([]);
    const full: AtomicChange[] = [
      { target: "a", kind: "raise_to", axis: "automation", value: 2 },
      { target: "b", kind: "raise_to", axis: "automation", value: 2 },
      { target: "c", kind: "raise_to", axis: "automation", value: 2 },
    ];
    expect(addOption(full, ingestion, "automation", scriptStep, 3)).toBe(full);
  });

  it("takes later steps on the same axis out with the step they build on", () => {
    let changes = addOption([], ingestion, "automation", scriptStep, 3);
    changes = addOption(changes, ingestion, "governance", ingestion.governance_options![0], 3);
    changes = addOption(changes, ingestion, "automation", platformStep, 3);
    expect(changes).toHaveLength(3);

    const after = removeChangeAt(changes, 0);
    expect(after).toEqual([{ target: "data.ingestion", kind: "raise_to", axis: "governance", value: 1 }]);
  });

  it("removing the top step leaves the ones below it", () => {
    let changes = addOption([], ingestion, "automation", scriptStep, 3);
    changes = addOption(changes, ingestion, "automation", platformStep, 3);
    expect(removeChangeAt(changes, 1)).toEqual([changes[0]]);
  });
});

describe("attribute options", () => {
  const [cloud, onPrem] = ingestion.attribute_options!.hosting;

  it("swaps a pick for the same attribute in place instead of taking another slot", () => {
    const one = toggleAttributeOption([], "data.ingestion", "hosting", cloud, 3);
    const swapped = toggleAttributeOption(one, "data.ingestion", "hosting", onPrem, 3);
    expect(swapped).toEqual([{ target: "data.ingestion", kind: "set_attr", attr: "hosting", value: "on_prem" }]);
    expect(toggleAttributeOption(swapped, "data.ingestion", "hosting", onPrem, 3)).toEqual([]);
  });
});

describe("describing and cleaning changes", () => {
  it("names a change by its option, with the axis step as detail", () => {
    const d = describeAtomicChange({ target: "e.ingest_validate", kind: "raise_to", axis: "automation", value: 3, trigger: "on_data_arrival" }, handoff);
    expect(d.title).toBe("On new data");
    expect(d.detail).toBe("Automation → automated, started by on data arrival");
  });

  it("falls back to the axis step when the target is not at hand", () => {
    const d = describeAtomicChange({ target: "x", kind: "raise_to", axis: "governance", value: 3 });
    expect(d.title).toBe("Governance → fully governed");
  });

  it("drops raises that name no axis, which the backend would ignore", () => {
    const legacy: AtomicChange[] = [
      { target: "a", kind: "raise_to", value: 4 },
      { target: "b", kind: "raise_to", axis: "governance", value: 1 },
      { target: "c", kind: "set_attr", attr: "hosting", value: "cloud" },
    ];
    expect(dropUnscopedChanges(legacy).map((c) => c.target)).toEqual(["b", "c"]);
  });

  it("finds components and edges across stages", () => {
    const technical = { data: { components: [ingestion], edges: [handoff] } };
    expect(findGraphTarget(technical, "e.ingest_validate")).toBe(handoff);
    expect(findGraphTarget(technical, "missing")).toBeUndefined();
  });
});
