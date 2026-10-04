// Pure logic for the composer guide: which hint is due, which target it points at, seen flags.
import type { AtomicChange } from "../types/ActionCard";
import type { ItemPrediction } from "../types/ActionCard";
import { isRaise, nominalOn, optionStatus, optionsOn, projectedOn, type GraphOption, type OptionTarget } from "./graphOptions";

export type ComposeStepId = "canvas" | "dials" | "pickNode" | "pickOption" | "raiseMore" | "governance" | "feeds" | "slots";

// Own flags (and own storage key), so the pitch guide's "Skip the guide" never silences the composer.
export const COMPOSE_KEYS = {
  canvas: "composeCanvas",
  dials: "composeDials",
  node: "composeNode",
  option: "composeOption",
  more: "composeMore",
  cappedTip: "composeCappedTip",
  governance: "composeGovernance",
  feeds: "composeFeeds",
  slots: "composeSlots",
  off: "composeOff",
} as const;

export interface ComposeFlow {
  /** Intro composer is open and nothing else (dialog, tip, gate, cheat sheet) is on screen. */
  ready: boolean;
  seen: readonly string[];
  canvasPresent: boolean;
  /** A first target and its next automation step were resolved and are on the visible stage. */
  hasTarget: boolean;
  nodeSelected: boolean;
  /** The player slotted something new this visit (a hint button press counts too). */
  changeSlotted: boolean;
  /** The target's slotted automation has reached the wanted step. Absent counts as reached. */
  wantedReached?: boolean;
  /** The selected component shows a governance section. */
  governanceVisible: boolean;
}

/** Which composer hint is due. Action steps wait on live state; a step with nothing to point at is skipped. */
export function pickComposeStep(f: ComposeFlow): ComposeStepId | null {
  const has = (k: string) => f.seen.includes(k);
  if (!f.ready || has(COMPOSE_KEYS.off) || !f.canvasPresent) return null;
  if (!has(COMPOSE_KEYS.canvas)) return "canvas";
  if (!has(COMPOSE_KEYS.dials)) return "dials";
  if (f.hasTarget && !f.changeSlotted && !has(COMPOSE_KEYS.option)) {
    if (f.nodeSelected) return "pickOption";
    if (!has(COMPOSE_KEYS.node)) return "pickNode";
  }
  if (f.hasTarget && f.changeSlotted && f.wantedReached === false && f.nodeSelected && !has(COMPOSE_KEYS.more)) {
    return "raiseMore";
  }
  if (!has(COMPOSE_KEYS.governance) && f.governanceVisible) return "governance";
  if (!has(COMPOSE_KEYS.feeds)) return "feeds";
  if (!has(COMPOSE_KEYS.slots)) return "slots";
  return null;
}

/** Flags the live state already satisfies, so a removed slot does not bring an action step back. */
export function completedKeys(f: Pick<ComposeFlow, "seen" | "changeSlotted" | "wantedReached">): string[] {
  if (!f.changeSlotted) return [];
  const keys: string[] = [COMPOSE_KEYS.node, COMPOSE_KEYS.option];
  if (f.wantedReached === true) keys.push(COMPOSE_KEYS.more);
  return keys.filter((k) => !f.seen.includes(k));
}

export interface ChainStatus {
  /** The step the target's driver asks for (or the top step when unknown). */
  wanted: GraphOption;
  /** Every authored step from the target's current rung up to the wanted one, lowest first. */
  steps: GraphOption[];
  /** The step that can be slotted now on the way there, if any. */
  next?: GraphOption;
  reached: boolean;
  /** The component starts broken, so the first step only repairs it. */
  broken: boolean;
}

/** Where the target stands on the way to the wanted automation step, given the slotted changes. */
export function chainStatus(target: OptionTarget, suggestedLevel: number | null | undefined, changes: AtomicChange[]): ChainStatus | null {
  const opts = optionsOn(target, "automation");
  const wanted = opts.find((o) => o.to_level === suggestedLevel) ?? opts[opts.length - 1];
  if (!wanted) return null;
  const nominal = nominalOn(target, "automation");
  return {
    wanted,
    steps: opts.filter((o) => o.to_level > nominal && o.to_level <= wanted.to_level),
    next: opts.find((o) => o.to_level <= wanted.to_level && optionStatus(target, "automation", o, changes) === "next"),
    reached: projectedOn(target, "automation", changes) >= wanted.to_level,
    broken: nominal === 0,
  };
}

/** The wanted level from the driver notes that name this target on the automation axis. */
export function wantedLevelFor(
  targetId: string,
  notes: ReadonlyArray<{ target?: string | null; suggested_level?: number | null; suggested_axis?: string | null }>,
): number | null {
  const n = notes.find((i) => i.target === targetId && typeof i.suggested_level === "number" && i.suggested_axis === "automation");
  return n ? (n.suggested_level as number) : null;
}

export interface CappedStep {
  /** Component the slotted step is on. */
  target: string;
  /** Component feeding it, when the graph tells us. */
  upstream?: string;
}

