/**
 * Thin wrapper over `window.speechSynthesis` (docs/plans/player-settings-and-tts.md).
 *
 * Four voice slots, not two: `male` and `female` speak stakeholders and are seeded per speaker
 * id so the same stakeholder sounds the same every session; `narrator` reads intel artifacts
 * and `player` reads the player's own pitch lines, both unseeded since each is one speaker.
 *
 * `SpeechSynthesisVoice` carries no gender, so a slot is resolved by regex over the voice's
 * name, covering the Windows/macOS names players are likely to have installed plus the Linux
 * tiers speech-dispatcher's engines tend to produce (espeak-ng's language-only names give no
 * signal at all, which is the common Linux outcome the "no match" fallback below covers).
 *
 * The automatic choice prefers online (network, `localService: false`) voices: those are the
 * neural ones, and they carry a long artifact far better than the bundled local voices. They
 * need the network, so `speak` falls back to a local voice for the rest of a line once an online
 * one fails. A voice the player picked by hand in the settings panel always wins over both.
 */

import { fetchTtsAudioUrl } from "./speechBackend";

/**
 * Browsers refuse a bare `<audio>.play()` outright until the *document itself* has had a real
 * gesture (Chrome's exact wording: "play() failed because the user didn't interact with the
 * document first") - not "a gesture happened at some point in this app", but this specific
 * document, which a full reload (or a fresh tab landing straight back in an auto-opened dialog
 * via a restored session) has never had yet, even if the player clicked plenty before that
 * reload. No amount of pre-warming from inside a click handler helps a *later, gestureless*
 * `.play()` call - by definition nothing has happened between the gesture and that later call.
 * `window.speechSynthesis.speak()` has no such restriction, which is why an unlucky first
 * narration of a session reads as "the fallback voice, just this once".
 *
 * So instead of trying to dodge the restriction, `waitForAudioUnlock()` below makes the first
 * backend narration of a session wait for that gesture rather than immediately downgrading to
 * the worse fallback voice - matching what the player already asked for elsewhere (a loading
 * state instead of an eager fallback). Capped by `AUDIO_UNLOCK_TIMEOUT_MS` so a session that
 * genuinely never gets a gesture (e.g. a hands-off demo) still narrates eventually.
 */
let audioUnlocked = false;
let audioUnlockWaiters: Array<() => void> = [];

function markAudioUnlocked(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  audioUnlockWaiters.forEach((resolve) => resolve());
  audioUnlockWaiters = [];
}

function installAudioUnlock(): void {
  if (typeof document === "undefined") return;
  const unlock = () => {
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
    markAudioUnlocked();
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}
installAudioUnlock();

/** In practice a session only ever reaches this ungestured state via a fresh reload/restore
 *  straight into an auto-narrating screen - the player already clicked "Next"/whatever got them
 *  there in every normal playthrough. 5s is plenty for that reload case without leaving a real,
 *  hands-off session waiting long. */
const AUDIO_UNLOCK_TIMEOUT_MS = 5000;

/** Resolves once the document has had a real gesture, or immediately if it already has one.
 *  Times out rather than waiting forever, for a session that never gets a gesture at all. */
function waitForAudioUnlock(): Promise<void> {
  if (audioUnlocked) return Promise.resolve();
  return new Promise((resolve) => {
    const onUnlock = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      audioUnlockWaiters = audioUnlockWaiters.filter((w) => w !== onUnlock);
      resolve();
    }, AUDIO_UNLOCK_TIMEOUT_MS);
    audioUnlockWaiters.push(onUnlock);
  });
}

export type VoiceSlot = "male" | "female" | "narrator" | "player";

/* The exact neural voice names `voice_and_prosody` in tts_service.py picks from for each slot
 * (VOICE_POOLS/FIXED_VOICES/PLAYER_VOICES) - matching one of these here, even on a local/offline
 * voice, means the webspeech fallback still sounds like the same voice family the backend would
 * have used, rather than whatever the OS happens to default to. Word-bounded so they cannot
 * match inside an unrelated longer name. */
