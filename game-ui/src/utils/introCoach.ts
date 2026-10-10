// Pure logic for the intro coach: seen-once flags, tip resolution and the single-owner rule.
import { COACH_TIPS } from "../content/helpCopy";
import { clearComposeGuide } from "./composeGuide";

export type CoachTone = "mistake" | "guide";

export interface CoachTipData {
  id: string;
  title: string;
  body: string;
  tone: CoachTone;
}

export type CoachEvent =
  | { type: "cardBlocked"; reason: "cost" | "used"; cost: number; left: number }
  | { type: "deckOpened"; readiness: "red" | "yellow" | "green" }
  | { type: "evaluated"; predicted: string | null | undefined };

export interface CoachState {
  seen: string[];
  active: CoachTipData | null;
  queued: CoachTipData | null;
}

/** "coach": show the popover. "queued": wait behind a tour or gate. "info": use the hover tag. */
export type ReportOutcome = "coach" | "queued" | "info" | "none";

export const INITIAL_COACH_STATE: CoachState = { seen: [], active: null, queued: null };

const STORAGE_PREFIX = "mlops_intro_coach";

export const coachStorageKey = (userId?: number | null): string =>
  `${STORAGE_PREFIX}:${userId ? userId : "anon"}`;

export function readSeen(userId?: number | null): string[] {
  try {
    const raw = window.localStorage.getItem(coachStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function writeSeen(userId: number | null | undefined, seen: string[]): void {
  try {
    window.localStorage.setItem(coachStorageKey(userId), JSON.stringify(seen));
  } catch {
    // Best effort: without storage a tip may simply show again.
  }
}

/** Drops this player's seen flags (called on account reset, like clearSeenBriefings). */
export function clearIntroCoach(userId?: number | null): void {
  clearComposeGuide(userId);
  try {
    window.localStorage.removeItem(coachStorageKey(userId));
  } catch {
    // Best effort.
  }
}

/** Maps an event to a tip, or null when the event needs no tip. */
export function tipForEvent(event: CoachEvent): CoachTipData | null {
  switch (event.type) {
    case "cardBlocked": {
      const copy = event.reason === "cost" ? COACH_TIPS.cardCost(event.cost, event.left) : COACH_TIPS.cardUsed();
      return { id: event.reason === "cost" ? "cardCost" : "cardUsed", ...copy, tone: "mistake" };
    }
    case "deckOpened":
      return event.readiness === "red" ? { id: "thinIntel", ...COACH_TIPS.thinIntel(), tone: "mistake" } : null;
    case "evaluated":
      return event.predicted === "VETO" ? { id: "likelyVeto", ...COACH_TIPS.likelyVeto(), tone: "mistake" } : null;
  }
}

/** Applies a tip to the state. First sighting shows (or queues); repeats fall back to info. */
export function applyTip(
  state: CoachState,
  tip: CoachTipData,
  opts: { enabled: boolean; blocked: boolean },
): { state: CoachState; outcome: ReportOutcome } {
  if (!opts.enabled) return { state, outcome: "info" };
  if (state.seen.includes(tip.id)) return { state, outcome: "info" };
  if (state.active || opts.blocked) {
    // A tip already open keeps its place; a blocked one waits for the tour or gate to clear.
    if (state.active) return { state, outcome: "info" };
    return { state: { ...state, queued: tip }, outcome: "queued" };
  }
  return { state: { ...state, active: tip, seen: [...state.seen, tip.id] }, outcome: "coach" };
}

export function dismissTip(state: CoachState): CoachState {
  return { ...state, active: null };
}

/** Promotes the queued tip once nothing blocks it. */
export function releaseQueued(state: CoachState, blocked: boolean): CoachState {
  if (blocked || state.active || !state.queued) return state;
  const tip = state.queued;
  if (state.seen.includes(tip.id)) return { ...state, queued: null };
  return { seen: [...state.seen, tip.id], active: tip, queued: null };
}

// Module-level so a tour started anywhere can see that a tip is open.
let tipOpen = false;
export const setCoachTipOpen = (open: boolean): void => {
  tipOpen = open;
};
export const isCoachTipOpen = (): boolean => tipOpen;

export const isTourVisible = (): boolean =>
  typeof document !== "undefined" && document.querySelector(".introjs-tooltip") !== null;

/** Resolves once no coach tip is open, or after `timeoutMs`; used as part of a tour's `beforeStart`. */
export function waitForCoachClear(timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    if (!tipOpen) return resolve();
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (!tipOpen || Date.now() - started > timeoutMs) {
        window.clearInterval(timer);
        resolve();
      }
    }, 250);
  });
}

