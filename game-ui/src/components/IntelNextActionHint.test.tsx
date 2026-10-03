import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import IntelNextActionHint, { INTEL_HINT_TEXT, useIntelHintUses } from "./IntelNextActionHint";

describe("IntelNextActionHint", () => {
  afterEach(() => window.localStorage.clear());

  it("shows the copy for each kind", () => {
    render(<IntelNextActionHint kind="known" variant="floating" />);
    expect(screen.getByRole("tooltip")).toHaveTextContent(INTEL_HINT_TEXT.known);
  });

  it("has no digits or em dashes in its copy", () => {
    for (const text of Object.values(INTEL_HINT_TEXT)) {
      expect(text).not.toMatch(/[0-9%—]/);
    }
  });

  it("stops being shown for an action after two uses, remembered per user", () => {
    const { result } = renderHook(() => useIntelHintUses(7));
    expect(result.current.isLearned("tag")).toBe(false);

    act(() => result.current.recordUse("tag"));
    expect(result.current.isLearned("tag")).toBe(false);
    act(() => result.current.recordUse("tag"));
    expect(result.current.isLearned("tag")).toBe(true);
    expect(result.current.isLearned("next")).toBe(false);

    expect(renderHook(() => useIntelHintUses(7)).result.current.isLearned("tag")).toBe(true);
    expect(renderHook(() => useIntelHintUses(8)).result.current.isLearned("tag")).toBe(false);
  });
});