const NEURAL_VOICE_NAMES: Record<"male" | "female" | "narrator", RegExp> = {
  male: /\b(andrew|guy|christopher|eric|brian)\b/i,
  female: /\b(michelle|jenny|aria|emma|ava)\b/i,
  narrator: /\bryan\b/i,
};

/* Old, low-quality voices bundled with every Windows/macOS install (David/Zira/Samantha/
 * Victoria/Alex/Fred), plus the espeak-ng/festival tiers speech-dispatcher's engines tend to
 * produce on Linux. Only ever reached for once no NEURAL_VOICE_NAMES match is installed - these
 * used to share top priority with the good names above, which is what made the fallback default
 * to a robotic system voice ("Microsoft David Desktop") the instant no online voice was present,
 * even though better-than-that local voices often exist. */
const LEGACY_VOICE_NAMES: Record<"male" | "female", RegExp> = {
  male: /(david|alex|fred|awb|rms|bdl|ksp|kal|m[1-5]\b)/i,
  female: /(zira|samantha|victoria|slt|clb|eva|f[1-5]\b)/i,
};

const BASELINE_PITCH: Record<VoiceSlot, number> = {
  male: 0.95,
  female: 1.1,
  narrator: 1.0,
  player: 1.0,
};

/** Stakeholders are seeded on their id, so the same one always sounds the same. Narrator and
 * player are each a single speaker, and a wobbling pitch on the voice reading every artifact
 * would just sound unstable. */
const SEEDED_SLOTS = new Set<VoiceSlot>(["male", "female"]);

const PITCH_MIN = 0;
const PITCH_MAX = 2;
const RATE_MIN = 0.5;
const RATE_MAX = 2;
/** With only 6 shipped stakeholders splitting 2 gender slots (so ~3 per slot, sharing one
 * installed voice), a narrow spread leaves real hash collisions audible - Efficiency Erica and
 * Reliability Ruth landed 0.07 apart at the original 0.15 (still only 0.14 apart after doubling
 * it once), and kept being reported as sounding the same: `utterance.pitch`'s 0-2 scale is not
 * semitones, and most engines only render clear differences over a wide chunk of that range.
 * This puts the same pair about 0.24 apart, over 3x the original gap. */
const PITCH_SPREAD = 0.5;

/** Chrome's network-backed voices cut off after roughly 15s of continuous speech, so long text
 * is chunked at sentence boundaries into utterances of about this many characters. */
const MAX_CHUNK_CHARS = 200;

/** Caps how much of one artifact gets narrated, so a long document cannot monopolise the queue. */
const MAX_NARRATED_CHARS = 4000;

const VOICES_LOAD_TIMEOUT_MS = 1000;

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
}

/** `getVoices()` if the browser already has them, otherwise waits for `onvoiceschanged`
 * (Chrome loads voices asynchronously and returns empty on the first call), with a timeout so a
 * browser that never fires the event does not leave a pending promise. */
export function loadVoices(timeoutMs: number = VOICES_LOAD_TIMEOUT_MS): Promise<SpeechSynthesisVoice[]> {
  if (!hasSpeechSynthesis()) return Promise.resolve([]);
  const synth = window.speechSynthesis;

  const existing = synth.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", onChange);
      clearTimeout(timer);
      resolve(voices);
    };
    const onChange = () => finish(synth.getVoices());
    synth.addEventListener("voiceschanged", onChange);
    const timer = setTimeout(() => finish(synth.getVoices()), timeoutMs);
  });
}

/** Network-backed voices report `localService: false`. They are the neural ones (Google US
 * English, the Microsoft "Online (Natural)" set), and they sound markedly better than the
 * bundled local voices, so the automatic choice prefers them over the en-US tiebreak. */
