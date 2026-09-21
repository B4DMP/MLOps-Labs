import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPanel from "./SettingsPanel";
import { WebSocketContext } from "../services/websocket/WebSocketContext";
import { SettingsContext, DEFAULT_SETTINGS, type PlayerSettings } from "./SettingsProvider";
import type { WebSocketContextValue } from "../services/websocket/types";

vi.mock("../utils/speech", () => ({
  loadVoices: vi.fn(),
  speak: vi.fn(() => () => {}),
  cancelSpeech: vi.fn(),
}));

import { loadVoices } from "../utils/speech";

const mockedLoadVoices = vi.mocked(loadVoices);

function fakeWebSocketContext(username = "alice"): WebSocketContextValue {
  return {
    isConnected: true,
    username,
    setUsername: vi.fn(),
    emit: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    lastError: null,
    setLastError: vi.fn(),
  };
}

function fakeVoice(name: string, lang = "en-US"): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: true, voiceURI: name } as SpeechSynthesisVoice;
}

function renderPanel(opts: {
  settings?: Partial<PlayerSettings>;
  canResetAccount?: boolean;
  username?: string;
} = {}) {
  const settings: PlayerSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  return render(
    <WebSocketContext.Provider value={fakeWebSocketContext(opts.username ?? "alice")}>
      <SettingsContext.Provider
        value={{
          settings,
          updateSettings: vi.fn(),
          canResetAccount: opts.canResetAccount ?? false,
          resetAccount: vi.fn(),
        }}
      >
        <SettingsPanel isVisible onClose={() => {}} />
      </SettingsContext.Provider>
    </WebSocketContext.Provider>,
  );
}

describe("SettingsPanel", () => {
  afterEach(() => {
    mockedLoadVoices.mockReset();
  });

  it("has no account section when canResetAccount is false", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: false });

    await screen.findAllByRole("combobox");
    expect(screen.queryByText("Reset my account")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Account" })).not.toBeInTheDocument();
  });

  it("shows the account section when canResetAccount is true", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: true });

    expect(await screen.findByText("Reset my account")).toBeInTheDocument();
  });

  it("keeps the final reset button disabled until the username is typed", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    const user = userEvent.setup();
    renderPanel({ canResetAccount: true, username: "alice" });

    await user.click(await screen.findByText("Reset my account"));

    const confirmButton = screen.getByRole("button", { name: "Permanently reset my account" });
    expect(confirmButton).toBeDisabled();

    const input = screen.getByRole("textbox");
    await user.type(input, "wrong-name");
    expect(confirmButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "alice");
    expect(confirmButton).toBeEnabled();
  });

  it("renders the diagnostic line instead of four empty selects when no voices are installed", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText(/no speech voices|speech-dispatcher/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders one dropdown per voice slot when voices are available", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop"), fakeVoice("Microsoft Zira Desktop")]);
    renderPanel();

    expect(await screen.findAllByRole("combobox")).toHaveLength(4);
  });
});
