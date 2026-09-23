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

vi.mock("../services/api/auth", () => ({
  changePassword: vi.fn(),
  changeEmail: vi.fn(),
  confirmEmailChange: vi.fn(),
  changeUsername: vi.fn(),
}));

import { loadVoices } from "../utils/speech";
import { changeUsername } from "../services/api/auth";

const mockedLoadVoices = vi.mocked(loadVoices);
const mockedChangeUsername = vi.mocked(changeUsername);

function fakeWebSocketContext(username = "alice", setUsername = vi.fn()): WebSocketContextValue {
  return {
    isConnected: true,
    username,
    setUsername,
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
  onLogout?: () => void;
  setUsername?: (u: string) => void;
} = {}) {
  const settings: PlayerSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  return render(
    <WebSocketContext.Provider value={fakeWebSocketContext(opts.username ?? "alice", opts.setUsername)}>
      <SettingsContext.Provider
        value={{
          settings,
          updateSettings: vi.fn(),
          canResetAccount: opts.canResetAccount ?? false,
          resetAccount: vi.fn(),
          canPlaytest: false,
        }}
      >
        <SettingsPanel isVisible onClose={() => {}} onLogout={opts.onLogout ?? vi.fn()} />
      </SettingsContext.Provider>
    </WebSocketContext.Provider>,
  );
}

async function openSection(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  return user;
}

describe("SettingsPanel accordion", () => {
  afterEach(() => {
    mockedLoadVoices.mockReset();
    mockedChangeUsername.mockReset();
  });

  it("starts with every section collapsed", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: true });

    expect(screen.queryByText("Signed in as alice")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset my account")).not.toBeInTheDocument();
  });

  it("opens exactly one section at a time", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel();

    const user = await openSection("Conversations");
    expect(screen.getByText("Auto-skip conversations")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voice" }));
    expect(screen.queryByText("Auto-skip conversations")).not.toBeInTheDocument();
    await screen.findAllByRole("combobox");
  });

  it("has no account section when canResetAccount is false", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: false });

    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
  });

  it("shows the account section's contents once opened", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: true });

    await openSection("Account");
    expect(await screen.findByText("Reset my account")).toBeInTheDocument();
  });

  it("keeps the final reset button disabled until the username is typed", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: true, username: "alice" });

    const user = await openSection("Account");
    await user.click(screen.getByText("Reset my account"));

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

    await openSection("Voice");
    expect(await screen.findByText(/no speech voices|speech-dispatcher/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders one dropdown per voice slot when voices are available", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop"), fakeVoice("Microsoft Zira Desktop")]);
    renderPanel();

    await openSection("Voice");
    expect(await screen.findAllByRole("combobox")).toHaveLength(4);
  });
});

describe("SettingsPanel profile section", () => {
  afterEach(() => {
    mockedLoadVoices.mockReset();
    mockedChangeUsername.mockReset();
  });

  it("calls onLogout when the Log out button is clicked", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    const onLogout = vi.fn();
    renderPanel({ onLogout });

    const user = await openSection("Profile");
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("calls the websocket's setUsername with the new name on a successful username change", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    mockedChangeUsername.mockResolvedValue({ type: "username_changed", username: "bob" });
    const setUsername = vi.fn();
    renderPanel({ setUsername, username: "alice" });

    const user = await openSection("Profile");
    await user.type(screen.getByPlaceholderText("New username"), "bob");
    // "Current password" also appears in the change-password form above this one.
    await user.type(screen.getAllByPlaceholderText("Current password")[1], "correct-horse-battery-staple");
    await user.click(screen.getByRole("button", { name: "Change username" }));

    expect(await screen.findByText("Username changed to bob.")).toBeInTheDocument();
    expect(setUsername).toHaveBeenCalledWith("bob");
  });

  it("shows an error and does not call setUsername when the change fails", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    mockedChangeUsername.mockRejectedValue(new Error("That username is taken."));
    const setUsername = vi.fn();
    renderPanel({ setUsername });

    const user = await openSection("Profile");
    await user.type(screen.getByPlaceholderText("New username"), "bob");
    await user.type(screen.getAllByPlaceholderText("Current password")[1], "wrong");
    await user.click(screen.getByRole("button", { name: "Change username" }));

    expect(await screen.findByText("That username is taken.")).toBeInTheDocument();
    expect(setUsername).not.toHaveBeenCalled();
  });
});