function isOnline(v: SpeechSynthesisVoice): boolean {
  return v.localService === false;
}

/**
 * The pool the automatic choice picks from: English voices, online ones first, then en-US.
 *
 * Online wins over language region deliberately. A neural en-GB voice reads the game better than
 * a robotic local en-US one, and every stakeholder is fictional anyway, so accent matters less
 * than intelligibility across a long artifact.
 *
 * `localOnly` drops the online voices entirely, for the retry after a network voice fails.
 */
function voicePool(
  voices: SpeechSynthesisVoice[],
  localOnly = false,
): SpeechSynthesisVoice[] {
  return voices
    .filter((v) => v.lang?.toLowerCase().startsWith("en"))
    .filter((v) => !localOnly || !isOnline(v))
    .slice()
    .sort((a, b) => {
      const online = Number(isOnline(b)) - Number(isOnline(a));
      if (online !== 0) return online;
      const aUS = a.lang?.toLowerCase() === "en-us" ? 0 : 1;
      const bUS = b.lang?.toLowerCase() === "en-us" ? 0 : 1;
      return aUS - bUS;
    });
}

/**
 * Resolves a voice for `slot`. `preferredName` (a stored `SpeechSynthesisVoice.name`) wins when
 * it still names an installed voice - it may not, since voices are OS-specific and a player's
 * choice on one machine may not exist on another, which is exactly why an unresolved name falls
 * through to the tiers below rather than erroring.
 *
 * Three tiers after that, each tried in order against the online-first pool so an online match
 * always beats a local one within the same tier:
 *   1. `NEURAL_VOICE_NAMES` - the same voice family edge-tts itself would pick for this slot.
 *   2. `LEGACY_VOICE_NAMES` - known lower-quality voices, only reached once tier 1 has nothing.
 *   3. `pool[0]` - whatever's first, so a Linux box with only language-named espeak voices (no
 *      name to match at all) still gets *a* voice rather than silence.
 * `narrator` only has a tier-1 name (Ryan, edge-tts's fixed narrator voice) and no tier 2 - absent
 * a match it goes straight to `pool[0]`, exactly as before. `player` behaves like whichever
 * gender `playerGender` names (the player's own "Your voice" setting), falling back to the
 * ungendered pick when it's not given.
 *
 * `localOnly` excludes the network voices, including a stored preferred one: it is for the retry
 * after an online voice has already failed, where re-picking it would just fail again.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  slot: VoiceSlot,
  preferredName?: string | null,
  localOnly = false,
  playerGender?: "male" | "female" | null,
): SpeechSynthesisVoice | null {
  if (preferredName) {
    const preferred = voices.find((v) => v.name === preferredName);
    if (preferred && !(localOnly && isOnline(preferred))) return preferred;
  }

  const pool = voicePool(voices, localOnly);
  if (pool.length === 0) return null;

  const genderedSlot = slot === "player" ? playerGender : slot;
  const neuralRegex =
    slot === "narrator"
      ? NEURAL_VOICE_NAMES.narrator
      : genderedSlot === "male" || genderedSlot === "female"
        ? NEURAL_VOICE_NAMES[genderedSlot]
        : null;

  const neuralMatch = neuralRegex ? pool.find((v) => neuralRegex.test(v.name)) : undefined;
  if (neuralMatch) return neuralMatch;

  if (genderedSlot !== "male" && genderedSlot !== "female") return pool[0];

  const legacyMatch = pool.find((v) => LEGACY_VOICE_NAMES[genderedSlot].test(v.name));
  return legacyMatch ?? pool[0];
}

/** Maps a stakeholder's configured voice gender hint (male/female/neutral, from
 * `gameConfig/GameStakeholders.json`) onto a speech slot. "neutral" falls back to the narrator
 * voice, so every stakeholder is still distinguishable without being forced into a gender. */
export function slotForStakeholderVoice(voice: string | undefined | null): VoiceSlot {
  return voice === "male" || voice === "female" ? voice : "narrator";
}

