import { forwardRef, useImperativeHandle } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hero animation needs a shadow root and constructable stylesheets that jsdom lacks.
vi.mock("@lordicon/react", () => ({
  Player: forwardRef((_props: unknown, ref: React.Ref<{ playFromBeginning: () => void }>) => {
    useImperativeHandle(ref, () => ({ playFromBeginning: () => {} }));
    return <div data-testid="gate-icon" />;
  }),
}));

const speechMock = vi.hoisted(() => ({
  unlocked: false,
  generation: 0,
  sessionMuted: false,
  listeners: new Set<(e: { generation: number; type: string }) => void>(),
}));

vi.mock("../utils/speech", () => ({
  isAudioUnlocked: () => speechMock.unlocked,
  probeAudioUnlocked: async () => speechMock.unlocked,
  isSessionMuted: () => speechMock.sessionMuted,
  setSessionMuted: (m: boolean) => {
    speechMock.sessionMuted = m;
  },
  unlockAudio: vi.fn(() => {
    speechMock.unlocked = true;
  }),
  getSpeechGeneration: () => speechMock.generation,
  onNarrationEvent: (l: (e: { generation: number; type: string }) => void) => {
    speechMock.listeners.add(l);
    return () => speechMock.listeners.delete(l);
  },
}));

import { NarratorGateHost } from "./NarratorGate";
import { DEFAULT_SETTINGS, SettingsContext } from "./SettingsProvider";
import { useNarratorGate } from "./useNarratorGate";
import { declineNarratorGate, requestNarratorGate } from "../utils/narratorGate";
import { unlockAudio } from "../utils/speech";

function renderHost(updateSettings = vi.fn()) {
  render(
    <SettingsContext.Provider
      value={{ settings: DEFAULT_SETTINGS, updateSettings, canResetAccount: false, resetAccount: () => {}, canPlaytest: false }}
    >
      <NarratorGateHost />
    </SettingsContext.Provider>,
  );
  return updateSettings;
}

describe("NarratorGate", () => {
  beforeEach(() => {
    speechMock.unlocked = false;
    speechMock.generation = 0;
    speechMock.sessionMuted = false;
    speechMock.listeners.clear();
    vi.mocked(unlockAudio).mockClear();
  });

  afterEach(() => {
    declineNarratorGate();
  });

  it("lets narration proceed without showing anything when audio is already unlocked", async () => {
    speechMock.unlocked = true;
    renderHost();
    await expect(requestNarratorGate()).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows nothing and skips narration when muted or auto-skipped", async () => {
    renderHost();
    await expect(requestNarratorGate({ muted: true })).resolves.toBe(false);
    await expect(requestNarratorGate({ skip: true })).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not block when no host is mounted", async () => {
    await expect(requestNarratorGate()).resolves.toBe(true);
  });

  it("opens a labelled modal dialog with focus on the primary button while audio is locked", async () => {
    renderHost();
    const pending = requestNarratorGate();
    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Your narrator is ready");
    expect(screen.getByTestId("gate-icon")).toBeInTheDocument();
    expect(screen.getByText(/Browsers keep audio off until you interact with the page/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Begin the walkthrough" })).toHaveFocus();

    declineNarratorGate();
    await pending;
  });

  it("uses the compact wording for a reload", async () => {
    renderHost();
    const pending = requestNarratorGate({ compact: true });
    expect(await screen.findByRole("button", { name: "Continue with voice" })).toBeInTheDocument();
    declineNarratorGate();
    await pending;
  });

  it("primary click unlocks audio, releases the queued narration and waits for the first sentence", async () => {
    renderHost();
    const pending = requestNarratorGate();
    await userEvent.click(await screen.findByRole("button", { name: "Begin the walkthrough" }));

    expect(unlockAudio).toHaveBeenCalledOnce();
    await expect(pending).resolves.toBe(true);
    expect(await screen.findByRole("button", { name: /Loading the voice/ })).toHaveAttribute("aria-disabled", "true");

    act(() => {
      speechMock.generation = 1;
      speechMock.listeners.forEach((l) => l({ generation: 1, type: "sentence" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on its own when the click led to no narration", async () => {
    renderHost();
    const pending = requestNarratorGate();
    await userEvent.click(await screen.findByRole("button", { name: "Begin the walkthrough" }));
    await pending;
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 2000 });
  });

  it("Read it myself mutes narration for the session only and tells waiters not to speak", async () => {
    const updateSettings = renderHost();
    const pending = requestNarratorGate();
    await userEvent.click(await screen.findByRole("button", { name: "Read it myself" }));

    await expect(pending).resolves.toBe(false);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(speechMock.sessionMuted).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("treats Escape as Read it myself", async () => {
    const updateSettings = renderHost();
    const pending = requestNarratorGate();
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    await expect(pending).resolves.toBe(false);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(speechMock.sessionMuted).toBe(true);
    await expect(requestNarratorGate()).resolves.toBe(false);
  });

  it("keeps Tab focus inside the dialog", async () => {
    renderHost();
    const pending = requestNarratorGate();
    const primary = await screen.findByRole("button", { name: "Begin the walkthrough" });
    const secondary = screen.getByRole("button", { name: "Read it myself" });

    await userEvent.tab();
    expect(secondary).toHaveFocus();
    await userEvent.tab();
    expect(primary).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(secondary).toHaveFocus();

    declineNarratorGate();
    await pending;
  });

  it("useNarratorGate reports muted settings as no narration without opening the gate", async () => {
    let request: ReturnType<typeof useNarratorGate>["request"] | undefined;
    function Probe() {
      request = useNarratorGate().request;
      return null;
    }
    render(
      <SettingsContext.Provider
        value={{
          settings: { ...DEFAULT_SETTINGS, mute_tts: true },
          updateSettings: () => {},
          canResetAccount: false,
          resetAccount: () => {},
          canPlaytest: false,
        }}
      >
        <NarratorGateHost />
        <Probe />
      </SettingsContext.Provider>,
    );
    await expect(request!()).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
