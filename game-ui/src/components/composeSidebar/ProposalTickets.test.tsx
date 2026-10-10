import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProposalTickets, { type ProposalEntry } from "./ProposalTickets";

const bindTip = () => ({});

const entry: ProposalEntry = {
  displayName: "Data Validation",
  title: "Implement It Manually",
  detail: "Implement It Manually",
  axis: "automation",
  isEdge: false,
  marks: [],
};

describe("ProposalTickets", () => {
  it("shows a Remove button on an ordinary slotted change", () => {
    render(
      <ProposalTickets entries={[entry]} max={4} onOpen={vi.fn()} onRemove={vi.fn()} bindTip={bindTip} />
    );
    expect(screen.getByLabelText("Remove change")).toBeTruthy();
  });

  it("shows a sealed Hand the Pen slot with no Remove button, occupying a slot", () => {
    render(
      <ProposalTickets
        entries={[]}
        max={4}
        reserved={{ displayName: "Data Validation", holderName: "Data Dave" }}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        bindTip={bindTip}
      />
    );
    expect(screen.getByText(/Data Dave drafts this one/)).toBeTruthy();
    expect(screen.queryByLabelText("Remove change")).toBeNull();
    // 4 slots total, 1 reserved, 3 empty dashes left.
    expect(screen.getByText("Slot 2")).toBeTruthy();
    expect(screen.getByText("Slot 4")).toBeTruthy();
    expect(screen.queryByText("Slot 5")).toBeNull();
  });

  it("shows a revealed delegated change (already in entries) with no Remove button", () => {
    render(
      <ProposalTickets
        entries={[{ ...entry, delegatedToName: "Data Dave" }]}
        max={4}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        bindTip={bindTip}
      />
    );
    expect(screen.getByText(/Data Dave drafts this one/)).toBeTruthy();
    expect(screen.queryByLabelText("Remove change")).toBeNull();
  });
});
