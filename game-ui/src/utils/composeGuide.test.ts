import { beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSE_KEYS,
  clearComposeGuide,
  completedKeys,
  chainStatus,
  findCappedStep,
  wantedLevelFor,
  onComposeGuideReset,
  pickComposeStep,
  buildGuideWhy,
  pickGuideTarget,
  plainAutomation,
  resolveMarkers,
  readComposeSeen,
  resetComposeGuide,
  writeComposeSeen,
  type ComposeFlow,
} from "./composeGuide";
import type { GraphOption, OptionTarget } from "./graphOptions";

const base: ComposeFlow = {
  ready: true,
  seen: [],
  canvasPresent: true,
  hasTarget: true,
  nodeSelected: false,
  changeSlotted: false,
  governanceVisible: false,
};
const K = COMPOSE_KEYS;

describe("pickComposeStep", () => {
  it("walks canvas, dials, pick a node, pick an option", () => {
    expect(pickComposeStep(base)).toBe("canvas");
    const s1 = [K.canvas];
    expect(pickComposeStep({ ...base, seen: s1 })).toBe("dials");
    const s2 = [...s1, K.dials];
    expect(pickComposeStep({ ...base, seen: s2 })).toBe("pickNode");
    expect(pickComposeStep({ ...base, seen: s2, nodeSelected: true })).toBe("pickOption");
  });

  it("waits for the player: nothing advances without a click or a slot", () => {
    const seen = [K.canvas, K.dials];
    expect(pickComposeStep({ ...base, seen })).toBe("pickNode");
    expect(pickComposeStep({ ...base, seen, nodeSelected: true })).toBe("pickOption");
  });

  it("moves on to governance, feeds and slots once a change is slotted", () => {
    const seen = [K.canvas, K.dials, K.node, K.option];
    const slotted = { ...base, seen, changeSlotted: true, nodeSelected: true };
    expect(pickComposeStep({ ...slotted, governanceVisible: true })).toBe("governance");
    expect(pickComposeStep(slotted)).toBe("feeds");
    expect(pickComposeStep({ ...slotted, seen: [...seen, K.governance, K.feeds] })).toBe("slots");
    expect(pickComposeStep({ ...slotted, seen: [...seen, K.governance, K.feeds, K.slots] })).toBeNull();
  });

  it("a slotted change (the Hint button too) completes the action steps without a click", () => {
    const seen = [K.canvas, K.dials];
    expect(pickComposeStep({ ...base, seen, changeSlotted: true })).toBe("feeds");
  });

  it("skipping the node step skips the option step unless the player selects the node", () => {
    const seen = [K.canvas, K.dials, K.node];
    expect(pickComposeStep({ ...base, seen })).toBe("feeds");
    expect(pickComposeStep({ ...base, seen, nodeSelected: true })).toBe("pickOption");
    expect(pickComposeStep({ ...base, seen: [...seen, K.option], nodeSelected: true })).toBe("feeds");
  });

  it("skips steps whose anchor is missing", () => {
    const seen = [K.canvas, K.dials];
    expect(pickComposeStep({ ...base, seen, hasTarget: false })).toBe("feeds");
    expect(pickComposeStep({ ...base, seen: [K.dials], canvasPresent: false })).toBeNull();
  });

  it("stays silent when not ready or switched off", () => {
    expect(pickComposeStep({ ...base, ready: false })).toBeNull();
    expect(pickComposeStep({ ...base, seen: [K.off] })).toBeNull();
  });
});

describe("completedKeys", () => {
  it("latches the action steps once a change is slotted", () => {
    expect(completedKeys({ seen: [], changeSlotted: true })).toEqual([K.node, K.option]);
    expect(completedKeys({ seen: [K.node], changeSlotted: true })).toEqual([K.option]);
    expect(completedKeys({ seen: [], changeSlotted: false })).toEqual([]);
  });
});

const opt = (name: string, to_level: number): GraphOption => ({ name, to_level, description: name });
const comp = (id: string, auto = 1): OptionTarget => ({
  id,
  nominal_automation: auto,
  allowed_automation: [0, 1, 2, 3],
  automation_options: [opt("Implement It Manually", 2), opt("Automate It", 3)],
});

describe("pickGuideTarget", () => {
  const components = [comp("a"), comp("data.validation"), comp("b"), comp("c", 3)];
  const input = { components, allowed: [] as string[], driverTargets: [], notedTargets: [], avoid: "data.validation", changes: [] };

  it("never points at the avoided component", () => {
    expect(pickGuideTarget({ ...input, driverTargets: ["data.validation"] })?.target.id).toBe("a");
  });

  it("prefers driver notes, then any notes, then canvas order", () => {
    expect(pickGuideTarget({ ...input, notedTargets: ["b"] })?.target.id).toBe("b");
    expect(pickGuideTarget({ ...input, notedTargets: ["b"], driverTargets: ["a", "b"] })?.target.id).toBe("a");
    expect(pickGuideTarget(input)?.target.id).toBe("a");
  });

  it("respects the allowed targets and names the next option", () => {
    const pick = pickGuideTarget({ ...input, allowed: ["b", "c"] });
    expect(pick?.target.id).toBe("b");
    expect(pick?.option.name).toBe("Implement It Manually");
  });

  it("skips targets with nothing left to add, and returns null when none fit", () => {
    expect(pickGuideTarget({ ...input, components: [comp("c", 3)] })).toBeNull();
  });
});