// Seen-once flags kept by the intro coach (per player, localStorage).
export const GUIDE_KEYS = {
  tour: "introPitchTour",
  verifyPlayed: "guideVerifyPlayed",
  verifyReact: "guideVerifyReact",
  reveal: "guideReveal",
  reactions: "guideReactions",
  skipVerify: "guideSkipVerify",
  skipTalk: "guideSkipTalk",
  skipAsk: "guideSkipAsk",
  skipDeck: "guideSkipDeck",
  off: "guideOff",
} as const;

export type GuideStepId = "verify" | "verifyReact" | "talk" | "ask" | "reveal" | "deck" | "reactions";

export interface GuideFlow {
  /** Nothing else (modal, dialog, composer, tip, tour) is on screen. */
  ready: boolean;
  stage: string;
  isPitchDebating: boolean;
  seen: readonly string[];
  verifyDone: boolean;
  /** A verification result is waiting to be commented on. */
  hasVerifyResult: boolean;
  talkDone: boolean;
  hasActiveConversations: boolean;
  isCardComposed: boolean;
  /** A stakeholder has answered a conversation card question. */
  hasAnswer?: boolean;
  /** Verify Intel was just played and its result has not arrived yet. */
  verifyPending?: boolean;
}

/** Which live guide hint is due, in order: verify, react to it, talk, reveal, deck, reactions. */
export function pickGuideStep(f: GuideFlow): GuideStepId | null {
  if (!f.ready || f.seen.includes(GUIDE_KEYS.off) || f.verifyPending) return null;
  if (f.stage === "PITCHED") {
    return !f.isPitchDebating && !f.seen.includes(GUIDE_KEYS.reactions) ? "reactions" : null;
  }
  if (f.stage !== "PREPARE") return null;
  if (!f.verifyDone && !f.seen.includes(GUIDE_KEYS.skipVerify)) return "verify";
  if (f.hasVerifyResult && !f.seen.includes(GUIDE_KEYS.verifyReact) && !f.talkDone) return "verifyReact";
  if (f.hasActiveConversations && !f.hasAnswer && !f.seen.includes(GUIDE_KEYS.skipAsk)) return "ask";
  if (!f.talkDone && !f.seen.includes(GUIDE_KEYS.skipTalk)) return "talk";
  if (!f.hasActiveConversations && !f.isPitchDebating && !f.seen.includes(GUIDE_KEYS.reveal)) return "reveal";
  if (
    f.seen.includes(GUIDE_KEYS.reveal) &&
    !f.seen.includes(GUIDE_KEYS.skipDeck) &&
    !f.isCardComposed &&
    !f.hasActiveConversations
  ) {
    return "deck";
  }
  return null;
}

// Veto streak per user and challenge, so a reload does not forget a repeated objection.
const streakKey = (userId: number | null | undefined, challengeId: number): string =>
  `mlops_veto_streak:${userId || "anon"}:${challengeId}`;

interface StoredStreak {
  key: string | null;
  n: number;
}

function readStreak(userId: number | null | undefined, challengeId: number): StoredStreak {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(streakKey(userId, challengeId)) || "null");
    if (parsed && typeof parsed.n === "number") return { key: typeof parsed.key === "string" ? parsed.key : null, n: parsed.n };
  } catch {
    // Fall through to an empty streak.
  }
  return { key: null, n: 0 };
}

function writeStreak(userId: number | null | undefined, challengeId: number, value: StoredStreak | null): void {
  try {
    const k = streakKey(userId, challengeId);
    if (value) window.sessionStorage.setItem(k, JSON.stringify(value));
    else window.sessionStorage.removeItem(k);
  } catch {
    // Best effort: the streak then lives in memory only.
  }
}

export const getVetoStreak = readStreak;

/** Registers a veto and returns the streak. The same veto seen again (a reload) does not count twice. */
export function recordVeto(userId: number | null | undefined, challengeId: number, vetoKey: string): number {
  const cur = readStreak(userId, challengeId);
  if (cur.key === vetoKey) return cur.n;
  const next = { key: vetoKey, n: cur.n + 1 };
  writeStreak(userId, challengeId, next);
  return next.n;
}

/** The stage left DONE: the next veto is a new one even if its text is identical. */
export function releaseVetoKey(userId: number | null | undefined, challengeId: number): void {
  const cur = readStreak(userId, challengeId);
  if (cur.key !== null) writeStreak(userId, challengeId, { key: null, n: cur.n });
}

export function resetVetoStreak(userId: number | null | undefined, challengeId: number): void {
  writeStreak(userId, challengeId, null);
}

/** The conversation card the guide points at: Investigate Component. */
export function pickGuideCard<T extends { id: string; token_cost: number }>(cards: readonly T[], tokens: number): T | null {
  const card = cards.find((c) => c.id === "eng_1");
  return card && card.token_cost <= tokens ? card : null;
}
