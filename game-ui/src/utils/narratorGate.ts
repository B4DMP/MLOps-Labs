/**
 * Narrator start gate store (docs/plans/intro-pitch-handholding.md, section 5). Browsers keep
 * audio off until the page has had a gesture, so a screen about to auto-narrate asks this first.
 * A plain module (not React state) so non-React code such as `tour.ts` can await it too; the
 * `<NarratorGateHost />` component renders it and `useNarratorGate()` is the hook face.
 */

import { getSpeechGeneration, isAudioUnlocked, isSessionMuted, onNarrationEvent, probeAudioUnlocked, unlockAudio } from "./speech";

export interface NarratorGateState {
  open: boolean;
  /** Primary button clicked; waiting for the first sentence to start. */
  loading: boolean;
  /** Reload wording ("Continue with voice") instead of the fresh-start one. */
  compact: boolean;
}

export interface NarratorGateRequest {
  /** `settings.mute_tts`: nothing to gate, narration is a no-op. */
  muted?: boolean;
  /** Narration is auto-skipped by the caller. */
  skip?: boolean;
  compact?: boolean;
}

const CLOSED: NarratorGateState = { open: false, loading: false, compact: false };
/** If no narration starts shortly after the click there is nothing to wait for. */
const NOTHING_STARTED_MS = 600;
const LOADING_BACKSTOP_MS = 10000;

let state: NarratorGateState = CLOSED;
let waiters: Array<(allowed: boolean) => void> = [];
let hostCount = 0;
const listeners = new Set<() => void>();

function setState(next: NarratorGateState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function getNarratorGateState(): NarratorGateState {
  return state;
}

export function subscribeNarratorGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A mounted `<NarratorGateHost />` registers here; without one, requests never block. */
export function registerNarratorGateHost(): () => void {
  hostCount += 1;
  return () => {
    hostCount -= 1;
    if (hostCount === 0 && state.open) declineNarratorGate();
  };
}

/** Reloads and back/forward navigations get the shorter wording. */
function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === "reload" || nav?.type === "back_forward";
  } catch {
    return false;
  }
}

/**
 * Resolves `true` when narration may play (audio is open, or the player just clicked through the
 * gate) and `false` when it should not (muted, skipped, or the player chose to read). While audio
 * is locked the gate opens and every pending request waits behind the one click.
 */
export async function requestNarratorGate(request: NarratorGateRequest = {}): Promise<boolean> {
  if (request.muted || request.skip || isSessionMuted()) return false;
  if (hostCount === 0 || isAudioUnlocked()) return true;
  if (await probeAudioUnlocked()) return true;
  if (!state.open) setState({ open: true, loading: false, compact: request.compact ?? isReloadNavigation() });
  return new Promise<boolean>((resolve) => waiters.push(resolve));
}

/** Primary button: unlock audio inside the click, release the queued narration, then keep the
 *  gate in its loading state until the first sentence starts. */
export function confirmNarratorGate(): void {
  if (!state.open || state.loading) return;
  unlockAudio();
  const generationAtClick = getSpeechGeneration();
  setState({ ...state, loading: true });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    off();
    clearTimeout(nothingTimer);
    clearTimeout(backstopTimer);
    setState(CLOSED);
  };
  const off = onNarrationEvent((e) => {
    if (e.generation > generationAtClick) close();
  });
  const nothingTimer = setTimeout(() => {
    if (getSpeechGeneration() === generationAtClick) close();
  }, NOTHING_STARTED_MS);
  const backstopTimer = setTimeout(close, LOADING_BACKSTOP_MS);

  const released = waiters;
  waiters = [];
  released.forEach((resolve) => resolve(true));
}

/** "Read it myself" / Escape: closes the gate and tells every waiter not to narrate. The host
 *  also mutes narration in the player's settings. */
export function declineNarratorGate(): void {
  if (!state.open) return;
  setState(CLOSED);
  const released = waiters;
  waiters = [];
  released.forEach((resolve) => resolve(false));
}
