import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HoverTooltip, { useTooltipController } from "./HoverToolTip";

describe("HoverTooltip", () => {
  it("shows on hover and hides on leave, wiring aria-describedby", () => {
    render(
      <HoverTooltip description="Hello">
        <button>Go</button>
      </HoverTooltip>
    );
    const wrapper = screen.getByText("Go").parentElement!;
    fireEvent.mouseEnter(wrapper);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Hello");
    expect(wrapper.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("works over a disabled control and hides on Escape", () => {
    render(
      <HoverTooltip description="Why disabled">
        <button disabled>Go</button>
      </HoverTooltip>
    );
    fireEvent.mouseEnter(screen.getByText("Go").parentElement!);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("labels an icon-only child when asked, without overriding an existing label", () => {
    const { rerender } = render(
      <HoverTooltip description="Close" labelsChild>
        <button>x</button>
      </HoverTooltip>
    );
    expect(screen.getByText("x").getAttribute("aria-label")).toBe("Close");
    rerender(
      <HoverTooltip description="Close" labelsChild>
        <button aria-label="Dismiss">x</button>
      </HoverTooltip>
    );
    expect(screen.getByText("x").getAttribute("aria-label")).toBe("Dismiss");
  });

  it("renders a rich body and labels the child from ariaText", () => {
    render(
      <HoverTooltip
        description={
          <>
            <b>Title</b>
            <span>Detail</span>
          </>
        }
        ariaText="Title: Detail"
        labelsChild
      >
        <button>x</button>
      </HoverTooltip>
    );
    expect(screen.getByText("x").getAttribute("aria-label")).toBe("Title: Detail");
    fireEvent.mouseEnter(screen.getByText("x").parentElement!);
    expect(screen.getByRole("tooltip").querySelector("b")?.textContent).toBe("Title");
  });

  it("serves many anchors from one controller, including inside an svg", () => {
    function Demo() {
      const tip = useTooltipController();
      return (
        <>
          <svg>
            <g data-testid="a" {...tip.bind("First")} />
            <g data-testid="b" {...tip.bind(<i>Second</i>)} />
            <g data-testid="none" {...tip.bind(undefined)} />
          </svg>
          {tip.bubble}
        </>
      );
    }
    render(<Demo />);
    fireEvent.mouseEnter(screen.getByTestId("a"));
    expect(screen.getByRole("tooltip").textContent).toBe("First");
    fireEvent.mouseLeave(screen.getByTestId("a"));
    fireEvent.mouseEnter(screen.getByTestId("b"));
    expect(screen.getByRole("tooltip").querySelector("i")?.textContent).toBe("Second");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("none"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders children untouched without a description", () => {
    render(
      <HoverTooltip description="">
        <button>Go</button>
      </HoverTooltip>
    );
    expect(screen.getByText("Go").parentElement?.tagName).toBe("DIV");
  });
});