/** Passed as `seed` by every guided-tour call site (`tour.ts`'s `narrate` callbacks), so the tour
 *  guide reading tooltip text is audibly a different voice from the narrator reading artifacts/
 *  briefings, even though both use the `narrator` slot - mirrored by `TOUR_GUIDE_SEED` in
 *  `tts_service.py` so the backend voice matches this fallback instead of the two swapping
 *  character every time a session flips between them. */
export const TOUR_GUIDE_SEED = "tour_guide";

/** Stakeholders/seeds whose pitch is pinned rather than hash-derived from their id. Bear Bruce
 *  reads as a large, sleepy bear, so he always gets the deepest voice available instead of
 *  wherever the hash happens to land; the tour guide is pinned brighter/higher, the opposite
 *  direction from the narrator's plain baseline. */
const PITCH_OVERRIDES: Record<string, number> = {
  bear_bruce: PITCH_MIN,
  [TOUR_GUIDE_SEED]: 1.35,
};

/** Same idea as `PITCH_OVERRIDES` but for rate: the tour guide reads a little brisker than the
 *  narrator's slower, document-reading pace, since it's walking the player through UI rather than
 *  reading prose. */
const RATE_OVERRIDES: Record<string, number> = {
  [TOUR_GUIDE_SEED]: 1.05,
};

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * The pitch to speak `slot` at. Seeded slots get a deterministic offset in
 * `[-PITCH_SPREAD, PITCH_SPREAD]` derived from a hash of `seed` (a stakeholder id), so the same
 * stakeholder sounds the same every time they speak, within a session and across reloads.
 * Unseeded slots (and a seeded slot with no seed) return the plain baseline - for `player`, that
 * baseline follows `playerGender` (the male/female baselines `male`/`female` already use) when
 * given, so the player's own lines actually sound different between the two genders instead of
 * always reading at the same flat pitch.
 */
export function pitchFor(
  seed: string | undefined | null,
  slot: VoiceSlot,
  playerGender?: "male" | "female" | null,
): number {
  if (seed && seed in PITCH_OVERRIDES) return PITCH_OVERRIDES[seed];

  const baseline =
    slot === "player" && (playerGender === "male" || playerGender === "female")
      ? BASELINE_PITCH[playerGender]
      : BASELINE_PITCH[slot];
  if (!seed || !SEEDED_SLOTS.has(slot)) return baseline;

  const h = hashSeed(seed);
  const unit = (h % 1000) / 1000; // [0, 1)
  const offset = unit * (2 * PITCH_SPREAD) - PITCH_SPREAD;
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, baseline + offset));
}

/** Strips markdown emphasis/links and the `{stakeholder_id}` template braces used in
 * `introduction` copy, so speech doesn't read out literal asterisks or brace names. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // `<mark>` etc. in a tour step's `data-intro` (intro.js renders it as real HTML, see app.css)
    // - keeps the tag's own text, just drops the markup, so narration reads the words, not tags.
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/[*_#>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical sentence splitter: the single source of truth for "where does one sentence end and
 * the next begin" across both narration (chunkText, below) and the sentence-highlight UI
 * (`SpokenText`), so the indices `onSentence` reports always line up with what the UI renders.
 * Keeps each match's trailing whitespace attached rather than trimming it here, so a caller that
 * wants to reconstruct the original spacing between sentences still can. */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text.match(/[^.!?]+[.!?]*(?:\s+|$)/g) ?? [text];
}

/** Splits `text` into one utterance per sentence (trimmed), breaking only at sentence boundaries
 * so Chrome's ~15s network voice cutoff never lands mid-word. `maxLen` is kept only as the
 * threshold past which a single sentence counts as long for callers that care (nothing merges
 * multiple sentences into one chunk anymore); an oversized sentence still becomes its own
 * (oversized) chunk rather than being force-split mid-sentence. */
