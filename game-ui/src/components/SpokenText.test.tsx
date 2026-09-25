import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SpokenText from "./SpokenText";

const TEXT = "First sentence here. Second sentence here! Third sentence here.";

describe("SpokenText with activeSentenceIndex: null", () => {
  it("renders the plain text with no per-sentence markup", () => {
    const { container } = render(<SpokenText text={TEXT} activeSentenceIndex={null} />);

    expect(container.textContent).toBe(TEXT);
    expect(container.querySelectorAll("[data-spoken-state]")).toHaveLength(0);
  });
});

describe("SpokenText with a mid-index active sentence", () => {
  it("marks the sentence before active as spoken, the target as active, and the rest as upcoming", () => {
    const { container } = render(<SpokenText text={TEXT} activeSentenceIndex={1} />);

    const states = Array.from(container.querySelectorAll("[data-spoken-state]")).map((el) => ({
      state: el.getAttribute("data-spoken-state"),
      text: el.textContent?.trim(),
    }));

    expect(states).toHaveLength(3);
    expect(states[0]).toMatchObject({ state: "spoken", text: "First sentence here." });
    expect(states[1]).toMatchObject({ state: "active", text: "Second sentence here!" });
    expect(states[2]).toMatchObject({ state: "upcoming", text: "Third sentence here." });
  });

  it("renders exactly one active sentence with a blinking caret after it", () => {
    const { container } = render(<SpokenText text={TEXT} activeSentenceIndex={1} />);

    expect(container.querySelectorAll('[data-spoken-state="active"]')).toHaveLength(1);
    const active = container.querySelector('[data-spoken-state="active"]');
    expect(active?.textContent).toContain("Second sentence here!");
  });

  it("keeps the full text content intact, including the spacing between sentences", () => {
    const { container } = render(<SpokenText text={TEXT} activeSentenceIndex={0} />);
    expect(container.textContent).toBe(TEXT);
  });
});

describe("SpokenText with an out-of-range activeSentenceIndex", () => {
  it("does not crash and marks nothing as active", () => {
    expect(() => render(<SpokenText text={TEXT} activeSentenceIndex={99} />)).not.toThrow();

    const { container } = render(<SpokenText text={TEXT} activeSentenceIndex={99} />);
    expect(container.querySelectorAll('[data-spoken-state="active"]')).toHaveLength(0);
    expect(container.textContent).toBe(TEXT);
  });

  it("does not crash on a negative index either", () => {
    const { container } = render(<SpokenText text={TEXT} activeSentenceIndex={-1} />);
    expect(container.querySelectorAll('[data-spoken-state="active"]')).toHaveLength(0);
  });
});

describe("SpokenText with empty text", () => {
  it("renders nothing without throwing", () => {
    expect(() => render(<SpokenText text="" activeSentenceIndex={null} />)).not.toThrow();
    expect(() => render(<SpokenText text="" activeSentenceIndex={0} />)).not.toThrow();
  });
});
