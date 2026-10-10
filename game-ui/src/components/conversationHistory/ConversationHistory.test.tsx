import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConversationHistory, { type ConversationHistoryProps } from "./ConversationHistory";
import { getTabInfo, shortName, type ChatMsg } from "./chat";
import { StakeholderContext } from "../StakeholderProvider";
import { MetricsContext } from "../MetricProvider";

vi.mock("../../utils/tour", () => ({ startTour: vi.fn() }));

const stakeholders = {
  ruth: { id: "ruth", name: "Ruth", metric_id: "rel", stakeholder_color: "#e11d48" },
  aaron: { id: "aaron", name: "Aaron", metric_id: "auto", stakeholder_color: "#f97316" },
  ellen: { id: "ellen", name: "Efficiency Ellen", metric_id: "eff", stakeholder_color: "#06b6d4" },
};
const metrics = {
  rel: { id: "rel", name: "Reliability", metric_color: "#e11d48" },
  auto: { id: "auto", name: "Automation", metric_color: "#f97316" },
  eff: { id: "eff", name: "Efficiency", metric_color: "#06b6d4" },
};

function msg(over: Partial<ChatMsg>): ChatMsg {
  return { id: "ruth", message: "Hello there.", ac_id: -1, conversation_id: "pitch_1", ...over };
}

function renderHistory(props: Partial<ConversationHistoryProps> = {}) {
  const all: ConversationHistoryProps = {
    chatMsgs: [],
    currentPhase: 1,
    currentChallenge: 1,
    isEnabled: true,
    actionCards: [],
    onHoverCard: () => {},
    ...props,
  };
  const ui = (p: ConversationHistoryProps) => (
    <StakeholderContext.Provider value={{ stakeholders, setStakeholders: () => {} } as never}>
      <MetricsContext.Provider value={{ metrics, setMetrics: () => {} } as never}>
        <ConversationHistory {...p} />
      </MetricsContext.Provider>
    </StakeholderContext.Provider>
  );
  const view = render(ui(all));
  return { ...view, update: (next: Partial<ConversationHistoryProps>) => view.rerender(ui({ ...all, ...next })) };
}

describe("tabs", () => {
  it("shows one tab per conversation with its own count and filters the lines", async () => {
    const chatMsgs = [
      msg({ message: "Pitch line one." }),
      msg({ message: "Pitch line two." }),
      msg({ id: "aaron", message: "Sync line.", conversation_id: "eng_team_sync_1" }),
    ];
    renderHistory({ chatMsgs });

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("Action Pitch #1");
    expect(tabs[0]).toHaveTextContent("2");

    // The newest message's conversation is the active one.
    expect(screen.getByText("Sync line.")).toBeInTheDocument();
    expect(screen.queryByText("Pitch line one.")).not.toBeInTheDocument();

    await userEvent.click(tabs[0]);
    expect(screen.getByText("Pitch line one.")).toBeInTheDocument();
    expect(screen.queryByText("Sync line.")).not.toBeInTheDocument();
  });

  it("follows a new message into its conversation", () => {
    const first = [msg({ message: "Pitch line." })];
    const { update } = renderHistory({ chatMsgs: first });
    update({ chatMsgs: [...first, msg({ id: "aaron", message: "Later line.", conversation_id: "eng_x_1" })] });
    expect(screen.getByText("Later line.")).toBeInTheDocument();
  });

  it("jumps to the pitch tab being evaluated", () => {
    const chatMsgs = [msg({ message: "Old.", conversation_id: "eng_x_1" })];
    const { update } = renderHistory({ chatMsgs });
    update({ evaluatingConversationId: "pitch_2", isPitchEvaluating: true });
    expect(screen.getByText("Presenting Action Proposal...")).toBeInTheDocument();
  });

  it("calls onToggleMaximize from the header button", async () => {
    const onToggleMaximize = vi.fn();
    renderHistory({ chatMsgs: [msg({})], onToggleMaximize });
    await userEvent.click(screen.getByRole("button", { name: /maximize conversation history/i }));
    expect(onToggleMaximize).toHaveBeenCalledOnce();
  });
});

