import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./speechBackend", () => ({ fetchTtsAudioUrl: vi.fn() }));

import {
  cancelSpeech,
  chunkText,
  loadVoices,
  pickVoice,
  pitchFor,
  speak,
  speakAuto,
  splitSentences,
  stripForSpeech,
} from "./speech";
import { fetchTtsAudioUrl } from "./speechBackend";

const mockedFetchTtsAudioUrl = vi.mocked(fetchTtsAudioUrl);

/** Minimal stand-in: jsdom's HTMLAudioElement doesn't implement real playback. Mirrors
 * speechBackend.test.ts's FakeAudio, duplicated here since these tests exercise the
 * sentence-by-sentence orchestration in speech.ts directly rather than going through
 * speakBackend(). */
class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn(() => {
    this.paused = true;
  });
  constructor(public src: string) {}
}

function voice(name: string, lang = "en-US"): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: true, voiceURI: name } as SpeechSynthesisVoice;
}

/** A network-backed (neural) voice: `localService` is false. */
function onlineVoice(name: string, lang = "en-US"): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: false, voiceURI: name } as SpeechSynthesisVoice;
}

/** A stand-in for `window.speechSynthesis`, minimal enough for these tests. */
interface FakeSynth {
  getVoices: () => SpeechSynthesisVoice[];
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
}

function setSynth(synth: FakeSynth | undefined): void {
  (globalThis as unknown as { speechSynthesis?: FakeSynth }).speechSynthesis = synth;
}

function getSynth(): FakeSynth | undefined {
  return (globalThis as unknown as { speechSynthesis?: FakeSynth }).speechSynthesis;
}

const WINDOWS_VOICES = [voice("Microsoft David Desktop"), voice("Microsoft Zira Desktop")];
const MACOS_VOICES = [voice("Alex"), voice("Samantha"), voice("Victoria")];
const LINUX_NAMED_VOICES = [voice("slt"), voice("awb"), voice("bdl")];
const LINUX_LANGUAGE_ONLY_VOICES = [voice("English (America)"), voice("English (Great Britain)", "en-GB")];

describe("pickVoice", () => {
  it("picks the Windows male/female voices by name", () => {
    expect(pickVoice(WINDOWS_VOICES, "male")?.name).toBe("Microsoft David Desktop");
    expect(pickVoice(WINDOWS_VOICES, "female")?.name).toBe("Microsoft Zira Desktop");
  });

  it("picks the macOS male/female voices by name", () => {
    expect(pickVoice(MACOS_VOICES, "male")?.name).toBe("Alex");
    expect(["Samantha", "Victoria"]).toContain(pickVoice(MACOS_VOICES, "female")?.name);
  });

  it("picks the Linux named-voice tier by name", () => {
    expect(pickVoice(LINUX_NAMED_VOICES, "female")?.name).toBe("slt");
    expect(["awb", "bdl"]).toContain(pickVoice(LINUX_NAMED_VOICES, "male")?.name);
  });

  it("resolves narrator to the first English voice, no gender regex involved", () => {
    expect(pickVoice(WINDOWS_VOICES, "narrator")?.name).toBe("Microsoft David Desktop");
  });

  it("resolves player to the first English voice when no gender is given", () => {
    expect(pickVoice(WINDOWS_VOICES, "player")?.name).toBe("Microsoft David Desktop");
  });

  it("resolves player by the given gender, same as the matching male/female slot", () => {
    expect(pickVoice(WINDOWS_VOICES, "player", null, false, "male")?.name).toBe("Microsoft David Desktop");
    expect(pickVoice(WINDOWS_VOICES, "player", null, false, "female")?.name).toBe("Microsoft Zira Desktop");
  });

  it("a stored preferredName wins over the regex", () => {
    expect(pickVoice(WINDOWS_VOICES, "male", "Microsoft Zira Desktop")?.name).toBe("Microsoft Zira Desktop");
  });

  it("an unresolvable stored name falls back to the regex", () => {
    expect(pickVoice(WINDOWS_VOICES, "male", "Some Voice From Another Machine")?.name).toBe(
      "Microsoft David Desktop",
    );
  });

  it("with no gender signal at all, male and female resolve to the same voice", () => {
    const male = pickVoice(LINUX_LANGUAGE_ONLY_VOICES, "male");
    const female = pickVoice(LINUX_LANGUAGE_ONLY_VOICES, "female");
    expect(male?.name).toBe(female?.name);
    expect(male?.name).toBe("English (America)");
  });

  it("returns null when there is no English voice at all", () => {
    expect(pickVoice([voice("Deutsch", "de-DE")], "male")).toBeNull();
  });
});

