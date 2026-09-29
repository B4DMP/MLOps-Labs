import { fireEvent, render, screen, within } from "@testing-library/react";
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
}));

import { loadVoices, speak } from "../utils/speech";
import { changeEmail, confirmEmailChange } from "../services/api/auth";

const mockedLoadVoices = vi.mocked(loadVoices);
const mockedSpeak = vi.mocked(speak);
const mockedChangeEmail = vi.mocked(changeEmail);
const mockedConfirmEmailChange = vi.mocked(confirmEmailChange);

function fakeWebSocketContext(email = "alice@example.test", setEmail = vi.fn()): WebSocketContextValue {
  return {
    isConnected: true,
    userId: 1,
    email,
    setEmail,
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
  email?: string;
  onLogout?: () => void;
  setEmail?: (e: string) => void;
} = {}) {
  const settings: PlayerSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  return render(
    <WebSocketContext.Provider value={fakeWebSocketContext(opts.email ?? "alice@example.test", opts.setEmail)}>
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
  });

  it("starts with every section collapsed", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: true });

    expect(screen.queryByText("Signed in as alice@example.test")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset my account")).not.toBeInTheDocument();
  });

  it("opens exactly one section at a time", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ settings: { tts_backend: "webspeech" } });

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

  it("keeps the final reset button disabled until the email is typed", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ canResetAccount: true, email: "alice@example.test" });

    const user = await openSection("Account");
    await user.click(screen.getByText("Reset my account"));

    const confirmButton = screen.getByRole("button", { name: "Permanently reset my account" });
    expect(confirmButton).toBeDisabled();

    const input = screen.getByRole("textbox");
    await user.type(input, "wrong@example.test");
    expect(confirmButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "alice@example.test");
    expect(confirmButton).toBeEnabled();
  });

  it("renders the diagnostic line instead of four empty selects when no voices are installed", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    renderPanel({ settings: { tts_backend: "webspeech" } });

    await openSection("Voice");
    expect(await screen.findByText(/no speech voices|speech-dispatcher/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders one dropdown per voice slot when voices are available", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop"), fakeVoice("Microsoft Zira Desktop")]);
    renderPanel({ settings: { tts_backend: "webspeech" } });

    await openSection("Voice");
    expect(await screen.findAllByRole("combobox")).toHaveLength(4);
  });

  it("hides the per-slot voice pickers entirely while Server voices is on", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ settings: { tts_backend: "auto" } });

    await openSection("Voice");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Preview the/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no speech voices|speech-dispatcher/i)).not.toBeInTheDocument();
  });

  it("shows the server-voices toggle checked when tts_backend is auto", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ settings: { tts_backend: "auto" } });

    await openSection("Voice");
    expect(screen.getByRole("checkbox", { name: "Server voices (recommended)" })).toBeChecked();
  });

  it("unchecking the server-voices toggle updates tts_backend to webspeech", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    const updateSettings = vi.fn();
    const user = userEvent.setup();
    render(
      <WebSocketContext.Provider value={fakeWebSocketContext()}>
        <SettingsContext.Provider
          value={{
            settings: { ...DEFAULT_SETTINGS, tts_backend: "auto" },
            updateSettings,
            canResetAccount: false,
            resetAccount: vi.fn(),
            canPlaytest: false,
          }}
        >
          <SettingsPanel isVisible onClose={() => {}} onLogout={vi.fn()} />
        </SettingsContext.Provider>
      </WebSocketContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Voice" }));
    await user.click(screen.getByRole("checkbox", { name: "Server voices (recommended)" }));

    expect(updateSettings).toHaveBeenCalledWith({ tts_backend: "webspeech" });
  });

  it("shows the your-voice toggle set to Male for a male setting", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ settings: { player_voice_gender: "male" } });

    await openSection("Voice");
    const group = screen.getByRole("group", { name: "Your voice" });
    expect(within(group).getByRole("button", { name: "Male" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(group).getByRole("button", { name: "Female" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking Female on the your-voice toggle updates player_voice_gender to female", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    const updateSettings = vi.fn();
    const user = userEvent.setup();
    render(
      <WebSocketContext.Provider value={fakeWebSocketContext()}>
        <SettingsContext.Provider
          value={{
            settings: { ...DEFAULT_SETTINGS, player_voice_gender: "male" },
            updateSettings,
            canResetAccount: false,
            resetAccount: vi.fn(),
            canPlaytest: false,
          }}
        >
          <SettingsPanel isVisible onClose={() => {}} onLogout={vi.fn()} />
        </SettingsContext.Provider>
      </WebSocketContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Voice" }));
    const group = screen.getByRole("group", { name: "Your voice" });
    await user.click(within(group).getByRole("button", { name: "Female" }));

    expect(updateSettings).toHaveBeenCalledWith({ player_voice_gender: "female" });
  });

  it("shows the narration-speed slider at the stored value", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    renderPanel({ settings: { speech_rate: 1.25 } });

    await openSection("Voice");
    expect(screen.getByRole("slider", { name: "Narration speed" })).toHaveValue("1.25");
    expect(screen.getByText("1.25x")).toBeInTheDocument();
  });

  it("moving the narration-speed slider updates speech_rate", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    const updateSettings = vi.fn();
    render(
      <WebSocketContext.Provider value={fakeWebSocketContext()}>
        <SettingsContext.Provider
          value={{
            settings: DEFAULT_SETTINGS,
            updateSettings,
            canResetAccount: false,
            resetAccount: vi.fn(),
            canPlaytest: false,
          }}
        >
          <SettingsPanel isVisible onClose={() => {}} onLogout={vi.fn()} />
        </SettingsContext.Provider>
      </WebSocketContext.Provider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Voice" }));
    const slider = screen.getByRole("slider", { name: "Narration speed" });
    fireEvent.change(slider, { target: { value: "1.4" } });

    expect(updateSettings).toHaveBeenCalledWith({ speech_rate: 1.4 });
  });

  it("previewing 'You' passes the currently selected gender through", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    mockedSpeak.mockClear();
    // The per-slot voice pickers (and their preview buttons) are hidden while Server voices is
    // on, since they'd have no effect - switch to webspeech so the button under test exists.
    renderPanel({ settings: { player_voice_gender: "female", tts_backend: "webspeech" } });

    await openSection("Voice");
    await userEvent.setup().click(screen.getByRole("button", { name: "Preview the You voice" }));

    expect(mockedSpeak).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ slot: "player", playerGender: "female" }),
    );
  });

  it("previewing a stakeholder voice does not pass a playerGender", async () => {
    mockedLoadVoices.mockResolvedValue([fakeVoice("Microsoft David Desktop")]);
    mockedSpeak.mockClear();
    renderPanel({ settings: { player_voice_gender: "female", tts_backend: "webspeech" } });

    await openSection("Voice");
    await userEvent.setup().click(screen.getByRole("button", { name: "Preview the Male stakeholders voice" }));

    expect(mockedSpeak).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ slot: "male", playerGender: undefined }),
    );
  });
});

