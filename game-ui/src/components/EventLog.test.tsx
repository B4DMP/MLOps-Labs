import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventLog from "./EventLog";
import type { GameEventPayload } from "../types/GameEvent";

function event(overrides: Partial<GameEventPayload> & { seq: number }): GameEventPayload {
  return {
    phase_id: 0,
    challenge_id: 0,
    step: "gather",
    kind: "emotion",
    direction: "none",
    cause: "emotion.reframe_hit",
    params: {},
    refs: {},
    text: `event ${overrides.seq}`,
    ...overrides,
  };
}

describe("EventLog grouping", () => {
  it("keeps the same step from two different phases in separate groups", () => {
    const events = [
      event({ seq: 1, phase_id: 0, challenge_id: 0, step: "gather", text: "first phase gather" }),
      event({ seq: 2, phase_id: 1, challenge_id: 0, step: "gather", text: "second phase gather" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    expect(screen.getAllByText("Gathering intel")).toHaveLength(2);
    expect(screen.getByText("first phase gather")).toBeTruthy();
    expect(screen.getByText("second phase gather")).toBeTruthy();
  });

  it("does not show a phase/challenge badge when only one challenge is in the log", () => {
    const events = [event({ seq: 1, text: "only one" })];
    render(<EventLog events={events} showToggle={false} />);
    expect(screen.queryByText(/Phase 0/)).toBeNull();
  });

  it("shows a phase/challenge badge once a session spans more than one challenge", () => {
    const events = [
      event({ seq: 1, phase_id: 0, challenge_id: 0, text: "a" }),
      event({ seq: 2, phase_id: 1, challenge_id: 2, step: "build", text: "b" }),
    ];
    render(<EventLog events={events} showToggle={false} />);
    expect(screen.getByText(/Phase 1/)).toBeTruthy();
    expect(screen.getByText(/Challenge 2/)).toBeTruthy();
  });

  it("splits a revisited step into two groups instead of pooling both visits together", () => {
    // Same phase/challenge/step (0/0/gather) both times, but with a "build" step in between -
    // a real revisit, not just a duplicate emission. Newest first: build, then the second
    // gather visit, then the first gather visit.
    const events = [
      event({ seq: 1, phase_id: 0, challenge_id: 0, step: "gather", text: "first visit" }),
      event({ seq: 2, phase_id: 0, challenge_id: 0, step: "build", text: "in between" }),
      event({ seq: 3, phase_id: 0, challenge_id: 0, step: "gather", text: "second visit" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    expect(screen.getAllByText("Gathering intel")).toHaveLength(2);
    expect(screen.getByText("first visit")).toBeTruthy();
    expect(screen.getByText("second visit")).toBeTruthy();
    expect(screen.getByText("in between")).toBeTruthy();
  });

  it("keeps duplicate-looking rows from the same visit in one group, not one per row", () => {
    const events = [
      event({ seq: 1, phase_id: 0, challenge_id: 0, step: "gate", text: "next up" }),
      event({ seq: 2, phase_id: 0, challenge_id: 0, step: "gate", text: "next up" }),
      event({ seq: 3, phase_id: 0, challenge_id: 0, step: "gate", text: "next up" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    expect(screen.getAllByText("Milestone gate")).toHaveLength(1);
    expect(screen.getAllByText("next up")).toHaveLength(3);
  });
});

describe("EventLog narrative order", () => {
  it("reads a merged decision+simulation run oldest first, so the decision leads", () => {
    // seq 10: the commit's own outcome event, now logged under "simulation" (not "commit") since
    // this outcome does go on to simulate - it's the run's oldest event and should lead the group.
    // seq 11-12: what followed from it.
    const events = [
      event({ seq: 10, phase_id: 0, challenge_id: 0, step: "simulation", text: "the room came around on raising X to Y" }),
      event({ seq: 11, phase_id: 0, challenge_id: 0, step: "simulation", text: "Data Dave sees it delivered clean" }),
      event({ seq: 12, phase_id: 0, challenge_id: 0, step: "simulation", text: "Model shifted" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    const rows = screen.getAllByText(/room came around|delivered clean|Model shifted/);
    expect(rows.map((r) => r.textContent)).toEqual([
      "the room came around on raising X to Y",
      "Data Dave sees it delivered clean",
      "Model shifted",
    ]);
    // Still one group, not three - same step, same phase/challenge, contiguous in seq.
    expect(screen.getAllByText("Running the simulation")).toHaveLength(1);
  });

  it("still orders separate groups newest first", () => {
    const events = [
      event({ seq: 1, phase_id: 0, challenge_id: 0, step: "gather", text: "earlier" }),
      event({ seq: 2, phase_id: 0, challenge_id: 0, step: "simulation", text: "later" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    const headings = screen.getAllByText(/Running the simulation|Gathering intel/);
    expect(headings.map((h) => h.textContent)).toEqual(["Running the simulation", "Gathering intel"]);
  });
});

describe("EventLog fog of war", () => {
  // @iconify/react resolves no actual icon in jsdom (it renders a bare, classless placeholder
  // span), so the direction arrow can't be asserted on directly - its wrapping HoverTooltip is
  // still there or not, so count of tooltip-wrapped elements on the row is what's checked instead.
  const tooltipWrapperCount = (container: HTMLElement) => container.querySelectorAll('[class*="tooltipWrapper"]').length;

  it("never shows a direction arrow or colored text for a fogged graph move", () => {
    const fogged = [
      event({
        seq: 1,
        kind: "graph",
        cause: "graph.moved_unknown",
        direction: "up",
        magnitude: "slight",
        text: "something changed, unseen",
      }),
    ];
    const named = [
      event({
        seq: 1,
        kind: "graph",
        cause: "graph.moved",
        direction: "up",
        magnitude: "slight",
        text: "Data Ingestion Pipeline moved",
      }),
    ];

    const foggedRender = render(<EventLog events={fogged} showToggle={false} />);
    const foggedTooltips = tooltipWrapperCount(foggedRender.container);
    foggedRender.unmount();

    const namedRender = render(<EventLog events={named} showToggle={false} />);
    const namedTooltips = tooltipWrapperCount(namedRender.container);

    // The named row has one more tooltip-wrapped element than the fogged one: the direction arrow.
    expect(namedTooltips).toBe(foggedTooltips + 1);

    const rowText = screen.getByText("Data Ingestion Pipeline moved");
    expect(rowText.className).toContain("directionUp");

    namedRender.unmount();
    const stillFogged = render(<EventLog events={fogged} showToggle={false} />);
    const foggedRowText = screen.getByText("something changed, unseen");
    expect(foggedRowText.className).not.toContain("directionUp");
    expect(foggedRowText.className).not.toContain("directionDown");
    stillFogged.unmount();
  });
});

describe("EventLog filter counts", () => {
  it("shows how many rows each filter covers, independent of whether it is on", () => {
    const events = [
      event({ seq: 1, kind: "emotion", text: "mood shifted" }),
      event({ seq: 2, kind: "emotion", text: "mood shifted again" }),
      event({ seq: 3, kind: "graph", text: "the graph moved" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    const peopleChip = screen.getByRole("button", { name: /People/ });
    const systemChip = screen.getByRole("button", { name: /System/ });
    expect(within(peopleChip).getByText("2")).toBeTruthy();
    expect(within(systemChip).getByText("1")).toBeTruthy();

    fireEvent.click(systemChip);
    // Turning System off must not change System's own displayed count.
    expect(within(screen.getByRole("button", { name: /System/ })).getByText("1")).toBeTruthy();
  });
});

describe("EventLog search", () => {
  it("filters rows by text, case-insensitively", () => {
    const events = [
      event({ seq: 1, text: "warmer: Data Dave likes this" }),
      event({ seq: 2, text: "colder: the room pushed back" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    fireEvent.change(screen.getByPlaceholderText("Search the log..."), { target: { value: "dave" } });

    expect(screen.getByText("warmer: Data Dave likes this")).toBeTruthy();
    expect(screen.queryByText("colder: the room pushed back")).toBeNull();
  });

  it("clears the search and restores hidden rows", () => {
    const events = [
      event({ seq: 1, text: "warmer: Data Dave likes this" }),
      event({ seq: 2, text: "colder: the room pushed back" }),
    ];
    render(<EventLog events={events} showToggle={false} />);

    const input = screen.getByPlaceholderText("Search the log...");
    fireEvent.change(input, { target: { value: "dave" } });
    fireEvent.click(screen.getByLabelText("Clear search"));

    expect(screen.getByText("colder: the room pushed back")).toBeTruthy();
  });
});

describe("EventLog empty states", () => {
  it("tells the player nothing has happened yet, with no events at all", () => {
    render(<EventLog events={[]} showToggle={false} />);
    expect(screen.getByText("Nothing logged yet")).toBeTruthy();
  });

  it("tells the player their filters hid everything, distinct from a truly empty log", () => {
    const events = [event({ seq: 1, kind: "graph", text: "the graph moved" })];
    render(<EventLog events={events} showToggle={false} />);

    fireEvent.click(screen.getByRole("button", { name: /System/ }));

    expect(screen.getByText("Nothing matches")).toBeTruthy();
  });
});

describe("EventLog filters", () => {
  it("never lets every filter switch off at once", () => {
    const events = [event({ seq: 1, kind: "emotion", text: "mood shifted" })];
    render(<EventLog events={events} showToggle={false} />);

    fireEvent.click(screen.getByRole("button", { name: /People/ }));
    fireEvent.click(screen.getByRole("button", { name: /Intel/ }));
    fireEvent.click(screen.getByRole("button", { name: /Card/ }));
    fireEvent.click(screen.getByRole("button", { name: /System/ }));

    expect(screen.getByText("mood shifted")).toBeTruthy();
  });
});

describe("EventLog rows", () => {
  it("jumps to the intel item when a row that names one is clicked", () => {
    const onItemClick = vi.fn();
    const events = [event({ seq: 1, text: "filed", refs: { item_id: "item-1" } })];
    render(<EventLog events={events} showToggle={false} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText("filed"));
    expect(onItemClick).toHaveBeenCalledWith("item-1");
  });
});
