import { useEffect, useRef } from "react";
import { useSettings } from "./SettingsProvider";
import { useSpeech } from "./useSpeech";
import { useNarratorGate } from "./useNarratorGate";
import { TOUR_GUIDE_SEED, isNarrationBusy, isSessionMuted, waitForNarrationIdle } from "../utils/speech";

/**
 * Reads a guide hint aloud in the narrator voice once per step. Honors the narrator gate, mute
 * settings and auto-skip, waits for the speech queue, and stops when the step changes or goes
 * away. Any failure just leaves the hint silent.
 */
export function useGuideNarration(stepId: string | null, text: string): void {
  const { settings } = useSettings();
  const { speak, cancel } = useSpeech();
  const gate = useNarratorGate();
  const live = useRef({ speak, cancel, request: gate.request, settings });
  live.current = { speak, cancel, request: gate.request, settings };

  useEffect(() => {
    if (!stepId || !text) return;
    const { settings: s } = live.current;
    if (s.mute_tts || s.auto_skip_conversations || isSessionMuted()) return;
    let stale = false;
    (async () => {
      try {
        const allowed = await live.current.request();
        if (stale || allowed === false) return;
        if (isNarrationBusy()) await waitForNarrationIdle();
        if (stale) return;
        live.current.speak(text, { slot: "narrator", seed: TOUR_GUIDE_SEED });
      } catch {
        // Narration is optional; the hint is already on screen.
      }
    })();
    return () => {
      stale = true;
      live.current.cancel();
    };
  }, [stepId, text]);
}