describe("SettingsPanel profile section", () => {
  afterEach(() => {
    mockedLoadVoices.mockReset();
    mockedChangeEmail.mockReset();
    mockedConfirmEmailChange.mockReset();
  });

  it("calls onLogout when the Log out button is clicked", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    const onLogout = vi.fn();
    renderPanel({ onLogout });

    const user = await openSection("Profile");
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("tells the websocket context the new email once the change is confirmed", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    mockedChangeEmail.mockResolvedValue({ type: "email_change_code_sent" });
    mockedConfirmEmailChange.mockResolvedValue({ type: "email_changed" });
    const setEmail = vi.fn();
    renderPanel({ setEmail, email: "alice@example.test" });

    const user = await openSection("Profile");
    await user.type(screen.getByPlaceholderText("New email address"), "bob@example.test");
    await user.click(screen.getByRole("button", { name: "Send confirmation code" }));
    await user.type(await screen.findByPlaceholderText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Email changed.")).toBeInTheDocument();
    expect(setEmail).toHaveBeenCalledWith("bob@example.test");
  });

  it("does not touch the websocket context when the confirmation fails", async () => {
    mockedLoadVoices.mockResolvedValue([]);
    mockedChangeEmail.mockResolvedValue({ type: "email_change_code_sent" });
    mockedConfirmEmailChange.mockRejectedValue(new Error("Invalid code."));
    const setEmail = vi.fn();
    renderPanel({ setEmail });

    const user = await openSection("Profile");
    await user.type(screen.getByPlaceholderText("New email address"), "bob@example.test");
    await user.click(screen.getByRole("button", { name: "Send confirmation code" }));
    await user.type(await screen.findByPlaceholderText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Invalid code.")).toBeInTheDocument();
    expect(setEmail).not.toHaveBeenCalled();
  });
});
