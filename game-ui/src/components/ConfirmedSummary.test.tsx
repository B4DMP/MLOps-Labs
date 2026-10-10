import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfirmedSummary, { type ConfirmedSummaryProps } from "./ConfirmedSummary";
import type { SummaryContext } from "./CaseBoard";
import type { StakeholderDossierEntry } from "./StakeholderDossier";

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, intel_type: "verified", categorized_type: "driver", description: `Amy wants thing ${id}.`,
  source: "offline_artifact", target: "data.validation", ...over,
});

const page = (stakeholder_id: string, name: string, intel_items: unknown[]) =>
  ({ stakeholder_id, name, intel_items } as unknown as StakeholderDossierEntry);

const pages = [
  page("amy", "Amy", [item("i1"), item("i2", { source: "public_record" }), item("i3", { intel_type: "unconfirmed" })]),
  page("bob", "Bob", [item("i4", { description: "Bob wants thing i4.", target: "e.ingest_validate" })]),
];

const props = (over: Partial<ConfirmedSummaryProps> = {}): ConfirmedSummaryProps => ({
  pages, stakeholders: {}, colorOf: () => "#38bdf8", statusStamp: () => undefined,
  onOpenStakeholder: vi.fn(), onShowInfo: vi.fn(), onHideInfo: vi.fn(),
  graphTargets: { "data.validation": { name: "Data validation", icon: "ph:target-bold" } }, ...over,
});

const board = (over: Partial<SummaryContext> = {}): SummaryContext => ({
  onlyIds: null, activeStakeholder: null, onActiveStakeholder: vi.fn(), penciled: new Set(), onTogglePencil: vi.fn(), litIds: new Map(), onLitItem: vi.fn(), ...over,
});

describe("ConfirmedSummary", () => {
  it("lists only confirmed notes, one row each, and opens the person's page on a click", () => {
    const onOpenStakeholder = vi.fn();
    render(<ConfirmedSummary {...props({ onOpenStakeholder })} />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // i1, i2, i4; the unconfirmed i3 never shows
    fireEvent.click(screen.getAllByRole("row")[2]);
    expect(onOpenStakeholder).toHaveBeenCalledWith("bob", "i4");
  });

  it("is the plain table on the Challenge-Intel page: no step column, no pencil boxes", () => {
    render(<ConfirmedSummary {...props()} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Step")).toBeNull();
  });

  it("on the board adds pencil boxes and narrows to the notes behind a picked thread", () => {
    const onTogglePencil = vi.fn();
    render(<ConfirmedSummary {...props({ board: board({ onlyIds: new Set(["i1", "i4"]), penciled: new Set(["i4"]), onTogglePencil }) })} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    fireEvent.click(boxes[0]);
    expect(onTogglePencil).toHaveBeenCalledWith("i1", true);
    expect(screen.getByText(/2 of 3 notes behind this thread/)).toBeTruthy();
  });

  it("lights a person's rows and reports hovering one", () => {
    const onActiveStakeholder = vi.fn();
    render(<ConfirmedSummary {...props({ board: board({ activeStakeholder: "bob", onActiveStakeholder }) })} />);
    const rows = screen.getAllByRole("row").slice(1); // the first is the header
    fireEvent.mouseEnter(rows[0]);
    expect(onActiveStakeholder).toHaveBeenCalledWith("amy");
    fireEvent.mouseLeave(rows[0]);
    expect(onActiveStakeholder).toHaveBeenLastCalledWith(null);
  });

  it("keeps the rest of a long note in an inert copy, so the real row never grows or loses its glossary terms", () => {
    const { container } = render(<ConfirmedSummary {...props({ board: board() })} />);
    const peek = container.querySelector("[inert]");
    expect(peek).not.toBeNull();
    expect(peek!.textContent).toContain("thing i1");
  });
});