describe("compose guide storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps flags per user and clears them", () => {
    writeComposeSeen(1, [K.canvas]);
    expect(readComposeSeen(1)).toEqual([K.canvas]);
    expect(readComposeSeen(2)).toEqual([]);
    clearComposeGuide(1);
    expect(readComposeSeen(1)).toEqual([]);
  });

  it("reset clears the flags and notifies a mounted composer", () => {
    writeComposeSeen(3, [K.canvas, K.off]);
    let calls = 0;
    const off = onComposeGuideReset(() => calls++);
    resetComposeGuide(3);
    off();
    expect(readComposeSeen(3)).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe("guide why", () => {
  it("resolves stakeholder markers into names", () => {
    const names: Record<string, string> = { bruce: "Bruce" };
    expect(resolveMarkers("{bruce} wants it and #bruce# too, {zed} not", (id) => names[id])).toBe("Bruce wants it and Bruce too, someone not");
  });

  it("takes the challenge fact and the driver note, dropping notes with digits", () => {
    const why = buildGuideWhy([
      { text: "Nobody owns the feed.", driver: false, fromChallenge: true, who: "the challenge intel" },
      { text: "Collect it while I sleep.", driver: false, fromChallenge: false, who: "Ann" },
      { text: "Wants it automated.", driver: true, fromChallenge: false, who: "Bruce", canStop: true },
      { text: "Run it 24 hours.", driver: true, fromChallenge: false, who: "Zed" },
    ]);
    expect(why.fact).toBe("Nobody owns the feed.");
    expect(why.driver).toEqual({ who: "Bruce", text: "Wants it automated.", canStop: true });
    expect(buildGuideWhy([])).toEqual({ fact: undefined, driver: undefined });
  });

  it("describes an option in plain words, with a fallback", () => {
    expect(plainAutomation(3, "Runs on a schedule.", "Automate It")).toBe("runs on a schedule");
    expect(plainAutomation(3, "Automate It", "Automate It")).toBe("a platform runs it, no person needed");
  });
});

describe("chain-aware target", () => {
  const broken = {
    id: "data.ingestion",
    nominal_automation: 0,
    allowed_automation: [0, 2, 3],
    automation_options: [
      { to_level: 2, name: "Implement It Manually", description: "a" },
      { to_level: 3, name: "Automate It", description: "b" },
    ],
  } as OptionTarget;
  const slot = (value: number) => ({ target: "data.ingestion", kind: "raise_to", axis: "automation", value }) as any;

  it("keeps a raise-further step until the wanted option is slotted", () => {
    const seen = [K.canvas, K.dials, K.node, K.option];
    const flow = { ...base, seen, nodeSelected: true, changeSlotted: true, wantedReached: false };
    expect(pickComposeStep(flow)).toBe("raiseMore");
    expect(pickComposeStep({ ...flow, wantedReached: true })).toBe("feeds");
    expect(completedKeys({ seen, changeSlotted: true, wantedReached: false })).not.toContain(K.more);
    expect(completedKeys({ seen, changeSlotted: true, wantedReached: true })).toContain(K.more);
  });

  it("walks a broken component through both steps", () => {
    const none = chainStatus(broken, 3, [])!;
    expect(none.steps.map((o) => o.to_level)).toEqual([2, 3]);
    expect(none.broken).toBe(true);
    expect(none.reached).toBe(false);
    const first = chainStatus(broken, 3, [slot(2)])!;
    expect(first.reached).toBe(false);
    expect(first.next?.name).toBe("Automate It");
    expect(chainStatus(broken, 3, [slot(2), slot(3)])!.reached).toBe(true);
  });

  it("falls back to the top option when the wanted level is unknown", () => {
    expect(chainStatus(broken, null, [])!.wanted.to_level).toBe(3);
  });

  it("reads the wanted level off an automation driver note", () => {
    const notes = [
      { target: "data.ingestion", suggested_level: 3, suggested_axis: "automation" },
      { target: "data.validation", suggested_level: 2, suggested_axis: "automation" },
    ];
    expect(wantedLevelFor("data.ingestion", notes)).toBe(3);
    expect(wantedLevelFor("x", notes)).toBeNull();
  });
});

describe("findCappedStep", () => {
  const change = { target: "data.validation", kind: "raise_to", axis: "automation", value: 3 } as any;
  const up = (by: string) => (by === "e.ingest_validate" ? "Data Ingestion" : undefined);

  it("finds a slotted step predicted below what was asked", () => {
    const p = [{ target: "data.validation", axis: "automation", asked: 3, predicted: 2, capped_by: "e.ingest_validate" }] as any;
    expect(findCappedStep(p, [change], up)).toEqual({ target: "data.validation", upstream: "Data Ingestion" });
  });
  it("ignores steps that run as asked or are not slotted", () => {
    const ok = [{ target: "data.validation", axis: "automation", asked: 3, predicted: 3, capped_by: "e" }] as any;
    const capped = [{ target: "data.validation", axis: "automation", asked: 3, predicted: 2, capped_by: "e" }] as any;
    expect(findCappedStep(ok, [change], up)).toBeNull();
    expect(findCappedStep(capped, [], up)).toBeNull();
  });
});
