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

export type VoiceSlot = "male" | "female" | "narrator" | "player";

/* Includes the online "Natural"/neural voice names alongside the local ones, since those are
 * now what the automatic choice reaches for first: Windows/Edge ship Ava, Emma, Aria, Michelle
 * and Jenny (female), Andrew, Brian, Christopher, Eric, Guy, Roger and Steffan (male). The
 * multi-word online names are anchored on word boundaries so they cannot match inside a longer
 * name. */
const FEMALE_REGEX =
  /(zira|jenny|samantha|victoria|slt|clb|eva|f[1-5]\b|\b(ava|emma|aria|michelle)\b)/i;
const MALE_REGEX =
  /(david|guy|alex|fred|awb|rms|bdl|ksp|kal|m[1-5]\b|\b(andrew|brian|christopher|eric|roger|steffan)\b)/i;

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
 * through to the regex rather than erroring.
 *
 * `narrator` and `player` have no gender regex: absent a stored preference they just take the
 * first voice in the pool, which is an online one wherever the browser offers any. `male`/
 * `female` match by name within that same order, so a matching online voice beats a matching
 * local one; when nothing in the installed set matches either gender regex (the common Linux
 * outcome with only language-named voices), both resolve to the same first voice, differentiated
 * only by `pitchFor`'s baseline.
 *
 * `localOnly` excludes the network voices, including a stored one: it is for the retry after an
 * online voice has already failed, where re-picking it would just fail again.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  slot: VoiceSlot,
  preferredName?: string | null,
  localOnly = false,
): SpeechSynthesisVoice | null {
  if (preferredName) {
    const preferred = voices.find((v) => v.name === preferredName);
    if (preferred && !(localOnly && isOnline(preferred))) return preferred;
  }

  const pool = voicePool(voices, localOnly);
  if (pool.length === 0) return null;

  if (slot === "narrator" || slot === "player") return pool[0];

  const regex = slot === "male" ? MALE_REGEX : FEMALE_REGEX;
  return pool.find((v) => regex.test(v.name)) ?? pool[0];
}

/** Maps a stakeholder's configured voice gender hint (male/female/neutral, from
 * `gameConfig/GameStakeholders.json`) onto a speech slot. "neutral" falls back to the narrator
 * voice, so every stakeholder is still distinguishable without being forced into a gender. */
export function slotForStakeholderVoice(voice: string | undefined | null): VoiceSlot {
  return voice === "male" || voice === "female" ? voice : "narrator";
}

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
 * Unseeded slots (and a seeded slot with no seed) return the plain baseline.
 */
export function pitchFor(seed: string | undefined | null, slot: VoiceSlot): number {
  const baseline = BASELINE_PITCH[slot];
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
    .replace(/[*_#>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits `text` into utterances of roughly `maxLen` characters, breaking at sentence
 * boundaries rather than mid-word, so Chrome's ~15s network voice cutoff never lands mid-word. */
export function chunkText(text: string, maxLen: number = MAX_CHUNK_CHARS): string[] {
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]*(?:\s+|$)/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && (current + sentence).length > maxLen) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export interface SpeakOptions {
  slot: VoiceSlot;
  /** Stakeholder id, for the deterministic per-speaker pitch. Ignored for unseeded slots. */
  seed?: string | null;
  /** A stored `SpeechSynthesisVoice.name`; falls back to regex matching when unresolvable. */
  voiceName?: string | null;
  onEnd?: () => void;
}

/**
 * Speaks `text` in `slot`'s voice, chunked and cleaned. Returns a cancel function; calling it
 * (or `cancelSpeech()`) stops the whole utterance queue, not just the current chunk.
 *
 * A no-op (returns a no-op cancel, still calls `onEnd`) when there is nothing left to say after
 * cleaning, or when the browser has no `speechSynthesis` at all.
 */
export function speak(text: string, opts: SpeakOptions): () => void {
  if (!hasSpeechSynthesis()) {
    opts.onEnd?.();
    return () => {};
  }

  const synth = window.speechSynthesis;
  const clean = stripForSpeech(text).slice(0, MAX_NARRATED_CHARS);
  if (!clean) {
    opts.onEnd?.();
    return () => {};
  }

  const chunks = chunkText(clean);
  const pitch = pitchFor(opts.seed, opts.slot);
  const rate = opts.slot === "narrator" ? 0.95 : 1;
  let cancelled = false;
  let index = 0;
  /* Set once an online voice has failed. Preferring network voices means an offline player, a
   * blocked request or a flaky connection would otherwise lose the whole line: every chunk would
   * error and be skipped in silence. After the first failure this run falls back to local voices
   * and retries the chunk that failed, rather than dropping it. */
  let localOnly = false;

  const speakNext = () => {
    if (cancelled) return;
    if (index >= chunks.length) {
      opts.onEnd?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    const voice = pickVoice(synth.getVoices(), opts.slot, opts.voiceName, localOnly);
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
    synth.speak(utterance);
  };

  speakNext();

  return () => {
    cancelled = true;
    synth.cancel();
  };
}

/** Stops whatever `speak()` queued, wherever it was called from. */
export function cancelSpeech(): void {
  if (hasSpeechSynthesis()) {
    window.speechSynthesis.cancel();
  }
}
