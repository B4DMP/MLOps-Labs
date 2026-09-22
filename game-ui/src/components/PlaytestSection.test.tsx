import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PlaytestSection from "./PlaytestSection";
import SettingsPanel from "./SettingsPanel";
import { DEFAULT_SETTINGS, SettingsContext } from "./SettingsProvider";
import { WebSocketContext } from "../services/websocket/WebSocketContext";
import type { EventCallback, WebSocketContextValue } from "../services/websocket/types";

vi.mock("../utils/speech", () => ({
  loadVoices: vi.fn(() => Promise.resolve([])),
  speak: vi.fn(() => () => {}),
  cancelSpeech: vi.fn(),
}));

function fakeSocket(overrides: Partial<WebSocketContextValue> = {}) {
  const listeners = new Map<string, EventCallback>();
  const value: WebSocketContextValue = {
    isConnected: true,
    username: "alice",
    setUsername: vi.fn(),
    emit: vi.fn(),
    subscribe: vi.fn((event: string, callback: EventCallback) => {
      listeners.set(event, callback);
      return () => listeners.delete(event);
    }) as WebSocketContextValue["subscribe"],
    lastError: null,
    setLastError: vi.fn(),
    ...overrides,
  };
  const push = (event: string, payload: unknown) =>
    act(() => listeners.get(event)?.(payload, { event, payload }));
  return { value, push };
}

const renderSection = (socket: WebSocketContextValue, onSkipped?: () => void) =>
  render(
    <WebSocketContext.Provider value={socket}>
      <PlaytestSection onSkipped={onSkipped} />
    </WebSocketContext.Provider>,
  );

const emitted = (socket: WebSocketContextValue) =>
  vi.mocked(socket.emit).mock.calls.map(([event]) => event);

