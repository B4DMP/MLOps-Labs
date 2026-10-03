// Pure logic for the intro coach: seen-once flags, tip resolution and the single-owner rule.
import { COACH_TIPS } from "../content/helpCopy";

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
