import { afterEach, describe, expect, it } from "vitest";
import { clearSeenBriefings, hasSeenBriefing, markBriefingSeen } from "./seenBriefings";

const ALICE = 1;
const BOB = 2;

afterEach(() => {
  window.localStorage.clear();
});

describe("seenBriefings", () => {
  it("reports unseen for a challenge that was never marked", () => {
    expect(hasSeenBriefing(ALICE, "0:0")).toBe(false);
  });

  it("reports seen after marking, and survives being read again (simulating a reload)", () => {
    markBriefingSeen(ALICE, "0:0");
    expect(hasSeenBriefing(ALICE, "0:0")).toBe(true);
  });

  it("does not mark other challenges as seen", () => {
    markBriefingSeen(ALICE, "0:0");
    expect(hasSeenBriefing(ALICE, "1:0")).toBe(false);
  });

  it("scopes seen state per user", () => {
    markBriefingSeen(ALICE, "0:0");
    expect(hasSeenBriefing(BOB, "0:0")).toBe(false);
  });

  it("is idempotent when marking the same challenge twice", () => {
    markBriefingSeen(ALICE, "0:0");
    markBriefingSeen(ALICE, "0:0");
    expect(hasSeenBriefing(ALICE, "0:0")).toBe(true);
  });

  it("does not throw when localStorage is unavailable", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("storage disabled");
    };
    try {
      expect(() => markBriefingSeen(ALICE, "0:0")).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });

  it("forgets every seen challenge for that user once cleared", () => {
    markBriefingSeen(ALICE, "0:0");
    markBriefingSeen(ALICE, "1:0");
    clearSeenBriefings(ALICE);
    expect(hasSeenBriefing(ALICE, "0:0")).toBe(false);
    expect(hasSeenBriefing(ALICE, "1:0")).toBe(false);
  });

  it("clearing one user's mirror leaves another's untouched", () => {
    markBriefingSeen(ALICE, "0:0");
    markBriefingSeen(BOB, "0:0");
    clearSeenBriefings(ALICE);
    expect(hasSeenBriefing(BOB, "0:0")).toBe(true);
  });

  it("does not throw when clearing a user with nothing stored", () => {
    expect(() => clearSeenBriefings(99)).not.toThrow();
  });

  it("does not throw when localStorage is unavailable during clear", () => {
    const original = window.localStorage.removeItem;
    window.localStorage.removeItem = () => {
      throw new Error("storage disabled");
    };
    try {
      expect(() => clearSeenBriefings(ALICE)).not.toThrow();
    } finally {
      window.localStorage.removeItem = original;
    }
  });
});
