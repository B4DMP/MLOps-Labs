import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import VetoFeedback, { deriveVetoChange } from "./VetoFeedback";
import type { VetoInfo } from "./VetoDialog";

const technical = {
  data: {
    components: [
      {
        id: "data.validation",
        name: "Data Validation",
        nominal_automation: 1,
        automation_options: [
          { to_level: 2, name: "Implement It Manually", description: "x" },
          { to_level: 3, name: "Automate It", description: "y" },
        ],
      },
    ],
  },
} as any;

const info: VetoInfo = {
  stakeholder_id: "b",
  message: "no",
  objection_kind: "boundary",
  objection_detail: "Detail text.",
  objection_target: "data.validation",
  objection_item_id: "item_1",
};

describe("deriveVetoChange", () => {
  it("resolves component and option names from the graph", () => {
    expect(deriveVetoChange(info, technical)).toEqual({ component: "Data Validation", option: "Implement It Manually" });
  });
  it("returns null for non-boundary or unknown targets", () => {
    expect(deriveVetoChange({ ...info, objection_kind: "driver" }, technical)).toBeNull();
    expect(deriveVetoChange({ ...info, objection_target: "nope" }, technical)).toBeNull();
  });
});

describe("VetoFeedback", () => {
  it("names the change and fires both actions", async () => {
    const onShow = vi.fn();
    const onRevise = vi.fn();
    render(<VetoFeedback vetoInfo={info} technical={technical} isRepeat={false} onShowObjection={onShow} onRevise={onRevise} />);
    expect(screen.getByText("Give Data Validation at least Implement It Manually.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Show me the objection/ }));
    await userEvent.click(screen.getByRole("button", { name: /Revise proposal/ }));
    expect(onShow).toHaveBeenCalled();
    expect(onRevise).toHaveBeenCalled();
  });

  it("falls back to the objection text and hides the show button without an item", () => {
    render(
      <VetoFeedback
        vetoInfo={{ ...info, objection_target: null, objection_item_id: null }}
        technical={technical}
        isRepeat={false}
        onShowObjection={vi.fn()}
        onRevise={vi.fn()}
      />,
    );
    expect(screen.getByText("Detail text.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show me the objection/ })).not.toBeInTheDocument();
  });

  it("is more concrete on a repeat veto", () => {
    render(<VetoFeedback vetoInfo={info} technical={technical} isRepeat onShowObjection={vi.fn()} onRevise={vi.fn()} />);
    expect(screen.getByText(/Same objection again/)).toBeInTheDocument();
  });
});