describe("pickVoice preferring online voices", () => {
  const MIXED_VOICES = [
    voice("Microsoft David Desktop"),
    voice("Microsoft Zira Desktop"),
    onlineVoice("Microsoft Andrew Online (Natural) - English (United States)"),
    onlineVoice("Microsoft Ava Online (Natural) - English (United States)"),
  ];

  it("picks the online voice for each gender when both kinds are installed", () => {
    expect(pickVoice(MIXED_VOICES, "male")?.name).toContain("Andrew");
    expect(pickVoice(MIXED_VOICES, "female")?.name).toContain("Ava");
  });

  it("gives narrator and player an online voice ahead of any local one", () => {
    expect(pickVoice(MIXED_VOICES, "narrator")?.localService).toBe(false);
    expect(pickVoice(MIXED_VOICES, "player")?.localService).toBe(false);
  });

  it("prefers an online voice over the en-US tiebreak", () => {
    const voices = [voice("Microsoft David Desktop"), onlineVoice("Google UK English Male", "en-GB")];
    expect(pickVoice(voices, "narrator")?.name).toBe("Google UK English Male");
  });

  it("still matches gender within the online voices rather than taking the first one", () => {
    const voices = [
      onlineVoice("Microsoft Ava Online (Natural) - English (United States)"),
      onlineVoice("Microsoft Brian Online (Natural) - English (United States)"),
    ];
    expect(pickVoice(voices, "male")?.name).toContain("Brian");
    expect(pickVoice(voices, "female")?.name).toContain("Ava");
  });

  it("falls back to local voices when no online voice is installed", () => {
    expect(pickVoice(WINDOWS_VOICES, "male")?.name).toBe("Microsoft David Desktop");
  });

  it("localOnly excludes the online voices, including a stored preference", () => {
    expect(pickVoice(MIXED_VOICES, "male", null, true)?.name).toBe("Microsoft David Desktop");
    const stored = "Microsoft Andrew Online (Natural) - English (United States)";
    expect(pickVoice(MIXED_VOICES, "male", stored, true)?.name).toBe("Microsoft David Desktop");
  });

  it("a hand-picked local voice still wins over the online preference", () => {
    expect(pickVoice(MIXED_VOICES, "male", "Microsoft David Desktop")?.name).toBe(
      "Microsoft David Desktop",
    );
  });

  it("returns null under localOnly when every English voice is online", () => {
    const voices = [onlineVoice("Google US English")];
    expect(pickVoice(voices, "narrator", null, true)).toBeNull();
  });
});

describe("pitchFor", () => {
  it("is deterministic per seed", () => {
    expect(pitchFor("data_dave", "male")).toBe(pitchFor("data_dave", "male"));
  });

  it("differs between two different seeds (in general)", () => {
    const seeds = ["data_dave", "model_monica", "requirements_reuben", "automation_alex"];
    const pitches = new Set(seeds.map((s) => pitchFor(s, "male")));
    expect(pitches.size).toBeGreaterThan(1);
  });

  it("stays within [0, 2]", () => {
    for (const seed of ["a", "bb", "ccc", "automation_alex", ""]) {
      const p = pitchFor(seed, "male");
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(2);
    }
  });

  it("does not vary narrator/player pitch by seed", () => {
    expect(pitchFor("data_dave", "narrator")).toBe(pitchFor("model_monica", "narrator"));
    expect(pitchFor("data_dave", "player")).toBe(pitchFor("model_monica", "player"));
  });

  it("falls back to the plain baseline with no seed", () => {
    expect(pitchFor(null, "male")).toBe(0.95);
    expect(pitchFor(undefined, "female")).toBe(1.1);
  });

  it("gives male and female different baselines, seeded on the same id", () => {
    // Same stakeholder id can't be both, but the baselines must differ regardless.
    expect(pitchFor("x", "male")).not.toBe(pitchFor("x", "female"));
  });

  it("player follows playerGender's baseline, matching the corresponding male/female slot", () => {
    expect(pitchFor(null, "player", "male")).toBe(pitchFor(null, "male"));
    expect(pitchFor(null, "player", "female")).toBe(pitchFor(null, "female"));
  });

  it("player falls back to its own flat baseline with no playerGender given", () => {
    expect(pitchFor(null, "player")).toBe(1.0);
  });
});