export function chunkText(text: string, _maxLen: number = MAX_CHUNK_CHARS): string[] {
  if (!text) return [];
  return splitSentences(text)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export interface SpeakOptions {
  slot: VoiceSlot;
  /** Stakeholder id, for the deterministic per-speaker pitch. Ignored for unseeded slots. */
  seed?: string | null;
  /** A stored `SpeechSynthesisVoice.name`; falls back to regex matching when unresolvable. */
  voiceName?: string | null;
  /** Multiplier on top of the slot's baseline rate - the player's speech-speed setting
   *  (`useSpeech` applies this from `settings.speech_rate`; 1 leaves the baseline unchanged). */
  rate?: number;
  /** The player's own "Your voice" setting (`settings.player_voice_gender`) - only consulted for
   *  the `player` slot, where it picks the gendered voice/pitch instead of the ungendered
   *  fallback, so toggling it actually changes how the player's own lines sound. Ignored for
   *  every other slot. */
  playerGender?: "male" | "female" | null;
  onEnd?: () => void;
  /** Called right before each sentence's audio actually starts playing (not before it's
   * fetched/synthesized), so a caller can sync a UI highlight to what the player actually hears
   * rather than to network/synthesis latency. */
  onSentence?: (info: { index: number; total: number; text: string }) => void;
}

/** Module-level narration arbiter: `window.speechSynthesis` used to serialize `speak()` calls for
 * free (one global browser queue), so two components narrating never actually overlapped. Backend
 * narration plays through independent `HTMLAudioElement`s instead, which broke that implicit
 * guarantee - two components can now genuinely talk over each other. This restores "only one
 * narration plays at a time, globally" for both paths: every `speak()`/`speakAuto()` call stops
 * whatever the previous one started before it begins its own. */
let currentGeneration = 0;
let currentStop: (() => void) | null = null;

/** Cleans and sentence-chunks `text` the same way for every narration path, so `speak()` and the
 * backend path in `speakAuto()` always agree on what counts as "one sentence". */
function toSpeechChunks(text: string): string[] {
  const clean = stripForSpeech(text).slice(0, MAX_NARRATED_CHARS);
  if (!clean) return [];
  return chunkText(clean);
}

/**
 * Speaks `text` in `slot`'s voice, one sentence at a time. Returns a cancel function; calling it
 * (or `cancelSpeech()`) stops the whole utterance queue, not just the current sentence.
 *
 * A no-op (returns a no-op cancel, still calls `onEnd`) when there is nothing left to say after
 * cleaning, or when the browser has no `speechSynthesis` at all.
 *
 * Starting this always stops whatever narration was previously started via `speak()` or
 * `speakAuto()`, from any component - see the module-level arbiter comment above.
 */
export function speak(text: string, opts: SpeakOptions): () => void {
  currentStop?.();
  const myGeneration = ++currentGeneration;
  const clearStop = () => {
    if (myGeneration === currentGeneration) currentStop = null;
  };

  if (!hasSpeechSynthesis()) {
    opts.onEnd?.();
    clearStop();
    return () => {};
  }

  const synth = window.speechSynthesis;
  const chunks = toSpeechChunks(text);
  if (chunks.length === 0) {
    opts.onEnd?.();
    clearStop();
    return () => {};
  }

  const pitch = pitchFor(opts.seed, opts.slot, opts.playerGender);
  const baseRate =
    opts.seed && opts.seed in RATE_OVERRIDES
      ? RATE_OVERRIDES[opts.seed]
      : opts.slot === "narrator"
        ? 0.95
        : 1;
  const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, baseRate * (opts.rate ?? 1)));
  let cancelled = false;
  let index = 0;
  /* Set once an online voice has failed. Preferring network voices means an offline player, a
   * blocked request or a flaky connection would otherwise lose the whole line: every chunk would
   * error and be skipped in silence. After the first failure this run falls back to local voices
   * and retries the chunk that failed, rather than dropping it. */
  let localOnly = false;

  /* Chrome/Edge load voices asynchronously and return `[]` from a bare `getVoices()` call until
   * `voiceschanged` has fired at least once - which, on the very first `speak()` of a session,
   * hasn't happened yet. `pickVoice` then sees no online voices at all (not "none installed", just
   * "not enumerated yet") and silently settles for whatever the browser defaults to, typically a
   * local one - this is what actually made the first backend-narration fallback of a session sound
   * different from every later one, not the online/local matching logic itself. Cached for the
   * rest of this call only; a fresh `getVoices()` next time this module is used will already be
   * warm since the browser only ever needs to load its voice list once per page life. */
  let voices = synth.getVoices();

  const speakNext = () => {
    if (cancelled) return;
    if (index >= chunks.length) {
      opts.onEnd?.();
      clearStop();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    const voice = pickVoice(voices, opts.slot, opts.voiceName, localOnly, opts.playerGender);
    if (voice) utterance.voice = voice;
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.onend = () => {
      index += 1;
      speakNext();
    };
    utterance.onerror = () => {
      if (!localOnly && voice && isOnline(voice)) {
        localOnly = true;
        speakNext(); // same chunk, local voice
        return;
      }
      index += 1;
      speakNext();
    };
    opts.onSentence?.({ index, total: chunks.length, text: chunks[index] });
    synth.speak(utterance);
  };

  if (voices.length > 0) {
    speakNext();
  } else {
    loadVoices().then((loaded) => {
      if (cancelled) return;
      voices = loaded;
      speakNext();
    });
  }

  const cancel = () => {
    cancelled = true;
    synth.cancel();
    clearStop();
  };
  currentStop = cancel;
  return cancel;
}

