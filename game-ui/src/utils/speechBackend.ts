/**
 * Server-side narration via the `/api/tts` edge-tts route (docs/plans/player-settings-and-tts.md).
 * Same `(text, opts) => () => void` contract `speak()` in `speech.ts` already has, so `speech.ts`
 * can try this first and fall back to the browser path without either caller knowing which one
 * actually spoke. On a fetch failure or non-2xx response this throws instead of calling `onEnd`,
 * so the caller can catch it and trigger that fallback.
 */

import { csrfHeaders } from "./csrf";
import type { SpeakOptions } from "./speech";

const API_HOST =
  import.meta.env.VITE_API_HOST ||
  (import.meta.env.MODE === "development" ? "localhost:8000" : window.location.host);
const PROTOCOL = window.location.protocol === "https:" ? "https:" : "http:";
const BASE_URL = `${PROTOCOL}//${API_HOST}`;

export type BackendSpeakOptions = Pick<SpeakOptions, "slot" | "seed" | "onEnd">;

/**
 * POSTs `text` to the backend and resolves to an object URL for the returned audio. Throws on
 * any fetch failure or non-2xx response. Split out from `speakBackend` so the sentence-by-sentence
 * orchestration in `speech.ts` can fetch the next sentence's audio while the current one is still
 * playing, without waiting on an `HTMLAudioElement` it doesn't need yet.
 */
export async function fetchTtsAudioUrl(
  text: string,
  opts: Pick<BackendSpeakOptions, "slot" | "seed">,
): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/tts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ text, slot: opts.slot, seed: opts.seed ?? null }),
  });

  if (!response.ok) {
    throw new Error(`Backend TTS request failed with status ${response.status}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Fetches and plays `text` as one backend narration via `HTMLAudioElement`, and returns a
 * cancel function that pauses playback and revokes the object URL. Throws on any fetch failure
 * or non-2xx response - the caller decides what "fall back to speechSynthesis" means.
 */
export async function speakBackend(text: string, opts: BackendSpeakOptions): Promise<() => void> {
  const url = await fetchTtsAudioUrl(text, opts);
  const audio = new Audio(url);
  let cancelled = false;

  const cleanup = () => {
    URL.revokeObjectURL(url);
  };

  audio.onended = () => {
    cleanup();
    if (!cancelled) opts.onEnd?.();
  };
  audio.onerror = () => {
    cleanup();
    if (!cancelled) opts.onEnd?.();
  };

  await audio.play();

  return () => {
    cancelled = true;
    audio.pause();
    cleanup();
  };
}
