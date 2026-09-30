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

/** A stalled backend request (slow/unresponsive edge-tts call, a dropped connection the browser
 *  never notices) leaves a bare `fetch()` neither resolved nor rejected - forever, since fetch
 *  itself has no built-in timeout. Whatever UI is waiting on this (a loading spinner gating on
 *  "first sentence started") gets stuck right along with it. This bounds the wait so a stall
 *  reliably throws instead, letting the existing fallback-to-webspeech path in speech.ts take
 *  over rather than hanging indefinitely. */
const REQUEST_TIMEOUT_MS = 8000;

export type BackendSpeakOptions = Pick<SpeakOptions, "slot" | "seed" | "onEnd">;

async function fetchTtsAudioUrlOnce(
  text: string,
  opts: Pick<BackendSpeakOptions, "slot" | "seed">,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/tts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ text, slot: opts.slot, seed: opts.seed ?? null }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Backend TTS request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Backend TTS request failed with status ${response.status}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * POSTs `text` to the backend and resolves to an object URL for the returned audio. Throws on
 * any fetch failure, non-2xx response, or timeout - after one retry. A transient blip (a dropped
 * connection, a slow cold start on the first request of a session) shouldn't immediately downgrade
 * a whole narration to the webspeech fallback voice, which is often noticeably worse; the loading
 * state gating on "first sentence started" stays up through the retry instead of flickering to a
 * fallback voice and back. Split out from `speakBackend` so the sentence-by-sentence
 * orchestration in `speech.ts` can fetch the next sentence's audio while the current one is still
 * playing, without waiting on an `HTMLAudioElement` it doesn't need yet.
 */
export async function fetchTtsAudioUrl(
  text: string,
  opts: Pick<BackendSpeakOptions, "slot" | "seed">,
): Promise<string> {
  try {
    return await fetchTtsAudioUrlOnce(text, opts);
  } catch (firstErr) {
    try {
      return await fetchTtsAudioUrlOnce(text, opts);
    } catch {
      throw firstErr;
    }
  }
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