/** Stops whatever is currently narrating, wherever it was started from - routes through the
 * module-level arbiter (`currentStop`) rather than reaching for `window.speechSynthesis` directly,
 * since the active narration may instead be backend audio (an `HTMLAudioElement`), which a bare
 * `speechSynthesis.cancel()` does nothing to stop. */
export function cancelSpeech(): void {
  currentStop?.();
}

export interface SpeakAutoOptions extends SpeakOptions {
  /** The player's `tts_backend` setting. "auto" tries the server voice first and falls back to
   * `speak()` on any failure; "webspeech" goes straight to `speak()`. */
  backend: "auto" | "webspeech";
}

/**
 * Fetches and plays `chunks` (one backend request per sentence) in sequence, calling
 * `opts.onSentence` right before each sentence's audio starts playing. Prefetches the next
 * sentence's audio as soon as the current one begins playing (not after it ends), so there is no
 * audible network gap between sentences. Returns a cancel function synchronously; rejects the
 * returned promise (once, via `onFailure`) if any fetch or playback in the sequence fails, so the
 * caller can fall back to re-speaking the whole line via `speak()` - resuming the backend path
 * mid-line after a partial failure is not worth the complexity here.
 */
function speakBackendChunks(
  chunks: string[],
  opts: Pick<SpeakOptions, "slot" | "seed" | "onSentence">,
  onDone: () => void,
  onFailure: (err: unknown) => void,
): () => void {
  let cancelled = false;
  let settled = false;
  let currentAudio: HTMLAudioElement | null = null;

  const cancel = () => {
    cancelled = true;
    currentAudio?.pause();
  };

  (async () => {
    try {
      let nextUrl = fetchTtsAudioUrl(chunks[0], opts);
      for (let i = 0; i < chunks.length; i += 1) {
        const url = await nextUrl;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        const audio = new Audio(url);
        currentAudio = audio;
        opts.onSentence?.({ index: i, total: chunks.length, text: chunks[i] });
        try {
          await audio.play();
        } catch (err) {
          // Only a gesture-policy rejection is worth waiting out - anything else (a real decode/
          // network error) should still fail fast into the normal webspeech fallback.
          if (!(err instanceof DOMException) || err.name !== "NotAllowedError" || audioUnlocked) {
            throw err;
          }
          await waitForAudioUnlock();
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          await audio.play();
        }
        // Kick off the next sentence's fetch now that this one is audibly playing, so the
        // network round-trip overlaps with playback instead of creating a gap after it.
        if (i + 1 < chunks.length) nextUrl = fetchTtsAudioUrl(chunks[i + 1], opts);
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Backend TTS playback failed"));
        });
        URL.revokeObjectURL(url);
        currentAudio = null;
        if (cancelled) return;
      }
      if (!cancelled && !settled) {
        settled = true;
        onDone();
      }
    } catch (err) {
      if (!cancelled && !settled) {
        settled = true;
        onFailure(err);
      }
    }
  })();

  return cancel;
}