describe("messages", () => {
  it("names the speaker, their metric and mood", () => {
    renderHistory({ chatMsgs: [msg({ emotional_state: "anxious", message: "We have a concern." })] });
    const bubble = screen.getByTestId("chat-bubble");
    expect(within(bubble).getByText("Ruth")).toBeInTheDocument();
    expect(within(bubble).getByText("Reliability")).toBeInTheDocument();
    expect(within(bubble).getByText("anxious")).toBeInTheDocument();
    expect(within(bubble).getByText("We have a concern.")).toBeInTheDocument();
  });

  it("does not say the role twice: the role chip replaces it in the name", () => {
    renderHistory({ chatMsgs: [msg({ id: "ellen", message: "Ship it small." })] });
    const bubble = screen.getByTestId("chat-bubble");
    expect(within(bubble).getByText("Ellen")).toBeInTheDocument();
    expect(within(bubble).getByText("Efficiency")).toBeInTheDocument();
    expect(within(bubble).queryByText("Efficiency Ellen")).not.toBeInTheDocument();
  });

  it("renders the narrated line sentence by sentence, matched by reference, and the rest plain", () => {
    const live = msg({ message: "First one. Second one." });
    const other = msg({ id: "aaron", message: "Not narrated." });
    const { container } = renderHistory({ chatMsgs: [live, other], liveChatMsg: live, activeSentenceIndex: 0 });
    const states = Array.from(container.querySelectorAll("[data-spoken-state]")).map((el) => el.getAttribute("data-spoken-state"));
    expect(states).toEqual(["active", "upcoming"]);
    expect(screen.getByText("Not narrated.")).toBeInTheDocument();
  });

  it("offers play on every line and stop only on the narrated one", async () => {
    const live = msg({ message: "Live line." });
    const other = msg({ id: "aaron", message: "Other line." });
    const onPlayMessage = vi.fn();
    const onStopSpeech = vi.fn();
    renderHistory({ chatMsgs: [live, other], liveChatMsg: live, activeSentenceIndex: 0, onPlayMessage, onStopSpeech });

    expect(screen.getAllByRole("button", { name: /stop speaking/i })).toHaveLength(1);
    const playButtons = screen.getAllByRole("button", { name: /replay from the start|read this message aloud$/i });
    await userEvent.click(playButtons[playButtons.length - 1]);
    expect(onPlayMessage).toHaveBeenCalledWith(other);
    await userEvent.click(screen.getByRole("button", { name: /stop speaking/i }));
    expect(onStopSpeech).toHaveBeenCalledOnce();
  });

  it("shows what the player did as a line, not a stakeholder bubble", () => {
    renderHistory({ chatMsgs: [msg({ id: "user", message: "What do you need?", conversation_id: "eng_team_sync_1" })] });
    expect(screen.queryByTestId("chat-bubble")).not.toBeInTheDocument();
    expect(screen.getByText(/You played Team Sync/)).toBeInTheDocument();
    expect(screen.getByText("What do you need?")).toBeInTheDocument();
  });

  it("shows system messages as a system line", () => {
    renderHistory({ chatMsgs: [msg({ id: "__environment__", message: "Latency rose." })] });
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Latency rose.")).toBeInTheDocument();
  });
});

describe("intel chips", () => {
  const intel = { id: "i1", description: "Aaron wants manual reviews gone", categorized_type: "driver", is_verified: true, stakeholder_id: "aaron" };

  it("labels the state and type and opens the dossier on click", async () => {
    const onInspectIntel = vi.fn();
    renderHistory({ chatMsgs: [msg({ id: "aaron", revealed_intel: [intel] })], onInspectIntel });
    const chip = screen.getByTestId("intel-chip");
    expect(chip).toHaveTextContent("Verified Driver");
    expect(chip).toHaveTextContent("Aaron wants manual reviews gone");
    await userEvent.click(chip);
    expect(onInspectIntel).toHaveBeenCalledWith(intel, "aaron");
  });

  it("is not a button the player can press without a handler", () => {
    renderHistory({ chatMsgs: [msg({ id: "aaron", revealed_intel: [intel] })] });
    expect(screen.getByTestId("intel-chip")).toBeDisabled();
  });

  it("calls it a correction when the item was corrected", () => {
    renderHistory({ chatMsgs: [msg({ id: "aaron", revealed_intel: [{ ...intel, is_verified: false, is_corrected: true }] })] });
    expect(screen.getByTestId("intel-chip")).toHaveTextContent("Corrected Driver");
  });
});

