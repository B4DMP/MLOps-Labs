import { forwardRef, useImperativeHandle } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import VetoDialog, { type VetoInfo } from "./VetoDialog";

// The header's road-barrier animation renders into a shadow root with a constructable stylesheet,
// neither of which jsdom implements. The player's own behaviour is Lordicon's to test, not ours.
vi.mock("@lordicon/react", () => ({
  Player: forwardRef((_props: unknown, ref: React.Ref<{ playFromBeginning: () => void }>) => {
    useImperativeHandle(ref, () => ({ playFromBeginning: () => {} }));
    return <div data-testid="veto-icon" />;
  }),
}));

const VETO_INFO: VetoInfo = {
  stakeholder_id: "automation_alex",
  stakeholder_name: "Alex",
  power: "high",
  message: "I am blocking this.",
  boundary_violated: true,
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof VetoDialog>> = {}) {
  return render(
    <VetoDialog
      isOpen
      onClose={vi.fn()}
      onReviseProposal={vi.fn()}
      vetoInfo={VETO_INFO}
      getStakeholderColor={() => "#000"}
      {...overrides}
    />,
  );
}

describe("VetoDialog", () => {
  it("renders nothing without an open dialog or veto info", () => {
    const { container: closed } = renderDialog({ isOpen: false });
    expect(closed).toBeEmptyDOMElement();

    const { container: noInfo } = renderDialog({ vetoInfo: null });
    expect(noInfo).toBeEmptyDOMElement();
  });

  it("always offers Revise, regardless of escalation points", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /Revise Action Card/ })).toBeInTheDocument();
  });

  it("does not show the Veto Breaker button when no handler is given", () => {
    renderDialog({ escalationPoints: 3 });
    expect(screen.queryByRole("button", { name: /Push It Through/ })).not.toBeInTheDocument();
  });

  it("shows the button enabled, with the count, when points are available", () => {
    renderDialog({ onVetoBreaker: vi.fn(), escalationPoints: 2 });
    const button = screen.getByRole("button", { name: /Push It Through \(2 left\)/ });
    expect(button).toBeEnabled();
  });

  it("disables the button and explains why once points run out", () => {
    renderDialog({ onVetoBreaker: vi.fn(), escalationPoints: 0 });
    const button = screen.getByRole("button", { name: /Push It Through/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No Escalation Points left this playthrough.");
  });

  it("hides the count while it has not arrived yet, and treats it as unusable", () => {
    renderDialog({ onVetoBreaker: vi.fn(), escalationPoints: null });
    const button = screen.getByRole("button", { name: "Push It Through" });
    expect(button).toBeDisabled();
  });

  it("calls the handler on click, only when enabled", async () => {
    const onVetoBreaker = vi.fn();
    renderDialog({ onVetoBreaker, escalationPoints: 1 });

    await userEvent.click(screen.getByRole("button", { name: /Push It Through/ }));
    expect(onVetoBreaker).toHaveBeenCalledTimes(1);
  });

  it("shows a busy state and disables the button while the request is in flight", () => {
    const onVetoBreaker = vi.fn();
    renderDialog({ onVetoBreaker, escalationPoints: 3, isBreakingVeto: true });

    const button = screen.getByRole("button", { name: "Overriding..." });
    expect(button).toBeDisabled();
  });

  it("names the stakeholder who will remember it, in the hint", () => {
    renderDialog({ onVetoBreaker: vi.fn(), escalationPoints: 1 });
    expect(screen.getByRole("button", { name: /Push It Through/ })).toHaveAttribute(
      "title",
      expect.stringContaining("Alex will remember it"),
    );
  });

  it("still fires Revise even when the Veto Breaker is disabled", async () => {
    const onReviseProposal = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onReviseProposal, onClose, onVetoBreaker: vi.fn(), escalationPoints: 0 });

    await userEvent.click(screen.getByRole("button", { name: /Revise Action Card/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReviseProposal).toHaveBeenCalledTimes(1);
  });
});
