import { forwardRef, useImperativeHandle } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CoachTip, { placeTip } from "./CoachTip";

// jsdom can't run the Lottie player; the animation itself is Lordicon's to test.
vi.mock("@lordicon/react", () => ({
  Player: forwardRef((_props: unknown, ref: React.Ref<{ playFromBeginning: () => void }>) => {
    useImperativeHandle(ref, () => ({ playFromBeginning: () => {} }));
    return <div data-testid="lordicon" />;
  }),
}));

describe("CoachTip", () => {
  it("renders title and body and dismisses", async () => {
    const onDismiss = vi.fn();
    render(<CoachTip title="Look here" body="Check the note." tone="mistake" onDismiss={onDismiss} />);
    expect(screen.getByText("Look here")).toBeInTheDocument();
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

  it("shows the hero icon for a guide step and a warning for a mistake tip", () => {
    const { rerender } = render(<CoachTip body="Hi." icon="talk" />);
    expect(screen.getByTestId("coach-hero")).toBeInTheDocument();
    rerender(<CoachTip body="Hi." tone="mistake" />);
    expect(screen.getByTestId("coach-hero")).toBeInTheDocument();
    rerender(<CoachTip body="Hi." />);
    expect(screen.queryByTestId("coach-hero")).not.toBeInTheDocument();
  });

  it("marks the anchor while open and removes it on close", () => {
    const el = document.createElement("div");
    el.id = "target";
    document.body.appendChild(el);
    const { unmount } = render(<CoachTip body="Here." anchor="#target" spotlight />);
    expect(el).toHaveAttribute("data-coach-spot", "true");
    unmount();
    expect(el).not.toHaveAttribute("data-coach-spot");
    el.remove();
  });

  it("draws a decorative spotlight ring over the anchor", () => {
    const el = document.createElement("div");
    el.id = "ring-target";
    el.getBoundingClientRect = () =>
      ({ top: 100, left: 100, width: 80, height: 40, right: 180, bottom: 140, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    render(<CoachTip body="Here." anchor="#ring-target" spotlight />);
    expect(screen.getByTestId("coach-ring")).toHaveAttribute("aria-hidden", "true");
    el.remove();
  });
});

describe("placeTip", () => {
  const box = { width: 300, height: 100 };

  it("goes below the target when there is room", () => {
    const pos = placeTip(box, { top: 100, left: 400, width: 100, height: 40 }, 1200, 800);
    expect(pos.top).toBeGreaterThan(140);
  });

  it("flips above when there is no room below", () => {
    const pos = placeTip(box, { top: 700, left: 400, width: 100, height: 40 }, 1200, 800);
    expect(pos.top + box.height).toBeLessThan(700);
  });

  it("moves beside a tall target instead of covering it", () => {
    const pos = placeTip(box, { top: 20, left: 20, width: 300, height: 760 }, 1200, 800);
    expect(pos.left).toBeGreaterThanOrEqual(320);
  });

  it("stays inside the viewport and centres at the bottom without a target", () => {
    const pos = placeTip(box, null, 1200, 800);
    expect(pos.left).toBe(450);
    expect(pos.top + box.height).toBeLessThanOrEqual(800);
    const edge = placeTip(box, { top: 100, left: 1190, width: 10, height: 10 }, 1200, 800);
    expect(edge.left + box.width).toBeLessThanOrEqual(1200);
  });
});
