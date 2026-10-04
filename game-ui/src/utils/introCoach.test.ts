import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GUIDE_KEYS,
  INITIAL_COACH_STATE,
  type GuideFlow,
  applyTip,
  clearIntroCoach,
  coachStorageKey,
  dismissTip,
  getVetoStreak,
  pickGuideCard,
  pickGuideStep,
  readSeen,
  recordVeto,
  releaseQueued,
  releaseVetoKey,
  resetVetoStreak,
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

describe("pickGuideStep", () => {
  const base: GuideFlow = {
    ready: true,
    stage: "PREPARE",
    isPitchDebating: false,
    seen: [GUIDE_KEYS.tour],
    verifyDone: false,
    hasVerifyResult: false,
    talkDone: false,
    hasActiveConversations: false,
    isCardComposed: false,
  };

  it("walks verify, react, talk, reveal, deck in order", () => {
    expect(pickGuideStep(base)).toBe("verify");
    expect(pickGuideStep({ ...base, verifyDone: true })).toBe("talk");
    expect(pickGuideStep({ ...base, verifyDone: true, hasVerifyResult: true })).toBe("verifyReact");
    const reacted = [GUIDE_KEYS.tour, GUIDE_KEYS.verifyReact];
    expect(pickGuideStep({ ...base, verifyDone: true, hasVerifyResult: true, seen: reacted })).toBe("talk");
    const talked = { ...base, verifyDone: true, talkDone: true, seen: reacted };
    expect(pickGuideStep(talked)).toBe("reveal");
    expect(pickGuideStep({ ...talked, seen: [...reacted, GUIDE_KEYS.reveal] })).toBe("deck");
  });

  it("lets the player skip a single step and moves on", () => {
    expect(pickGuideStep({ ...base, seen: [GUIDE_KEYS.tour, GUIDE_KEYS.skipVerify] })).toBe("talk");
    const skipped = { ...base, verifyDone: true, seen: [GUIDE_KEYS.tour, GUIDE_KEYS.skipTalk] };
    expect(pickGuideStep(skipped)).toBe("reveal");
    const deckSeen = [GUIDE_KEYS.tour, GUIDE_KEYS.reveal, GUIDE_KEYS.skipDeck];
    expect(pickGuideStep({ ...base, verifyDone: true, talkDone: true, seen: deckSeen })).toBeNull();
  });

  it("points at the question panel until a stakeholder has answered", () => {
    const talked = { ...base, verifyDone: true, talkDone: true, hasActiveConversations: true };
    expect(pickGuideStep(talked)).toBe("ask");
    expect(pickGuideStep({ ...talked, hasAnswer: true })).toBeNull();
  });

  it("waits while anything else is on screen or a result is pending", () => {
    expect(pickGuideStep({ ...base, ready: false })).toBeNull();
    expect(pickGuideStep({ ...base, verifyDone: true, verifyPending: true })).toBeNull();
  });

  it("is silent once the guide is skipped and speaks about reactions after a pitch", () => {
    expect(pickGuideStep({ ...base, seen: [GUIDE_KEYS.off] })).toBeNull();
    expect(pickGuideStep({ ...base, stage: "PITCHED" })).toBe("reactions");
    expect(pickGuideStep({ ...base, stage: "PITCHED", seen: [GUIDE_KEYS.reactions] })).toBeNull();
    expect(pickGuideStep({ ...base, stage: "PITCHED", isPitchDebating: true })).toBeNull();
  });
});

describe("veto streak storage", () => {
  afterEach(() => window.sessionStorage.clear());

  it("counts new vetoes, not the same one seen again after a reload", () => {
    expect(recordVeto(1, 113, "a|x")).toBe(1);
    expect(recordVeto(1, 113, "a|x")).toBe(1);
    expect(getVetoStreak(1, 113).n).toBe(1);
  });

  it("counts an identical veto again once the key was released", () => {
    recordVeto(1, 113, "a|x");
    releaseVetoKey(1, 113);
    expect(recordVeto(1, 113, "a|x")).toBe(2);
  });

  it("resets on a pass and is kept per challenge", () => {
    recordVeto(1, 113, "a|x");
    expect(recordVeto(1, 114, "a|x")).toBe(1);
    resetVetoStreak(1, 113);
    expect(getVetoStreak(1, 113).n).toBe(0);
  });
});

describe("pickGuideCard", () => {
  const cards = [
    { id: "eng_2", title: "Probe", token_cost: 3 },
    { id: "eng_4", title: "Ask", token_cost: 1 },
  ];
  it("prefers the probe card, falls back to the cheap one, else none", () => {
    expect(pickGuideCard(cards, 10)?.id).toBe("eng_2");
    expect(pickGuideCard(cards, 2)?.id).toBe("eng_4");
    expect(pickGuideCard(cards, 0)).toBeNull();
  });
});