/** The first slotted step whose prediction runs below what was asked because of what feeds it. */
export function findCappedStep(
  predictions: readonly ItemPrediction[],
  changes: readonly AtomicChange[],
  upstreamOf: (cappedBy: string) => string | undefined,
): CappedStep | null {
  for (const p of predictions) {
    if (!p.capped_by || p.asked == null || p.predicted == null || p.predicted >= p.asked) continue;
    if (!changes.some((c) => isRaise(c) && c.target === p.target && (!p.axis || c.axis === p.axis))) continue;
    return { target: p.target, upstream: upstreamOf(p.capped_by) };
  }
  return null;
}

export interface GuideTargetInput<T extends OptionTarget> {
  /** Components the player may change in this challenge, in canvas order. */
  components: readonly T[];
  allowed: readonly string[];
  /** Targets of the player's driver notes, then of any notes, most relevant first. */
  driverTargets: readonly string[];
  notedTargets: readonly string[];
  /** The component the Hint button reveals; the guide must not point at it. */
  avoid: string;
  changes: AtomicChange[];
}

/** The first component to try: allowed, with a next automation step, preferring driver then other notes. */
export function pickGuideTarget<T extends OptionTarget>(i: GuideTargetInput<T>): { target: T; option: GraphOption } | null {
  const rank = (id: string) => (i.driverTargets.includes(id) ? 0 : i.notedTargets.includes(id) ? 1 : 2);
  const picks = i.components
    .filter((c) => c.id !== i.avoid && (i.allowed.length === 0 || i.allowed.includes(c.id)))
    .map((target, order) => ({
      target,
      order,
      option: optionsOn(target, "automation").find((o) => optionStatus(target, "automation", o, i.changes) === "next"),
    }))
    .filter((p): p is { target: T; order: number; option: GraphOption } => !!p.option)
    .sort((a, b) => rank(a.target.id) - rank(b.target.id) || a.order - b.order);
  return picks[0] ? { target: picks[0].target, option: picks[0].option } : null;
}

export interface WhyNote {
  text: string;
  driver: boolean;
  /** Challenge-level intel rather than a stakeholder's own note. */
  fromChallenge: boolean;
  who: string;
  /** The note's author is a high-power stakeholder. */
  canStop?: boolean;
}

/** Replaces {stakeholder_id} and #id# markers with names. */
export function resolveMarkers(text: string, nameOf: (id: string) => string | undefined): string {
  return text.replace(/\{([^{}]+)\}|#([^#]+)#/g, (_m, a, b) => nameOf((a ?? b).trim()) ?? "someone");
}

const plain = (t: string) => !/[0-9%]/.test(t);

/** The challenge fact and the stakeholder's own words about a target, or nothing when no note is usable. */
export function buildGuideWhy(
  notes: readonly WhyNote[],
): { fact?: string; driver?: { who: string; text: string; canStop?: boolean } } {
  const usable = notes.filter((n) => n.text.trim() && plain(n.text));
  const fact = usable.find((n) => n.fromChallenge)?.text.trim();
  const own = usable.filter((n) => !n.fromChallenge);
  const d = own.find((n) => n.driver) ?? own[0];
  return { fact, driver: d ? { who: d.who, text: d.text.trim(), canStop: d.canStop } : undefined };
}

/** Plain words for what an automation step does, for when the option has no usable description. */
export function plainAutomation(toLevel: number, description?: string, name?: string): string {
  const d = description?.trim();
  if (d && d !== name?.trim() && plain(d)) return d.replace(/[.!?]$/, "").replace(/^./, (c) => c.toLowerCase());
  return toLevel >= 3 ? "a platform runs it, no person needed" : "it gets built and run by hand, so it exists and works";
}

const STORAGE_PREFIX = "mlops_compose_guide";
const RESET_EVENT = "mlops:compose-guide-reset";

export const composeStorageKey = (userId?: number | null): string => `${STORAGE_PREFIX}:${userId ? userId : "anon"}`;

export function readComposeSeen(userId?: number | null): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(composeStorageKey(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function writeComposeSeen(userId: number | null | undefined, seen: string[]): void {
  try {
    window.localStorage.setItem(composeStorageKey(userId), JSON.stringify(seen));
  } catch {
    // Best effort: without storage a hint may simply show again.
  }
}

export function clearComposeGuide(userId?: number | null): void {
  try {
    window.localStorage.removeItem(composeStorageKey(userId));
  } catch {
    // Best effort.
  }
}

/** Replay: forgets every composer flag and tells a mounted composer to start over. */
export function resetComposeGuide(userId?: number | null): void {
  clearComposeGuide(userId);
  window.dispatchEvent(new Event(RESET_EVENT));
}

export function onComposeGuideReset(listener: () => void): () => void {
  window.addEventListener(RESET_EVENT, listener);
  return () => window.removeEventListener(RESET_EVENT, listener);
}