/**
 * Entry point that orchestrates server-side narration ahead of the `window.speechSynthesis`
 * fallback (docs/plans/player-settings-and-tts.md). Keeps `speak()` itself untouched as the
 * fallback path - this only decides which one runs first.
 *
 * Returns synchronously, same as `speak()`, even though the backend call is async: the cancel
 * function closes over whichever attempt is still in flight, so calling it before the network
 * request resolves still stops the line before it starts.
 *
 * Starting this always stops whatever narration was previously started via `speak()` or
 * `speakAuto()`, from any component - see the module-level arbiter comment above.
 */
export function speakAuto(text: string, opts: SpeakAutoOptions): () => void {
  currentStop?.();
  const myGeneration = ++currentGeneration;

  if (opts.backend === "webspeech") {
    // speak() runs its own arbiter turn (it re-reads currentStop/currentGeneration itself), so
    // this call's entry is superseded immediately - that's fine, there is nothing to cancel yet.
    return speak(text, opts);
  }

  const setStop = (fn: (() => void) | null) => {
    if (myGeneration === currentGeneration) currentStop = fn;
  };

  const chunks = toSpeechChunks(text);
  if (chunks.length === 0) {
    opts.onEnd?.();
    setStop(null);
    return () => {};
  }

  // `stopped` covers every way this call's backend attempt ends: an external cancel, natural
  // completion, or handing off to the webspeech fallback. Once true, `cancel()` no longer touches
  // the (finished) backend attempt - it only needs to reach the fallback, if one is running.
  let stopped = false;
  let fallbackCancel: (() => void) | null = null;

  const cancel = () => {
    if (stopped) {
      fallbackCancel?.();
      return;
    }
    stopped = true;
    backendCancel();
    setStop(null);
  };

  const fallbackToWebspeech = (err: unknown) => {
    if (stopped) return;
    stopped = true;
    // Surfaced so a real failure (as opposed to a guess) is one console check away next time
    // this happens - includes the DOMException name for a play() rejection (e.g.
    // "NotAllowedError" means the browser's autoplay policy blocked it, not a network problem).
    console.warn(
      `[TTS] Backend narration failed for slot "${opts.slot}" - falling back to the browser voice. ` +
        `A "NotAllowedError" here means the browser's autoplay policy blocked playback, not a network issue.`,
      err,
    );
    // Neutralize the arbiter entry for this call before speak() runs its own arbiter turn -
    // otherwise speak()'s own `currentStop?.()` would reach back into this very `cancel` and
    // immediately mark itself stopped, before `fallbackCancel` is even assigned.
    setStop(null);
    // Re-speaks the whole line from the start rather than resuming mid-sentence: an acceptable
    // simplification for what should be a rare, already-degraded path (the backend just failed).
    fallbackCancel = speak(text, opts);
  };

  const backendCancel = speakBackendChunks(
    chunks,
    opts,
    () => {
      if (stopped) return;
      stopped = true;
      setStop(null);
      opts.onEnd?.();
    },
    fallbackToWebspeech,
  );

  currentStop = cancel;
  return cancel;
}
