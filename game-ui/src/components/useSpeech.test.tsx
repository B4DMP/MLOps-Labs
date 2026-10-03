import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let generation = 0;
const cancelSpeech = vi.fn();

vi.mock("../utils/speech", () => ({
  speakAuto: vi.fn(() => {
    generation += 1;
    return () => {};
  }),
  getSpeechGeneration: () => generation,
  isSessionMuted: () => false,
  cancelSpeech: () => cancelSpeech(),
}));
vi.mock("./SettingsProvider", () => ({
  useSettings: () => ({ settings: { mute_tts: false, tts_backend: "auto", speech_rate: 1 } }),
}));

import { useSpeech } from "./useSpeech";

const say = (h: { current: ReturnType<typeof useSpeech> }) => h.current.speak("hi", { slot: "narrator" });

describe("useSpeech", () => {
  beforeEach(() => {
    generation = 0;
    cancelSpeech.mockClear();
  });

  it("cancels its own line when it unmounts", () => {
    const a = renderHook(() => useSpeech());
    say(a.result);
    a.unmount();
    expect(cancelSpeech).toHaveBeenCalledTimes(1);
  });

  it("leaves a newer line from another component alone when it unmounts late", () => {
    const a = renderHook(() => useSpeech());
    const b = renderHook(() => useSpeech());
    say(a.result);
    say(b.result);
    a.unmount();
    expect(cancelSpeech).not.toHaveBeenCalled();
  });

  it("never cancels anything if it never spoke", () => {
    renderHook(() => useSpeech()).unmount();
    expect(cancelSpeech).not.toHaveBeenCalled();
  });

  it("cancel() only stops its own line as well", () => {
    const a = renderHook(() => useSpeech());
    const b = renderHook(() => useSpeech());
    say(a.result);
    say(b.result);
    a.result.current.cancel();
    expect(cancelSpeech).not.toHaveBeenCalled();
    b.result.current.cancel();
    expect(cancelSpeech).toHaveBeenCalledTimes(1);
  });
});
