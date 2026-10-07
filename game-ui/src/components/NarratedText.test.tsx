import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NarratedText from "./NarratedText";

const speak = vi.fn();
const cancel = vi.fn();
vi.mock("./useSpeech", () => ({ useSpeech: () => ({ speak, cancel: vi.fn() }) }));

beforeEach(() => {
  speak.mockReset();
  cancel.mockReset();
  speak.mockReturnValue(cancel);
});

describe("NarratedText", () => {
  it("speaks the lead before the text in the narrator voice", () => {
    render(<NarratedText lead="Card title" text="Pick two people." />);

    expect(speak).toHaveBeenCalledWith("Card title. Pick two people.", expect.objectContaining({ slot: "narrator" }));
  });

  it("highlights the text relative to the lead's sentences", () => {
    const { container } = render(<NarratedText lead="One. Two." text="Three. Four." />);
    const { onSentence } = speak.mock.calls[0][1];

    act(() => onSentence({ index: 3, total: 4, text: "Four." }));

    const states = Array.from(container.querySelectorAll("[data-spoken-state]")).map((el) =>
      el.getAttribute("data-spoken-state"),
    );
    expect(states).toEqual(["spoken", "active"]);
  });

  it("cancels its own line on unmount", () => {
    const { unmount } = render(<NarratedText text="Hello there." />);
    unmount();

    expect(cancel).toHaveBeenCalled();
  });
});
