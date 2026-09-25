import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakBackend } from "./speechBackend";

/** Minimal stand-in: jsdom's HTMLAudioElement doesn't implement real playback. */
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

describe("speakBackend", () => {
  const originalAudio = (globalThis as Record<string, unknown>).Audio;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let lastAudio: FakeAudio | undefined;

  beforeEach(() => {
    lastAudio = undefined;
    (globalThis as Record<string, unknown>).Audio = vi.fn((src: string) => {
      lastAudio = new FakeAudio(src);
      return lastAudio;
    });
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).Audio = originalAudio;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.unstubAllGlobals();
  });

  it("posts the text/slot/seed and plays the returned audio", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["fake audio"])),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onEnd = vi.fn();
    await speakBackend("hello world", { slot: "narrator", seed: "data_dave", onEnd });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/tts");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ text: "hello world", slot: "narrator", seed: "data_dave" });

    expect(lastAudio?.play).toHaveBeenCalledOnce();

    lastAudio?.onended?.();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("throws on a non-2xx response instead of playing anything", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(speakBackend("hello", { slot: "narrator" })).rejects.toThrow();
    expect(lastAudio).toBeUndefined();
  });

  it("throws when the fetch itself fails (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(speakBackend("hello", { slot: "narrator" })).rejects.toThrow();
  });

  it("the returned cancel function pauses playback and revokes the object URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) }),
    );

    const cancel = await speakBackend("hello", { slot: "narrator" });
    cancel();

    expect(lastAudio?.pause).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("onEnd is not called once cancelled, even if the audio later fires onended", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) }),
    );

    const onEnd = vi.fn();
    const cancel = await speakBackend("hello", { slot: "narrator", onEnd });
    cancel();
    lastAudio?.onended?.();

    expect(onEnd).not.toHaveBeenCalled();
  });
});
