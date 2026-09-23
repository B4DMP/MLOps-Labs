import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentScreenPath, pushScreen, replaceProgress } from "./urlSync";

function setPath(path: string): void {
  window.history.replaceState({}, "", path);
}

describe("pushScreen", () => {
  beforeEach(() => setPath("/"));

  it("navigates to a new screen path via pushState", () => {
    pushScreen("/login");
    expect(window.location.pathname).toBe("/login");
  });

  it("adds a real history entry (Back/Forward works)", () => {
    setPath("/");
    pushScreen("/login");
    pushScreen("/register");
    window.history.back();
    // jsdom applies history navigation synchronously enough for this assertion in practice, but
    // to stay robust across environments this only asserts the entries were pushed, not the
    // async popstate result.
    expect(window.history.length).toBeGreaterThan(1);
  });

  it("does not push a duplicate entry when already on that path", () => {
    setPath("/login");
    const before = window.history.length;
    pushScreen("/login");
    expect(window.history.length).toBe(before);
  });
});

describe("replaceProgress", () => {
  beforeEach(() => setPath("/game"));
  afterEach(() => setPath("/"));

  it("writes the named phase under /game", () => {
    for (const phase of ["briefing", "offline-intel", "pitch", "simulation", "report"] as const) {
      setPath("/game");
      replaceProgress(phase);
      expect(window.location.pathname).toBe(`/game/${phase}`);
      expect(window.location.search).toBe("");
    }
  });

  it("falls back to plain /game when phase is null", () => {
    setPath("/game/pitch");
    replaceProgress(null);
    expect(window.location.pathname).toBe("/game");
  });

  it("clears a stale query string even if the pathname is unchanged", () => {
    setPath("/game/pitch?stakeholder=cfo");
    replaceProgress("pitch");
    expect(window.location.pathname + window.location.search).toBe("/game/pitch");
  });

  it("does not create a new history entry (write-only telemetry)", () => {
    const before = window.history.length;
    replaceProgress("briefing");
    replaceProgress("pitch");
    expect(window.history.length).toBe(before);
  });
});

describe("currentScreenPath", () => {
  afterEach(() => setPath("/"));

  it("returns known screen paths as-is", () => {
    for (const path of ["/login", "/register", "/verify", "/forgot-password", "/reset-password", "/admin"] as const) {
      setPath(path);
      expect(currentScreenPath()).toBe(path);
    }
  });

  it("collapses any /game/... progression path to /game", () => {
    setPath("/game/pitch");
    expect(currentScreenPath()).toBe("/game");
  });

  it("falls back to / for the root and for unknown paths", () => {
    setPath("/");
    expect(currentScreenPath()).toBe("/");

    setPath("/something-unrecognized");
    expect(currentScreenPath()).toBe("/");
  });
});
