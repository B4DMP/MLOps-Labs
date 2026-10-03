import { useCallback, useEffect, useRef } from "react";
import { useSettings } from "./SettingsProvider";
import { cancelSpeech, getSpeechGeneration, isSessionMuted, speakAuto, type CancelReason, type SpeakOptions, type VoiceSlot } from "../utils/speech";

const VOICE_FIELD: Record<VoiceSlot, "voice_male" | "voice_female" | "voice_narrator" | "voice_player"> = {
  male: "voice_male",
  female: "voice_female",
  narrator: "voice_narrator",
  player: "voice_player",
};

/**
 * Wraps `utils/speech.ts` against the settings context: every entry point is a no-op when
 * `mute_tts` is on, and the player's stored voice choice for the slot is applied automatically.
 * Cancels on unmount so leaving a screen mid-sentence never leaves a voice talking over the one
 * that replaces it - but only its own line. Narration is one shared arbiter, and a screen that
 * unmounts late (an exit animation) must not cut off the line the next screen already started.
 */
export function useSpeech() {
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // The arbiter generation of the last line this component started, if it is still playing.
  const lastGenerationRef = useRef<number | null>(null);

  const cancelOwn = useCallback((reason?: CancelReason) => {
    if (lastGenerationRef.current !== null && lastGenerationRef.current === getSpeechGeneration()) {
      cancelSpeech(typeof reason === "string" ? reason : undefined);
    }
    lastGenerationRef.current = null;
  }, []);

  const speakSlot = useCallback((text: string, opts: Omit<SpeakOptions, "voiceName" | "rate" | "playerGender">) => {
    const current = settingsRef.current;
    if (current.mute_tts || isSessionMuted()) {
      opts.onEnd?.();
      return () => {};
    }
    const cancel = speakAuto(text, {
      ...opts,
      voiceName: current[VOICE_FIELD[opts.slot]],
      backend: current.tts_backend,
      rate: current.speech_rate,
      playerGender: current.player_voice_gender,
    });
    lastGenerationRef.current = getSpeechGeneration();
    return cancel;
  }, []);

  useEffect(() => cancelOwn, [cancelOwn]);

  return { speak: speakSlot, cancel: cancelOwn };
}
