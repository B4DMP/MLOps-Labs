import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_COACH_STATE,
  applyTip,
  clearIntroCoach,
  coachStorageKey,
  dismissTip,
  readSeen,
  releaseQueued,
  tipForEvent,
  writeSeen,
} from "./introCoach";

const veto = tipForEvent({ type: "evaluated", predicted: "VETO" })!;

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("tipForEvent", () => {
  it("maps each event to its tip, or nothing", () => {
    expect(tipForEvent({ type: "cardBlocked", reason: "cost", cost: 4, left: 1 })?.id).toBe("cardCost");
    expect(tipForEvent({ type: "cardBlocked", reason: "used", cost: 4, left: 9 })?.id).toBe("cardUsed");
    expect(tipForEvent({ type: "deckOpened", readiness: "red" })?.id).toBe("thinIntel");
    expect(tipForEvent({ type: "deckOpened", readiness: "green" })).toBeNull();
    expect(veto.id).toBe("likelyVeto");
    expect(tipForEvent({ type: "evaluated", predicted: "PASS" })).toBeNull();
  });

  it("puts live resource counts in the cost tip", () => {
    const tip = tipForEvent({ type: "cardBlocked", reason: "cost", cost: 4, left: 1 })!;
    expect(tip.body).toContain("4");
    expect(tip.body).toContain("1");
  });
});

describe("applyTip", () => {
  it("shows a tip the first time and marks it seen", () => {
    const { state, outcome } = applyTip(INITIAL_COACH_STATE, veto, { enabled: true, blocked: false });
    expect(outcome).toBe("coach");
    expect(state.active?.id).toBe("likelyVeto");
    expect(state.seen).toEqual(["likelyVeto"]);
  });

  it("falls back to the info tag the second time", () => {
    const first = applyTip(INITIAL_COACH_STATE, veto, { enabled: true, blocked: false }).state;
    const again = applyTip(dismissTip(first), veto, { enabled: true, blocked: false });
    expect(again.outcome).toBe("info");
    expect(again.state.active).toBeNull();
  });

  it("uses the info tag outside the intro", () => {
    expect(applyTip(INITIAL_COACH_STATE, veto, { enabled: false, blocked: false }).outcome).toBe("info");
  });

  it("queues behind a tour or gate and releases once clear", () => {
    const queued = applyTip(INITIAL_COACH_STATE, veto, { enabled: true, blocked: true });
    expect(queued.outcome).toBe("queued");
    expect(queued.state.active).toBeNull();
    expect(releaseQueued(queued.state, true).active).toBeNull();
    const released = releaseQueued(queued.state, false);
    expect(released.active?.id).toBe("likelyVeto");
    expect(released.queued).toBeNull();
    expect(released.seen).toContain("likelyVeto");
  });

  it("keeps one tip open at a time", () => {
    const open = applyTip(INITIAL_COACH_STATE, veto, { enabled: true, blocked: false }).state;
    const other = tipForEvent({ type: "deckOpened", readiness: "red" })!;
    const res = applyTip(open, other, { enabled: true, blocked: false });
    expect(res.state.active?.id).toBe("likelyVeto");
    expect(res.outcome).toBe("info");
  });
});

describe("seen flags storage", () => {
  it("round-trips per user", () => {
    writeSeen(7, ["a"]);
    expect(readSeen(7)).toEqual(["a"]);
    expect(readSeen(8)).toEqual([]);
    expect(coachStorageKey(undefined)).toContain("anon");
    clearIntroCoach(7);
    expect(readSeen(7)).toEqual([]);
  });

  it("works with storage unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSeen(1)).toEqual([]);
    expect(() => writeSeen(1, ["a"])).not.toThrow();
    expect(() => clearIntroCoach(1)).not.toThrow();
  });
});
