import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useIntroCoach } from "./useIntroCoach";

afterEach(() => window.localStorage.clear());

const VETO = { type: "evaluated", predicted: "VETO" } as const;

describe("useIntroCoach", () => {
  it("is a no-op outside the intro", () => {
    const { result } = renderHook(() => useIntroCoach(3, { userId: 1 }));
    let res: ReturnType<typeof result.current.report> | undefined;
    act(() => {
      res = result.current.report(VETO);
    });
    expect(res?.outcome).toBe("none");
    expect(result.current.tip).toBeNull();
  });

  it("gives a card mistake an info tag outside the intro", () => {
    const { result } = renderHook(() => useIntroCoach(3, { userId: 1 }));
    let outcome = "";
    act(() => {
      outcome = result.current.report({ type: "cardBlocked", reason: "used", cost: 2, left: 5 }).outcome;
    });
    expect(outcome).toBe("info");
  });

  it("shows a tip once, persists the flag, and falls back to info", () => {
    const first = renderHook(() => useIntroCoach(0, { userId: 5 }));
    act(() => {
      first.result.current.report(VETO);
    });
    expect(first.result.current.tip?.id).toBe("likelyVeto");
    act(() => first.result.current.dismiss());
    expect(first.result.current.tip).toBeNull();

    // A fresh mount (reload) reads the stored flag.
    const second = renderHook(() => useIntroCoach(0, { userId: 5 }));
    let outcome = "";
    act(() => {
      outcome = second.result.current.report(VETO).outcome;
    });
    expect(outcome).toBe("info");
    expect(second.result.current.tip).toBeNull();
  });

  it("queues behind the narrator gate", () => {
    const { result, rerender } = renderHook(({ gateOpen }) => useIntroCoach(0, { userId: 9, gateOpen }), {
      initialProps: { gateOpen: true },
    });
    act(() => {
      result.current.report(VETO);
    });
    expect(result.current.tip).toBeNull();
    rerender({ gateOpen: false });
    expect(result.current.tip?.id).toBe("likelyVeto");
  });
});
