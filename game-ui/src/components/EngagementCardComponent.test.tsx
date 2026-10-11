import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EngagementCardComponent from "./EngagementCardComponent";
import type { EngagementCard } from "../types/EngagementCard";

const base: EngagementCard = {
  id: "eng_x",
  title: "Some Card",
  icon: "ph:cards-bold",
  token_cost: 2,
  description: "Does something.",
  stakeholder_selection_amount: 1,
  target_type: "stakeholder",
};

describe("EngagementCardComponent", () => {
  it("shows a direct-effect card's effect badge where a gather card shows its turns", () => {
    render(
      <EngagementCardComponent
        isPreview
        card={{ ...base, effect_kind: "pen", effect_label: "Fix Pitch Slot", effect_icon: "ph:pen-nib-bold" }}
      />
    );
    expect(screen.getByText("Fix Pitch Slot")).toBeTruthy();
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("keeps the turns badge on a gather card and shows no effect badge", () => {
    render(<EngagementCardComponent isPreview card={{ ...base, effect_kind: "gather", turns: 1 }} />);
    expect(screen.getByText("+1")).toBeTruthy();
  });
});
