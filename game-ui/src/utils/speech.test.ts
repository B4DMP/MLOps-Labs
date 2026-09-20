import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelSpeech, chunkText, loadVoices, pickVoice, pitchFor, speak, stripForSpeech } from "./speech";

function voice(name: string, lang = "en-US"): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: true, voiceURI: name } as SpeechSynthesisVoice;
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
  const originalSynth = (globalThis as any).speechSynthesis;

  afterEach(() => {
    (globalThis as any).speechSynthesis = originalSynth;
    vi.useRealTimers();
  });

  it("resolves immediately when voices are already loaded", async () => {
    (globalThis as any).speechSynthesis = {
      getVoices: () => WINDOWS_VOICES,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    await expect(loadVoices()).resolves.toEqual(WINDOWS_VOICES);
  });

  it("resolves through onvoiceschanged when the first call is empty", async () => {
    let changeHandler: (() => void) | undefined;
    let loaded = false;
    (globalThis as any).speechSynthesis = {
      getVoices: () => (loaded ? WINDOWS_VOICES : []),
      addEventListener: (_: string, handler: () => void) => {
        changeHandler = handler;
      },
      removeEventListener: vi.fn(),
    };

    const promise = loadVoices(5000);
    loaded = true;
    changeHandler?.();

    await expect(promise).resolves.toEqual(WINDOWS_VOICES);
  });

  it("resolves through its timeout when the event never fires", async () => {
    vi.useFakeTimers();
    (globalThis as any).speechSynthesis = {
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const promise = loadVoices(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual([]);
  });

  it("resolves to an empty list with no speechSynthesis at all", async () => {
    delete (globalThis as any).speechSynthesis;
    await expect(loadVoices()).resolves.toEqual([]);
  });
});

describe("speak / cancelSpeech with no speechSynthesis", () => {
  const originalSynth = (globalThis as any).speechSynthesis;

  beforeEach(() => {
    delete (globalThis as any).speechSynthesis;
  });

  afterEach(() => {
    (globalThis as any).speechSynthesis = originalSynth;
  });

  it("speak is a no-op that still calls onEnd, and cancelSpeech does not throw", () => {
    const onEnd = vi.fn();
    const cancel = speak("hello", { slot: "narrator", onEnd });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(() => cancel()).not.toThrow();
    expect(() => cancelSpeech()).not.toThrow();
  });
});
