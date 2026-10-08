import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BuyInMeter from "./BuyInMeter";

const revealed = { band: "low" as const, isRevealed: true, alignment: -0.6, emotions: 0.2, threshold: 0.4, power: "high" };

describe("BuyInMeter", () => {
  it("shows a locked prompt and no card before a card is picked", () => {
    render(<BuyInMeter info={{ band: "low", isRevealed: false }} />);
    expect(screen.getByText(/Pick a card to see/)).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens a card with the reasons and the veto line on hover", () => {
    render(<BuyInMeter info={revealed} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByLabelText(/Where they stand: Leaning against/));
    const card = screen.getByRole("tooltip");
    expect(card.textContent).toContain("goes against what they asked for");
    expect(card.textContent).toContain("bad mood");
    expect(card.textContent).toContain("they veto the plan");
  });

  it("opens on keyboard focus too", () => {
    render(<BuyInMeter info={revealed} />);
    fireEvent.focus(screen.getByLabelText(/Where they stand/));
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("says a line is crossed and empties the notches", () => {
    render(<BuyInMeter info={{ ...revealed, band: "high", boundaryViolated: true }} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.mouseEnter(screen.getByLabelText(/Line crossed/));
    expect(screen.getByRole("tooltip").textContent).toContain("A line of theirs is crossed");
  });
});
