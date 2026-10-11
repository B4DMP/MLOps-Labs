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

  it("shows a drafted slot in full, with who drafted it and no Remove button", () => {
    render(
      <ProposalTickets
        entries={[{ ...entry, delegatedToName: "Data Dave" }]}
        max={4}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        bindTip={bindTip}
      />
    );
    expect(screen.getByText(/Data Dave's draft/)).toBeTruthy();
    expect(screen.getByText(/Implement It Manually/)).toBeTruthy();
    expect(screen.queryByLabelText("Remove change")).toBeNull();
    expect(screen.getByLabelText("Locked in by Data Dave")).toBeTruthy();
  });

  it("counts a drafted slot against the four slots", () => {
    render(
      <ProposalTickets
        entries={[{ ...entry, delegatedToName: "Data Dave" }]}
        max={4}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        bindTip={bindTip}
      />
    );
    expect(screen.getByText("Slot 2")).toBeTruthy();
    expect(screen.getByText("Slot 4")).toBeTruthy();
    expect(screen.queryByText("Slot 5")).toBeNull();
  });
});
