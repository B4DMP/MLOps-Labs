import { useCallback, useEffect, useRef } from "react";
import { useSettings } from "./SettingsProvider";
import { cancelSpeech, speakAuto, type SpeakOptions, type VoiceSlot } from "../utils/speech";

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
 * that replaces it.
 */
export function useSpeech() {
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const speakSlot = useCallback((text: string, opts: Omit<SpeakOptions, "voiceName" | "rate" | "playerGender">) => {
    const current = settingsRef.current;
    if (current.mute_tts) {
      opts.onEnd?.();
      return () => {};
    }
    return speakAuto(text, {
      ...opts,
      voiceName: current[VOICE_FIELD[opts.slot]],
      backend: current.tts_backend,
      rate: current.speech_rate,
      playerGender: current.player_voice_gender,
    });
  }, []);

  useEffect(() => () => cancelSpeech(), []);

  return { speak: speakSlot, cancel: cancelSpeech };
}