describe("stripForSpeech", () => {
  it("drops template braces from introduction copy", () => {
    expect(stripForSpeech("Hi, I'm {data_dave}.")).toBe("Hi, I'm .");
  });

  it("strips markdown emphasis and link syntax", () => {
    expect(stripForSpeech("This is **bold** and a [link](https://x.test)")).toBe("This is bold and a link");
  });
});

describe("chunkText", () => {
  it("keeps short text as a single chunk", () => {
    expect(chunkText("Hello world.")).toEqual(["Hello world."]);
  });

  it("splits long text at sentence boundaries rather than mid-word", () => {
    const sentence = "The pipeline failed overnight and nobody noticed until the morning standup. ";
    const long = sentence.repeat(5);
    const chunks = chunkText(long, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100 + sentence.length);
      // No chunk starts or ends mid-word (trimmed sentences only).
      expect(chunk.trim()).toBe(chunk);
    }
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("pipeline failed overnight");
  });

  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("produces exactly one chunk per sentence, not merged", () => {
    const text = "First sentence here. Second sentence here! Third one?";
    expect(chunkText(text)).toEqual([
      "First sentence here.",
      "Second sentence here!",
      "Third one?",
    ]);
  });

  it("keeps an oversized single sentence as its own chunk rather than force-splitting it", () => {
    const longSentence = "word ".repeat(80).trim() + ".";
    expect(chunkText(longSentence, 50)).toEqual([longSentence]);
  });
});

