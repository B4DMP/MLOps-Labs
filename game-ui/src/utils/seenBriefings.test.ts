import { afterEach, describe, expect, it } from "vitest";
import { clearSeenBriefings, hasSeenBriefing, markBriefingSeen } from "./seenBriefings";

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

  it("forgets every seen challenge for that username once cleared", () => {
    markBriefingSeen("alice", "0:0");
    markBriefingSeen("alice", "1:0");
    clearSeenBriefings("alice");
    expect(hasSeenBriefing("alice", "0:0")).toBe(false);
    expect(hasSeenBriefing("alice", "1:0")).toBe(false);
  });

  it("clearing one username's mirror leaves another's untouched", () => {
    markBriefingSeen("alice", "0:0");
    markBriefingSeen("bob", "0:0");
    clearSeenBriefings("alice");
    expect(hasSeenBriefing("bob", "0:0")).toBe(true);
  });

  it("does not throw when clearing a username with nothing stored", () => {
    expect(() => clearSeenBriefings("nobody")).not.toThrow();
  });

  it("does not throw when localStorage is unavailable during clear", () => {
    const original = window.localStorage.removeItem;
    window.localStorage.removeItem = () => {
      throw new Error("storage disabled");
    };
    try {
      expect(() => clearSeenBriefings("alice")).not.toThrow();
    } finally {
      window.localStorage.removeItem = original;
    }
  });
});
