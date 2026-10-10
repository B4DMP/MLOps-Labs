import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EmotionEmoji from "./EmotionEmoji";

const mockLoadAnimation = vi.fn(() => ({ destroy: vi.fn() }));

vi.mock("lottie-web", () => ({
  default: { loadAnimation: (...args: unknown[]) => mockLoadAnimation(...args) },
}));

describe("EmotionEmoji", () => {
  it("renders nothing for a neutral state", () => {
    const { container } = render(<EmotionEmoji emotionState="neutral" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an unset state", () => {
    const { container } = render(<EmotionEmoji emotionState={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an unrecognized state (falls back to the neutral face)", () => {
    const { container } = render(<EmotionEmoji emotionState="totally-unknown" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a badge for a non-neutral state, with an explanatory label", () => {
    render(<EmotionEmoji emotionState="angry" />);
    expect(screen.getByRole("img", { name: "Feeling Angry" })).toBeInTheDocument();
  });

  it("loads the matching Lottie animation for the state", () => {
    mockLoadAnimation.mockClear();
    render(<EmotionEmoji emotionState="enthusiastic" />);
    expect(mockLoadAnimation).toHaveBeenCalledOnce();
  });

  it("maps a substring match the same way emotionFace.ts does (e.g. 'furious')", () => {
    // "happy"/"positive"/"supportive" substrings map to plain "smile" in emotionFace.ts (the same
    // face as neutral), so those intentionally still render no badge - only a state that maps to
    // one of the 9 non-neutral faces should. "angry" is one of those substrings.
    render(<EmotionEmoji emotionState="feeling furious and angry right now" />);
    expect(
      screen.getByRole("img", { name: "Feeling Feeling furious and angry right now" }),
    ).toBeInTheDocument();
  });

  it("has an explanatory hover title mentioning voices don't change with mood", () => {
    render(<EmotionEmoji emotionState="overwhelmed" />);
    fireEvent.mouseEnter(screen.getByRole("img").parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Feeling Overwhelmed. Voices don't change with mood, so watch for this instead.",
    );
  });
});
