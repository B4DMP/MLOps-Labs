import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import PowerInterestExplainer from "./PowerInterestExplainer";

const cast = [
  { id: "bruce", name: "Bruce", power: "high", interest: "high" },
  { id: "mark", name: "Mark", power: "low", interest: "high" },
];

describe("PowerInterestExplainer", () => {
  it("places each stakeholder in their quadrant", () => {
    render(<PowerInterestExplainer stakeholders={cast} />);
    expect(within(screen.getByTestId("quadrant-high-high")).getByText("Bruce")).toBeTruthy();
    expect(within(screen.getByTestId("quadrant-low-high")).getByText("Mark")).toBeTruthy();
    expect(within(screen.getByTestId("quadrant-low-low")).queryByText("Bruce")).toBeNull();
  });

  it("uses words only", () => {
    const { container } = render(<PowerInterestExplainer stakeholders={cast} />);
    expect(container.textContent).not.toMatch(/[0-9%]/);
  });

  it("calls onClose", () => {
    const onClose = vi.fn();
    render(<PowerInterestExplainer stakeholders={cast} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
