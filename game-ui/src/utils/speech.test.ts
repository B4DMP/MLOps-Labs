import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelSpeech, chunkText, loadVoices, pickVoice, pitchFor, speak, stripForSpeech } from "./speech";

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

  it("resolves narrator/player to the first English voice, no gender regex involved", () => {
    expect(pickVoice(WINDOWS_VOICES, "narrator")?.name).toBe("Microsoft David Desktop");
    expect(pickVoice(WINDOWS_VOICES, "player")?.name).toBe("Microsoft David Desktop");
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
