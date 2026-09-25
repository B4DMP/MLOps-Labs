import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActionCardCardComponent from "./ActionCardCardComponent";
import type { ActionCard } from "../types/ActionCard";

/**
 * Regression: a target chained through several steps on one axis ("Implement It" then
 * "Automate It", one authored option/one slot each) shares a single backend prediction across
 * every row (predictions_for keys on (target, axis), not on which step asked) - so `predicted`
 * on it is always the chain's final settled level, never any one row's own step. The minimized
 * card must show each row's own requested level (`ac.value`), not that shared `predicted`.
 */
describe("ActionCardCardComponent minimized card", () => {
  it("names each chained step by its own level, not the chain's final settled level", () => {
    const card: ActionCard = {
      id: "c1",
      title: "Action Proposal",
      description: "",
      atomic_changes: [
        { target: "req.kpi_definition", kind: "raise_to", axis: "automation", value: 2 },
        { target: "req.data_contracts", kind: "raise_to", axis: "automation", value: 2 },
        { target: "req.data_contracts", kind: "raise_to", axis: "automation", value: 3 },
      ],
      // Both data_contracts predictions share the chain's final settled level (3), exactly as
      // the real predictions_for endpoint produces them - one entry per queued change, not per
      // distinct (target, axis).
      predictions: [
        { target: "req.kpi_definition", axis: "automation", asked: 2, predicted: 2, known: true },
        { target: "req.data_contracts", axis: "automation", asked: 2, predicted: 3, known: true },
        { target: "req.data_contracts", axis: "automation", asked: 3, predicted: 3, known: true },
      ],
      target_names: { "req.kpi_definition": "KPI Definition", "req.data_contracts": "Data Contracts" },
    };

    render(<ActionCardCardComponent card={card} isMinimized />);

    // KPI Definition and data_contracts's own first step are both genuinely "Manual".
    expect(screen.getAllByText("Manual")).toHaveLength(2);
    // Exactly one "Automated" badge - data_contracts's second step, not duplicated onto its first.
    expect(screen.getAllByText("Automated")).toHaveLength(1);
  });
});
