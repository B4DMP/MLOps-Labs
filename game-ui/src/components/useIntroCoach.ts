import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_COACH_STATE,
  applyTip,
  dismissTip,
  isTourVisible,
  readSeen,
  releaseQueued,
  setCoachTipOpen,
  tipForEvent,
  writeSeen,
  type CoachEvent,
  type CoachState,
  type CoachTipData,
  type ReportOutcome,
} from "../utils/introCoach";

interface IntroCoachOptions {
  userId?: number | null;
  /** True while the narrator start gate is on screen; tips wait behind it. */
  gateOpen?: boolean;
}

/** Silent mistake tips for the intro phase. Outside it, `report` only says "info" or "none". */
export function useIntroCoach(phaseId: number, { userId, gateOpen = false }: IntroCoachOptions = {}) {
  const enabled = phaseId === 0;
  const [state, setState] = useState<CoachState>(() => ({ ...INITIAL_COACH_STATE, seen: readSeen(userId) }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [tourVisible, setTourVisible] = useState(false);

  // Watch for an intro.js bubble; only while enabled and something could be waiting.
  useEffect(() => {
    if (!enabled) return;
    const check = () => setTourVisible(isTourVisible());
    check();
    const timer = window.setInterval(check, 400);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const blocked = gateOpen || tourVisible;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const commit = useCallback(
    (next: CoachState) => {
      if (next.seen.length !== stateRef.current.seen.length) writeSeen(userId, next.seen);
      stateRef.current = next;
      setState(next);
    },
    [userId],
  );

  useEffect(() => {
    const next = releaseQueued(stateRef.current, blocked);
    if (next !== stateRef.current) commit(next);
  }, [blocked, state.queued, state.active, commit]);

  useEffect(() => {
    setCoachTipOpen(Boolean(state.active));
    return () => setCoachTipOpen(false);
  }, [state.active]);

  const showTip = useCallback(
    (tip: CoachTipData): ReportOutcome => {
      const { state: next, outcome } = applyTip(stateRef.current, tip, { enabled, blocked: blockedRef.current });
      if (next !== stateRef.current) commit(next);
      return outcome;
    },
    [enabled, commit],
  );

  const report = useCallback(
    (event: CoachEvent): { outcome: ReportOutcome; tip: CoachTipData | null } => {
      const tip = tipForEvent(event);
      if (!tip) return { outcome: "none", tip: null };
      // Card mistakes get a small info tag in every phase; the rest only exist in the intro.
      if (!enabled) return { outcome: event.type === "cardBlocked" ? "info" : "none", tip };
      return { outcome: showTip(tip), tip };
    },
    [enabled, showTip],
  );

  const dismiss = useCallback(() => commit(dismissTip(stateRef.current)), [commit]);

  const hasSeen = useCallback((key: string) => stateRef.current.seen.includes(key), []);
  const markSeen = useCallback(
    (key: string) => {
      if (stateRef.current.seen.includes(key)) return;
      commit({ ...stateRef.current, seen: [...stateRef.current.seen, key] });
    },
    [commit],
  );

  return { enabled, tip: state.active, seen: state.seen, blocked, report, dismiss, hasSeen, markSeen };
}