describe("PlaytestSection", () => {
  it("offers both tools and warns that using one taints the account", () => {
    renderSection(fakeSocket().value);

    expect(screen.getByRole("button", { name: "Auto-pitch a card" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip this challenge" })).toBeInTheDocument();
    expect(screen.getByText(/left out of the research data/)).toBeInTheDocument();
  });

  it("needs two presses: the first arms the button and sends nothing", async () => {
    const { value } = fakeSocket();
    renderSection(value);

    await userEvent.click(screen.getByRole("button", { name: "Skip this challenge" }));

    expect(screen.getByRole("button", { name: "Click again to confirm" })).toBeInTheDocument();
    expect(value.emit).not.toHaveBeenCalled();
  });

  it.each([
    ["Auto-pitch a card", "playtest:auto_card"],
    ["Skip this challenge", "playtest:skip_challenge"],
  ])("sends %s to the server only on the second press", async (label, event) => {
    const { value } = fakeSocket();
    renderSection(value);

    await userEvent.click(screen.getByRole("button", { name: label }));
    await userEvent.click(screen.getByRole("button", { name: "Click again to confirm" }));

    expect(value.emit).toHaveBeenCalledTimes(1);
    expect(value.emit).toHaveBeenCalledWith(event, {});
  });

  it("re-arms rather than fires when a different button is pressed while one is armed", async () => {
    const { value } = fakeSocket();
    renderSection(value);

    await userEvent.click(screen.getByRole("button", { name: "Skip this challenge" }));
    await userEvent.click(screen.getByRole("button", { name: "Auto-pitch a card" }));

    // The skip was armed, then the other button was pressed: that arms the other, it fires nothing.
    expect(value.emit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Skip this challenge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Click again to confirm" })).toBeInTheDocument();
  });

  it("disables both buttons while a request is in flight, so it cannot be sent twice", async () => {
    const { value } = fakeSocket();
    renderSection(value);

    await userEvent.click(screen.getByRole("button", { name: "Auto-pitch a card" }));
    await userEvent.click(screen.getByRole("button", { name: "Click again to confirm" }));

    expect(screen.getByRole("button", { name: "Working" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip this challenge" })).toBeDisabled();
    expect(emitted(value)).toEqual(["playtest:auto_card"]);
  });

  it("describes the card it slotted, and frees the buttons again", async () => {
    const { value, push } = fakeSocket();
    renderSection(value);
    await userEvent.click(screen.getByRole("button", { name: "Auto-pitch a card" }));
    await userEvent.click(screen.getByRole("button", { name: "Click again to confirm" }));

    push("playtest:auto_card_result", { ok: true, outcome: "SOFT_PASS", changes: [{}, {}], choices: 56 });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Slotted a pass with reservations: 2 changes, picked from 56 that would get through.",
    );
    expect(screen.getByRole("button", { name: "Auto-pitch a card" })).toBeEnabled();
  });

  it("calls a clean pass a clean pass", async () => {
    const { value, push } = fakeSocket();
    renderSection(value);
    push("playtest:auto_card_result", { ok: true, outcome: "PASS", changes: [{}], choices: 3 });

    expect(screen.getByRole("status")).toHaveTextContent("Slotted a clean pass: 1 change,");
  });

  it("says plainly when no card exists that the room would not veto, and how close it came", async () => {
    const { value, push } = fakeSocket();
    renderSection(value);
    push("playtest:auto_card_result", {
      ok: false, reason: "no_non_veto_card", outcome: "VETO", evaluated: 400, min_buy_in: 0.21,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "No card found that the room would not veto, after trying 400. The closest came to 21% buy-in.",
    );
  });

  it("makes clear that a refused skip committed nothing", () => {
    const { value, push } = fakeSocket();
    renderSection(value);
    push("playtest:skip_result", { ok: false, reason: "no_non_veto_card", evaluated: 12, min_buy_in: 0.1 });

    expect(screen.getByRole("status")).toHaveTextContent("Nothing was committed.");
  });

  it("explains an empty room rather than reporting a failed search", () => {
    const { value, push } = fakeSocket();
    renderSection(value);
    push("playtest:auto_card_result", { ok: false, reason: "nothing_to_slot" });

    expect(screen.getByRole("status")).toHaveTextContent("nothing to build a card on yet");
  });

  it("does not reload the page once a skip has gone through", () => {
    // The game underneath has already moved on by itself (via the normal game:state_update /
    // game:progress_change events `handle_playtest_skip_challenge` triggers); reloading would
    // throw that away and restart the whole session, which reads as a logout.
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      const { value, push } = fakeSocket();
      renderSection(value);

      push("playtest:skipped", { ok: true });
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("closes the settings panel once a skip has gone through, so the briefing underneath shows", () => {
    const onSkipped = vi.fn();
    const { value, push } = fakeSocket();
    renderSection(value, onSkipped);

    push("playtest:skipped", { ok: true });

    expect(onSkipped).toHaveBeenCalledTimes(1);
  });

  it("re-enables its buttons once a skip has gone through, in case the panel stays open", async () => {
    const { value, push } = fakeSocket();
    renderSection(value);
    await userEvent.click(screen.getByRole("button", { name: "Skip this challenge" }));
    await userEvent.click(screen.getByRole("button", { name: "Click again to confirm" }));
    expect(screen.getByRole("button", { name: "Working" })).toBeDisabled();

    push("playtest:skipped", { ok: true });

    expect(screen.getByRole("button", { name: "Skip this challenge" })).toBeEnabled();
  });

  it("works without an onSkipped callback", () => {
    const { value, push } = fakeSocket();
    renderSection(value);
    expect(() => push("playtest:skipped", { ok: true })).not.toThrow();
  });

  it("frees the buttons when the server refuses with an error", async () => {
    const socket = fakeSocket();
    const { rerender } = renderSection(socket.value);
    await userEvent.click(screen.getByRole("button", { name: "Skip this challenge" }));
    await userEvent.click(screen.getByRole("button", { name: "Click again to confirm" }));
    expect(screen.getByRole("button", { name: "Working" })).toBeDisabled();

    rerender(
      <WebSocketContext.Provider value={{ ...socket.value, lastError: "Playtest tools are disabled." }}>
        <PlaytestSection />
      </WebSocketContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Skip this challenge" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Auto-pitch a card" })).toBeEnabled();
  });

  it("stops listening when it unmounts", () => {
    const off = vi.fn();
    const socket = fakeSocket({ subscribe: vi.fn(() => off) as unknown as WebSocketContextValue["subscribe"] });
    const { unmount } = renderSection(socket.value);

    unmount();
    expect(off).toHaveBeenCalledTimes(3);
  });
});

describe("the settings panel", () => {
  const renderPanel = (canPlaytest: boolean, socket: WebSocketContextValue, onClose = vi.fn()) =>
    render(
      <WebSocketContext.Provider value={socket}>
        <SettingsContext.Provider
          value={{
            settings: DEFAULT_SETTINGS,
            updateSettings: vi.fn(),
            canResetAccount: false,
            resetAccount: vi.fn(),
            canPlaytest,
          }}
        >
          <SettingsPanel isVisible onClose={onClose} />
        </SettingsContext.Provider>
      </WebSocketContext.Provider>,
    );

  it("shows the playtest tools only when the server has them on", () => {
    const { unmount } = renderPanel(true, fakeSocket().value);
    expect(screen.getByText("Playtest tools")).toBeInTheDocument();
    unmount();

    renderPanel(false, fakeSocket().value);
    expect(screen.queryByText("Playtest tools")).not.toBeInTheDocument();
  });

  it("closes itself when a skip goes through, wired end to end from the panel's own onClose", () => {
    const onClose = vi.fn();
    const { value, push } = fakeSocket();
    renderPanel(true, value, onClose);

    push("playtest:skipped", { ok: true });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
