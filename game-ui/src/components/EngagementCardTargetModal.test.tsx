import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EngagementCardTargetModal from "./EngagementCardTargetModal";
import type { EngagementCard } from "../types/EngagementCard";

const stakeholders = {
  dave: { id: "dave", name: "Data Dave", avatar: undefined, stakeholder_color: "#111" },
  monica: { id: "monica", name: "Model Monica", avatar: undefined, stakeholder_color: "#222" },
} as any;

const availableStakeholderList = [
  { id: "dave", name: "Data Dave", power: "high", interest: "high" },
  { id: "monica", name: "Model Monica", power: "low", interest: "low" },
];

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  stakeholders,
  availableStakeholderList,
  isStakeholderActive: () => true,
  onConfirmStakeholders: vi.fn(),
  onConfirmIntel: vi.fn(),
  getStakeholderColor: () => "#38bdf8",
  attentionTokens: 10,
};

const investigateComponentCard: EngagementCard = {
  id: "eng_1",
  title: "Investigate Component",
  icon: "ph:user-focus-bold",
  token_cost: 3,
  description: "",
  stakeholder_selection_amount: 1,
  target_type: "stakeholder",
  repeatable_target: true,
};

const patienceResetCard: EngagementCard = {
  id: "eng_5",
  title: "Patience-Reset",
  icon: "ph:hourglass-simple-bold",
  token_cost: 2,
  description: "",
  stakeholder_selection_amount: 1,
  target_type: "stakeholder",
  repeatable_target: true,
  effect_kind: "patience_reset",
};

describe("EngagementCardTargetModal", () => {
  it("never locks an already-targeted stakeholder for a repeatable-target card", () => {
    render(
      <EngagementCardTargetModal
        {...baseProps}
        card={investigateComponentCard}
        cardTargetedStakeholdersMap={{ eng_1: ["dave"] }}
      />
    );
    expect(screen.queryByText(/already targeted by this card/i)).toBeNull();
  });

  it("locks a stakeholder who isn't eligible (not currently impatient) for Patience-Reset", () => {
    render(
      <EngagementCardTargetModal
        {...baseProps}
        card={patienceResetCard}
        cardTargetedStakeholdersMap={{}}
        eligibleStakeholderIds={["dave"]}
      />
    );
    expect(screen.getByText(/not currently impatient/i)).toBeTruthy();
  });

  it("still locks an already-targeted stakeholder for a non-repeatable card", () => {
    const nonRepeatableCard: EngagementCard = { ...investigateComponentCard, id: "eng_3", repeatable_target: false };
    render(
      <EngagementCardTargetModal
        {...baseProps}
        card={nonRepeatableCard}
        cardTargetedStakeholdersMap={{ eng_3: ["dave"] }}
      />
    );
    expect(screen.getAllByText(/already targeted by this card/i).length).toBeGreaterThan(0);
  });
});