describe("proposal band and stance tags", () => {
  const pitch = [
    msg({ id: "aaron", message: "First pushback." }),
    msg({ id: "aaron", message: "Second pushback." }),
    msg({ id: "ruth", message: "Hard no." }),
  ];
  const band = {
    proposal: { label: "KPI definition", count: 3 },
    verdicts: [
      { stakeholderId: "aaron", name: "Aaron", state: "pushback" as const },
      { stakeholderId: "ruth", name: "Ruth", state: "objection" as const },
      { stakeholderId: "ellen", name: "Ellen", state: "waiting" as const },
    ],
    stances: { aaron: "pushback" as const, ruth: "objection" as const },
    pitchConversationId: "pitch_1",
  };

  it("shows the proposal and a chip per stakeholder on the pitch tab", () => {
    renderHistory({ chatMsgs: pitch, ...band });
    const bandEl = screen.getByTestId("proposal-band");
    expect(bandEl).toHaveTextContent("KPI definition");
    expect(bandEl).toHaveTextContent("+2");
    const states = Array.from(bandEl.querySelectorAll("[data-state]")).map((el) => el.getAttribute("data-state"));
    expect(states).toEqual(["pushback", "objection", "waiting"]);
  });

  it("tags only each stakeholder's last reply", () => {
    renderHistory({ chatMsgs: pitch, ...band });
    const bubbles = screen.getAllByTestId("chat-bubble");
    expect(within(bubbles[0]).queryByText("Pushback")).not.toBeInTheDocument();
    expect(within(bubbles[1]).getByText("Pushback")).toBeInTheDocument();
    expect(within(bubbles[2]).getByText("Objection")).toBeInTheDocument();
  });

  it("shows neither on another tab", async () => {
    const chatMsgs = [...pitch, msg({ id: "aaron", message: "Sync.", conversation_id: "eng_x_1" })];
    renderHistory({ chatMsgs, ...band });
    expect(screen.queryByTestId("proposal-band")).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("tab")[0]);
    expect(screen.getByTestId("proposal-band")).toBeInTheDocument();
  });
});

describe("typing line", () => {
  it("names the stakeholder who is writing", () => {
    renderHistory({ chatMsgs: [msg({})], isTyping: true, typingStakeholderId: "aaron" });
    expect(screen.getByText("Aaron is writing")).toBeInTheDocument();
  });

  it("falls back to the generic text", () => {
    renderHistory({ chatMsgs: [msg({})], isTyping: true, typingText: "Stakeholders are reviewing..." });
    expect(screen.getByText("Stakeholders are reviewing...")).toBeInTheDocument();
  });

  it("shows nothing when nobody is typing", () => {
    renderHistory({ chatMsgs: [msg({})] });
    expect(screen.queryByText(/is writing|typing/)).not.toBeInTheDocument();
  });
});

describe("empty state", () => {
  it("explains how to start a conversation", () => {
    renderHistory();
    expect(screen.getByText("No messages in this conversation")).toBeInTheDocument();
  });
});

describe("shortName", () => {
  it("drops a leading role word that the role label already shows", () => {
    expect(shortName("Reliability Ruth", "Reliability")).toBe("Ruth");
    expect(shortName("Requirements Ryan", "Requirements Engineering")).toBe("Ryan");
  });

  it("keeps the name when there is no role or no match", () => {
    expect(shortName("Ruth", "Reliability")).toBe("Ruth");
    expect(shortName("Reliability Ruth")).toBe("Reliability Ruth");
    expect(shortName("Dana Smith", "Reliability")).toBe("Dana Smith");
  });
});

describe("getTabInfo", () => {
  it("titles pitch, engagement and verification tabs", () => {
    expect(getTabInfo("pitch_3").title).toBe("Action Pitch #3");
    expect(getTabInfo("verify_2").title).toBe("Intel Verification #2");
    expect(getTabInfo("eng_team_sync_2").title).toBe("Team Sync #2");
    expect(getTabInfo("default").title).toBe("Conversation");
  });
});

