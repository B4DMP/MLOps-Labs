import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const introMock = vi.hoisted(() => ({
  exitHandlers: [] as Array<() => void>,
}));

vi.mock("intro.js", () => ({
  default: {
    tour: () => ({
      setOptions: vi.fn(),
      onExit: (fn: () => void) => introMock.exitHandlers.push(fn),
      onComplete: vi.fn(),
      start: () => Promise.resolve(),
      nextStep: vi.fn(),
      exit: vi.fn(),
      refresh: vi.fn(),
    }),
  },
}));

const speechMock = vi.hoisted(() => ({
  generation: 0,
  busy: false,
  listeners: new Set<(e: { generation: number; type: string; handedOff?: boolean }) => void>(),
}));

vi.mock("./speech", () => ({
  getSpeechGeneration: () => speechMock.generation,
  waitForNarrationIdle: () =>
    new Promise<boolean>((resolve) => {
      const poll = () => (speechMock.busy ? setTimeout(poll, 5) : resolve(true));
      poll();
    }),
  onNarrationEvent: (l: (e: { generation: number; type: string; handedOff?: boolean }) => void) => {
    speechMock.listeners.add(l);
    return () => speechMock.listeners.delete(l);
  },
}));

import { startTour } from "./tour";

const emit = (e: { type: string; handedOff?: boolean }) =>
  speechMock.listeners.forEach((l) => l({ generation: speechMock.generation, ...e }));

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("startTour narration", () => {
  let stepEl: HTMLElement;
  // A narrate stub that starts a "line" like speakAuto does: a new generation per call.
  const narrate = vi.fn((_text: string) => {
    speechMock.generation += 1;
    return () => emit({ type: "cancel" });
  });

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    speechMock.generation = 0;
    speechMock.busy = false;
    narrate.mockClear();
    stepEl = document.createElement("div");
    stepEl.setAttribute("data-intro-group", "t");
    stepEl.setAttribute("data-intro", "Step one text.");
    stepEl.setAttribute("data-step", "1");
    stepEl.className = "introjs-showElement";
    document.body.appendChild(stepEl);
  });

  afterEach(() => {
    introMock.exitHandlers.forEach((fn) => fn());
    introMock.exitHandlers.length = 0;
    stepEl.remove();
    vi.unstubAllGlobals();
  });

  it("narrates the first step once the speech queue is idle", async () => {
    speechMock.busy = true;
    startTour("t", { narrate });
    await tick();
    expect(narrate).not.toHaveBeenCalled();

    speechMock.busy = false;
    await tick();
    expect(narrate).toHaveBeenCalledTimes(1);
    expect(narrate).toHaveBeenCalledWith("Step one text.");
  });

  it("retries once when the first line is cancelled before any sentence played", async () => {
    startTour("t", { narrate });
    await tick();
    expect(narrate).toHaveBeenCalledTimes(1);

    emit({ type: "cancel" }); // preempted before it was heard
    await tick(300);
    expect(narrate).toHaveBeenCalledTimes(2);

    emit({ type: "cancel" }); // a second failure is not retried again
    await tick(300);
    expect(narrate).toHaveBeenCalledTimes(2);
  });

  it("does not retry a line that already started, or one that continues on the fallback voice", async () => {
    startTour("t", { narrate });
    await tick();

    emit({ type: "cancel", handedOff: true });
    await tick(300);
    expect(narrate).toHaveBeenCalledTimes(1);

    emit({ type: "sentence" });
    emit({ type: "cancel" });
    await tick(300);
    expect(narrate).toHaveBeenCalledTimes(1);
  });

  it("does not narrate at all when beforeStart resolves false", async () => {
    startTour("t", { narrate, beforeStart: () => Promise.resolve(false) });
    await tick();
    expect(narrate).not.toHaveBeenCalled();
  });

  it("holds the tour until beforeStart resolves", async () => {
    let release!: (allowed: boolean) => void;
    startTour("t", { narrate, beforeStart: () => new Promise<boolean>((r) => (release = r)) });
    await tick();
    expect(narrate).not.toHaveBeenCalled();

    release(true);
    await tick();
    expect(narrate).toHaveBeenCalledTimes(1);
  });
});
