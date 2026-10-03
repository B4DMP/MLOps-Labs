import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CoachTip from "./CoachTip";

describe("CoachTip", () => {
  it("renders title and body and dismisses", async () => {
    const onDismiss = vi.fn();
    render(<CoachTip title="Heads up" body="Check the note." tone="mistake" onDismiss={onDismiss} />);
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Check the note.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has no dismiss button without a handler", () => {
    render(<CoachTip body="Waiting for you." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("still renders when the anchor is missing", () => {
    render(<CoachTip body="No anchor." anchor='[data-nope="1"]' />);
    expect(screen.getByTestId("coach-tip")).toBeInTheDocument();
  });

  it("rings the anchor while open and removes it on close", () => {
    const el = document.createElement("div");
    el.id = "target";
    document.body.appendChild(el);
    const { unmount } = render(<CoachTip body="Here." anchor="#target" spotlight />);
    expect(el).toHaveAttribute("data-coach-spot", "true");
    unmount();
    expect(el).not.toHaveAttribute("data-coach-spot");
    el.remove();
  });
});