describe("splitSentences", () => {
  it("is the same splitter chunkText's one-sentence-per-chunk behavior is built on", () => {
    const text = "First sentence here. Second sentence here!";
    expect(splitSentences(text).map((s) => s.trim())).toEqual([
      "First sentence here.",
      "Second sentence here!",
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(splitSentences("")).toEqual([]);
  });
});

describe("loadVoices", () => {
  const originalSynth = getSynth();

  afterEach(() => {
    setSynth(originalSynth);
    vi.useRealTimers();
  });

  it("resolves immediately when voices are already loaded", async () => {
    setSynth({
      getVoices: () => WINDOWS_VOICES,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    await expect(loadVoices()).resolves.toEqual(WINDOWS_VOICES);
  });

  it("resolves through onvoiceschanged when the first call is empty", async () => {
    let changeHandler: (() => void) | undefined;
    let loaded = false;
    setSynth({
      getVoices: () => (loaded ? WINDOWS_VOICES : []),
      addEventListener: (_: string, handler: () => void) => {
        changeHandler = handler;
      },
      removeEventListener: vi.fn(),
    });

    const promise = loadVoices(5000);
    loaded = true;
    changeHandler?.();

    await expect(promise).resolves.toEqual(WINDOWS_VOICES);
  });

  it("resolves through its timeout when the event never fires", async () => {
    vi.useFakeTimers();
    setSynth({
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const promise = loadVoices(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual([]);
  });

  it("resolves to an empty list with no speechSynthesis at all", async () => {
    setSynth(undefined);
    await expect(loadVoices()).resolves.toEqual([]);
  });
});

describe("speak falling back when an online voice fails", () => {
  const originalSynth = getSynth();
  const originalUtterance = (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;

  const MIXED_VOICES = [
    voice("Microsoft David Desktop"),
    onlineVoice("Microsoft Andrew Online (Natural) - English (United States)"),
  ];

  /** Minimal stand-in: jsdom implements neither speechSynthesis nor the utterance constructor. */
  class FakeUtterance {
    voice: SpeechSynthesisVoice | null = null;
    pitch = 1;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }

  let spoken: FakeUtterance[];

  beforeEach(() => {
    spoken = [];
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
    setSynth({
      getVoices: () => MIXED_VOICES,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      speak: (u: FakeUtterance) => spoken.push(u),
      cancel: vi.fn(),
    } as unknown as FakeSynth);
  });

  afterEach(() => {
    setSynth(originalSynth);
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = originalUtterance;
  });

  it("retries the same text on a local voice instead of losing the line", () => {
    const onEnd = vi.fn();
    speak("The pipeline failed overnight.", { slot: "male", seed: "data_dave", onEnd });

    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice?.localService).toBe(false);

    spoken[0].onerror?.(); // network voice fails

    expect(spoken).toHaveLength(2);
    expect(spoken[1].text).toBe(spoken[0].text);
    expect(spoken[1].voice?.name).toBe("Microsoft David Desktop");
    expect(onEnd).not.toHaveBeenCalled();

    spoken[1].onend?.();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("stays on the local voice for the rest of the line once one has failed", () => {
    speak("First sentence here. Second sentence here.", { slot: "male", seed: "x" });
    // chunkText keeps both sentences in one chunk at the default size, so force two chunks.
    spoken.length = 0;
    speak("a".repeat(150) + ". " + "b".repeat(150) + ".", { slot: "male", seed: "x" });

    expect(spoken).toHaveLength(1);
    spoken[0].onerror?.();
    expect(spoken[1].voice?.localService).toBe(true);

    spoken[1].onend?.();
    expect(spoken[2].voice?.localService).toBe(true);
  });

  it("drops a chunk that fails on a local voice rather than retrying forever", () => {
    const onEnd = vi.fn();
    speak("Only sentence.", { slot: "male", voiceName: "Microsoft David Desktop", onEnd });

    expect(spoken[0].voice?.localService).toBe(true);
    spoken[0].onerror?.();

    expect(spoken).toHaveLength(1);
    expect(onEnd).toHaveBeenCalledOnce();
  });
});

describe("speak with a rate option", () => {
  const originalSynth = getSynth();
  const originalUtterance = (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
  let spoken: FakeUtterance[];

  beforeEach(() => {
    spoken = [];
    setFakeWebspeech(spoken);
  });

  afterEach(() => {
    setSynth(originalSynth);
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = originalUtterance;
  });

  it("multiplies the baseline rate by the given rate option", () => {
    speak("Hello.", { slot: "player", rate: 1.5 });
    expect(spoken[0].rate).toBeCloseTo(1.5);
  });

  it("defaults to the baseline rate when none is given", () => {
    speak("Hello.", { slot: "narrator" });
    expect(spoken[0].rate).toBeCloseTo(0.95);
  });
});

describe("speak with playerGender", () => {
  const originalSynth = getSynth();
  const originalUtterance = (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
  let spoken: FakeUtterance[];

  beforeEach(() => {
    spoken = [];
    setFakeWebspeech(spoken);
  });

  afterEach(() => {
    setSynth(originalSynth);
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = originalUtterance;
  });

  it("picks a different voice/pitch for the player slot depending on the given gender", () => {
    speak("Hello.", { slot: "player", playerGender: "male" });
    const male = spoken[0];

    spoken.length = 0;
    speak("Hello.", { slot: "player", playerGender: "female" });
    const female = spoken[0];

    expect(male.voice?.name).toBe("Microsoft David Desktop");
    expect(female.voice?.name).toBe("Microsoft Zira Desktop");
    expect(male.pitch).not.toBe(female.pitch);
  });

  it("falls back to the ungendered pick with no playerGender given", () => {
    speak("Hello.", { slot: "player" });
    expect(spoken[0].voice?.name).toBe("Microsoft David Desktop");
    expect(spoken[0].pitch).toBeCloseTo(1.0);
  });
});

describe("speak / cancelSpeech with no speechSynthesis", () => {
  const originalSynth = getSynth();

  beforeEach(() => {
    setSynth(undefined);
  });

  afterEach(() => {
    setSynth(originalSynth);
  });

  it("speak is a no-op that still calls onEnd, and cancelSpeech does not throw", () => {
    const onEnd = vi.fn();
    const cancel = speak("hello", { slot: "narrator", onEnd });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(() => cancel()).not.toThrow();
    expect(() => cancelSpeech()).not.toThrow();
  });
});

describe("speakAuto", () => {
  const originalSynth = getSynth();
  const originalAudio = (globalThis as Record<string, unknown>).Audio;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let lastAudio: FakeAudio | undefined;

  beforeEach(() => {
    mockedFetchTtsAudioUrl.mockReset();
    lastAudio = undefined;
    (globalThis as Record<string, unknown>).Audio = vi.fn((src: string) => {
      lastAudio = new FakeAudio(src);
      return lastAudio;
    });
    URL.revokeObjectURL = vi.fn();
    // No window.speechSynthesis at all, so the speak() fallback path is a plain, observable
    // no-op (it still calls onEnd) rather than needing the full utterance machinery.
    setSynth(undefined);
  });

  afterEach(() => {
    setSynth(originalSynth);
    (globalThis as Record<string, unknown>).Audio = originalAudio;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("with backend 'webspeech', skips the backend entirely", () => {
    const onEnd = vi.fn();
    speakAuto("hello", { slot: "narrator", backend: "webspeech", onEnd });

    expect(mockedFetchTtsAudioUrl).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("with backend 'auto', plays via the backend on success and never falls back", async () => {
    mockedFetchTtsAudioUrl.mockResolvedValue("blob:fake-1");
    const onEnd = vi.fn();

    speakAuto("hello", { slot: "narrator", backend: "auto", onEnd });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedFetchTtsAudioUrl).toHaveBeenCalledOnce();
    expect(lastAudio?.play).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled(); // this one-sentence line never reaches "ended" in the test
  });

  it("with backend 'auto', falls back to speechSynthesis when the backend call throws", async () => {
    mockedFetchTtsAudioUrl.mockRejectedValue(new Error("network down"));
    const onEnd = vi.fn();

    speakAuto("hello", { slot: "narrator", backend: "auto", onEnd });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedFetchTtsAudioUrl).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce(); // the speak() no-op fallback ran
  });

  it("falls back to speechSynthesis for the whole line when a later sentence fails mid-line", async () => {
    mockedFetchTtsAudioUrl.mockResolvedValueOnce("blob:fake-1").mockResolvedValueOnce("blob:fake-2");
    const onEnd = vi.fn();

    speakAuto("First sentence. Second sentence.", { slot: "narrator", backend: "auto", onEnd });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    lastAudio?.onended?.(); // first sentence finishes normally
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    lastAudio?.onerror?.(); // second sentence's playback fails
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The re-speak-from-the-start fallback is the documented simplification for a partial
    // failure - it re-runs the whole line through the webspeech no-op path in this test.
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("cancelling before the backend fetch resolves cancels it instead of letting it play", async () => {
    let resolveFetch: (url: string) => void;
    mockedFetchTtsAudioUrl.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const cancel = speakAuto("hello", { slot: "narrator", backend: "auto" });
    cancel();
    resolveFetch!("blob:fake-1");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(lastAudio).toBeUndefined(); // cancelled before Audio was ever constructed
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-1");
  });

  it("calls onSentence with index/total/text right before each sentence's audio plays", async () => {
    mockedFetchTtsAudioUrl.mockResolvedValue("blob:fake-1");
    const onSentence = vi.fn();

    speakAuto("Only sentence here.", { slot: "narrator", backend: "auto", onSentence });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onSentence).toHaveBeenCalledOnce();
    expect(onSentence).toHaveBeenCalledWith({ index: 0, total: 1, text: "Only sentence here." });
  });
});

/** Minimal stand-in shared by the webspeech-path tests below: jsdom implements neither
 * speechSynthesis nor the utterance constructor. */
class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  pitch = 1;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function setFakeWebspeech(spoken: FakeUtterance[]): void {
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  setSynth({
    getVoices: () => WINDOWS_VOICES,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speak: (u: FakeUtterance) => spoken.push(u),
    cancel: vi.fn(),
  } as unknown as FakeSynth);
}

describe("speak onSentence", () => {
  const originalSynth = getSynth();
  const originalUtterance = (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
  let spoken: FakeUtterance[];

  beforeEach(() => {
    spoken = [];
    setFakeWebspeech(spoken);
  });

  afterEach(() => {
    setSynth(originalSynth);
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = originalUtterance;
  });

  it("fires once per sentence, in order, before that sentence's utterance is queued", () => {
    const onSentence = vi.fn();
    speak("First sentence. Second sentence.", { slot: "narrator", onSentence });

    // Only the first sentence has been queued so far - onSentence for it already fired, but the
    // second sentence's utterance (and its onSentence call) only happens once the first ends.
    expect(spoken).toHaveLength(1);
    expect(onSentence).toHaveBeenCalledTimes(1);
    expect(onSentence).toHaveBeenNthCalledWith(1, { index: 0, total: 2, text: "First sentence." });

    spoken[0].onend?.();

    expect(spoken).toHaveLength(2);
    expect(onSentence).toHaveBeenCalledTimes(2);
    expect(onSentence).toHaveBeenNthCalledWith(2, { index: 1, total: 2, text: "Second sentence." });
  });
});

describe("narration arbiter", () => {
  const originalSynth = getSynth();
  const originalUtterance = (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
  const originalAudio = (globalThis as Record<string, unknown>).Audio;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let spoken: FakeUtterance[];
  let lastAudio: FakeAudio | undefined;

  beforeEach(() => {
    spoken = [];
    lastAudio = undefined;
    setFakeWebspeech(spoken);
    mockedFetchTtsAudioUrl.mockReset();
    (globalThis as Record<string, unknown>).Audio = vi.fn((src: string) => {
      lastAudio = new FakeAudio(src);
      return lastAudio;
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    setSynth(originalSynth);
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = originalUtterance;
    (globalThis as Record<string, unknown>).Audio = originalAudio;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("a second speak() call cancels the first (same path)", () => {
    const onEnd1 = vi.fn();
    speak("First narration.", { slot: "narrator", onEnd: onEnd1 });
    expect(spoken).toHaveLength(1);

    speak("Second narration.", { slot: "narrator" });

    // Starting the second call reached back into the browser queue for the first, not just this
    // module's own bookkeeping - a real onend firing for the stale first utterance afterwards
    // must not resurrect its onEnd.
    expect(getSynth()?.cancel).toHaveBeenCalledOnce();
    spoken[0].onend?.();
    expect(onEnd1).not.toHaveBeenCalled();
  });

  it("starting speakAuto('webspeech') cancels a speak() call already in flight", () => {
    const onEnd1 = vi.fn();
    speak("First narration.", { slot: "narrator", onEnd: onEnd1 });
    expect(spoken).toHaveLength(1);

    speakAuto("Second narration.", { slot: "narrator", backend: "webspeech" });

    expect(getSynth()?.cancel).toHaveBeenCalled();
    spoken[0].onend?.();
    expect(onEnd1).not.toHaveBeenCalled();
  });

  it("starting a backend speakAuto() cancels a speak() call already in flight (cross-path)", async () => {
    mockedFetchTtsAudioUrl.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const onEnd1 = vi.fn();
    speak("First narration.", { slot: "narrator", onEnd: onEnd1 });
    expect(spoken).toHaveLength(1);

    speakAuto("Second narration.", { slot: "narrator", backend: "auto" });

    expect(getSynth()?.cancel).toHaveBeenCalledOnce();
    spoken[0].onend?.();
    expect(onEnd1).not.toHaveBeenCalled();
  });

  it("starting speak() cancels a backend speakAuto() call already in flight (cross-path)", async () => {
    mockedFetchTtsAudioUrl.mockResolvedValue("blob:fake-1");
    const onEnd1 = vi.fn();
    speakAuto("First narration.", { slot: "narrator", backend: "auto", onEnd: onEnd1 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(lastAudio?.play).toHaveBeenCalledOnce();
    const firstAudio = lastAudio;

    speak("Second narration.", { slot: "narrator" });

    // The first call's backend audio was paused by the arbiter, and its eventual onended (a real
    // browser would still fire it after pause()) must not resurrect its onEnd.
    expect(firstAudio?.pause).toHaveBeenCalledOnce();
    firstAudio?.onended?.();
    await Promise.resolve();
    expect(onEnd1).not.toHaveBeenCalled();
  });
});
