import { afterEach, describe, expect, it } from "vitest";
import { hasSeenBriefing, markBriefingSeen } from "./seenBriefings";

afterEach(() => {
  window.localStorage.clear();
});

describe("seenBriefings", () => {
  it("reports unseen for a challenge that was never marked", () => {
    expect(hasSeenBriefing("alice", "0:0")).toBe(false);
  });

  it("reports seen after marking, and survives being read again (simulating a reload)", () => {
    markBriefingSeen("alice", "0:0");
    expect(hasSeenBriefing("alice", "0:0")).toBe(true);
  });

  it("does not mark other challenges as seen", () => {
    markBriefingSeen("alice", "0:0");
    expect(hasSeenBriefing("alice", "1:0")).toBe(false);
  });

  it("scopes seen state per username", () => {
    markBriefingSeen("alice", "0:0");
    expect(hasSeenBriefing("bob", "0:0")).toBe(false);
  });

  it("is idempotent when marking the same challenge twice", () => {
    markBriefingSeen("alice", "0:0");
    markBriefingSeen("alice", "0:0");
    expect(hasSeenBriefing("alice", "0:0")).toBe(true);
  });

  it("does not throw when localStorage is unavailable", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("storage disabled");
    };
    try {
      expect(() => markBriefingSeen("alice", "0:0")).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
