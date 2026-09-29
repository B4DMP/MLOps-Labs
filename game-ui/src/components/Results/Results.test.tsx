import { forwardRef, useImperativeHandle } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ResultsHero from "./ResultsHero";
import ResultsScreen from "./ResultsScreen";
import ResultsTabs from "./ResultsTabs";
import type { ResultsPayload } from "./types";
import { WebSocketContext } from "../../services/websocket/WebSocketContext";
import type { EventCallback, WebSocketContextValue } from "../../services/websocket/types";
import fixtures from "../dev/resultsFixtures.json";

// jsdom has no canvas, so Chart.js cannot draw. The tabs' own logic is what is under test here.
vi.mock("react-chartjs-2", () => ({ Line: () => <div data-testid="line-chart" /> }));

// The hero's medal animation renders into a shadow root with a constructable stylesheet, neither
// of which jsdom implements. The player's own behaviour is Lordicon's to test, not ours.
vi.mock("@lordicon/react", () => ({
  Player: forwardRef((_props: unknown, ref: React.Ref<{ playFromBeginning: () => void }>) => {
    useImperativeHandle(ref, () => ({ playFromBeginning: () => {} }));
    return <div data-testid="medal-icon" />;
  }),
}));

const fixture = (key: "S" | "C" | "E"): ResultsPayload =>
  structuredClone((fixtures as unknown as Record<string, ResultsPayload>)[key]);

const METRIC_INFO = {
  model: { name: "Model", metric_color: "#3b82f6", metric_icon: "lucide:brain-circuit" },
};

// ── The hero ─────────────────────────────────────────────────────────────────

describe("ResultsHero", () => {
  it("shows the grade, its label and the overall percentage", () => {
    render(<ResultsHero results={fixture("S")} />);

    const card = screen.getByRole("region", { name: "Run summary" });
    expect(card).toHaveAttribute("data-grade", "S");
    expect(within(card).getByText("Exemplary")).toBeInTheDocument();
    expect(within(card).getByText("91% overall")).toBeInTheDocument();
  });

  it("names the setting from the payload rather than hardcoding it", () => {
    const results = fixture("C");
    results.setting = { company: "Acme Grocers", system: "Forecaster" };
    render(<ResultsHero results={results} />);

    expect(screen.getByText(/Forecaster/)).toBeInTheDocument();
    expect(screen.getByText("What became of Acme Grocers")).toBeInTheDocument();
    expect(screen.queryByText(/Lindenmarkt/)).not.toBeInTheDocument();
  });

  it("renders each pillar as an accessible meter with its value", () => {
    render(<ResultsHero results={fixture("C")} />);

    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(4);
    const relations = screen.getByRole("meter", { name: "Stakeholder relations" });
    expect(relations).toHaveAttribute("aria-valuenow", "55");
    expect(relations).toHaveAttribute("aria-valuemin", "0");
    expect(relations).toHaveAttribute("aria-valuemax", "100");
  });

  it("shows the verdict and all four scoreboard lines", () => {
    const results = fixture("C");
    render(<ResultsHero results={results} />);

    // The closing carries an authored line break between its two sentences (rendered via
    // white-space: pre-line), so match on text content rather than the exact multi-line string.
    expect(screen.getByText((_, el) => el?.textContent === results.epilogue.closing)).toBeInTheDocument();
    for (const label of ["Availability", "Waste", "Residual stock", "Override rate"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(results.epilogue.scoreboard.override_rate)).toBeInTheDocument();
  });

  it("says so when a pillar is scored against an inherited system", () => {
    render(<ResultsHero results={fixture("E")} />);
    expect(screen.getByText("gained on the system you inherited")).toBeInTheDocument();
  });

  it("labels a next-iteration run as one, and a first run as a plain run", () => {
    const { unmount } = render(<ResultsHero results={fixture("E")} />);
    expect(screen.getByText("Iteration 2")).toBeInTheDocument();
    expect(screen.getByText("next iteration")).toBeInTheDocument();
    unmount();

    render(<ResultsHero results={fixture("C")} />);
    expect(screen.getByText("Run 1")).toBeInTheDocument();
    expect(screen.queryByText("next iteration")).not.toBeInTheDocument();
  });

  it("only shows the playtest ribbon when the account used the playtest tools", () => {
    const { unmount } = render(<ResultsHero results={fixture("C")} />);
    expect(screen.queryByText("Playtest account")).not.toBeInTheDocument();
    unmount();

    render(<ResultsHero results={fixture("C")} playtest />);
    expect(screen.getByText("Playtest account")).toBeInTheDocument();
  });

  it("never carries the grade in colour alone: the letter and label are always in the text", () => {
    render(<ResultsHero results={fixture("E")} />);
    expect(screen.getAllByText("E").length).toBeGreaterThan(0);
    expect(screen.getByText("Overwhelmed")).toBeInTheDocument();
    expect(screen.getByText(/Grade E, Overwhelmed, 22 percent overall/)).toBeInTheDocument();
  });

  it("counts the vetoes and the intel found in the headline strip", () => {
    render(<ResultsHero results={fixture("E")} />);
    // The E fixture has three vetoes and 7 of 30 notes found.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7 of 30")).toBeInTheDocument();
  });
});

// ── The tabs ─────────────────────────────────────────────────────────────────

describe("ResultsTabs", () => {
  it("opens on Intel and marks it selected", () => {
    render(<ResultsTabs results={fixture("C")} metricInfo={METRIC_INFO} />);
    expect(screen.getByRole("tab", { name: "Intel" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Intel");
  });

  it("switches panels on click", async () => {
    render(<ResultsTabs results={fixture("C")} metricInfo={METRIC_INFO} />);
    await userEvent.click(screen.getByRole("tab", { name: "Decisions" }));

    expect(screen.getByRole("tab", { name: "Decisions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Challenge by challenge")).toBeInTheDocument();
  });

  it("moves between tabs with the arrow keys, wrapping at the ends", async () => {
    render(<ResultsTabs results={fixture("C")} metricInfo={METRIC_INFO} />);
    screen.getByRole("tab", { name: "Intel" }).focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Stakeholders" })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Intel" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");
  });

  it("leaves the Knowledge tab out when the player was never measured", () => {
    const results = fixture("C");
    results.knowledge = {
      total_questions: 7,
      intro: { correct: null, percent: null },
      outro_per_run: [{ run: 1, correct: null, percent: null }],
      delta: null,
      delta_percent: null,
    };
    render(<ResultsTabs results={results} metricInfo={METRIC_INFO} />);

    expect(screen.queryByRole("tab", { name: "Knowledge" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });

  it("shows the Knowledge tab when there is a before and an after", () => {
    render(<ResultsTabs results={fixture("C")} metricInfo={METRIC_INFO} />);
    expect(screen.getByRole("tab", { name: "Knowledge" })).toBeInTheDocument();
  });

  it("falls back to the first tab if asked to open on one that is not there", () => {
    const results = fixture("C");
    results.knowledge.intro = { correct: null, percent: null };
    render(<ResultsTabs results={results} metricInfo={METRIC_INFO} initialTab="knowledge" />);
    expect(screen.getByRole("tab", { name: "Intel" })).toHaveAttribute("aria-selected", "true");
  });

  it.each(["intel", "stakeholders", "decisions", "pipeline", "metrics", "knowledge", "timeline"] as const)(
    "renders the %s tab for a real-shaped payload without crashing",
    (tab) => {
      render(<ResultsTabs results={fixture("C")} metricInfo={METRIC_INFO} initialTab={tab} />);
      expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    },
  );
});

describe("Intel tab (D7)", () => {
  it("shows counts and the confusion matrix, never a note's wording", () => {
    const results = fixture("C");
    // A payload that (wrongly) smuggled wording through must still not have it rendered.
    (results.intel as unknown as Record<string, unknown>).leak = "SECRET WORDING";
    render(<ResultsTabs results={results} metricInfo={METRIC_INFO} />);

    expect(screen.getByText("Coverage by stakeholder")).toBeInTheDocument();
    expect(screen.getByText("How you read them")).toBeInTheDocument();
    expect(screen.queryByText(/SECRET WORDING/)).not.toBeInTheDocument();
  });

  it("shows a stakeholder the player found nothing on as an empty bar, not a missing row", () => {
    const results = fixture("C");
    results.intel.per_stakeholder = [
      { id: "data_dave", gathered: 0, available: 4, correct: 0, wrong: 0 },
    ];
    render(<ResultsTabs results={results} metricInfo={METRIC_INFO} />);
    expect(screen.getByText("Data Dave")).toBeInTheDocument();
    // Once in the summary tile and once on the stakeholder's own bar.
    expect(screen.getAllByText("0 of 4")).toHaveLength(2);
  });
});

describe("Decisions tab", () => {
  it("shows an unfinished challenge as unfinished, never as a veto", () => {
    render(<ResultsTabs results={fixture("E")} metricInfo={METRIC_INFO} initialTab="decisions" />);
    // The E fixture ends with two challenges that never reached a commit. Scoped to the list, since
    // "Vetoed" is also a summary tile label above it.
    const list = within(screen.getByText("Challenge by challenge").closest("section") as HTMLElement);
    expect(list.getAllByText("Not finished")).toHaveLength(2);
    expect(list.getAllByText("Vetoed")).toHaveLength(3);
  });
});

describe("Metrics tab", () => {
  it("offers a table view for the chart, since some metric colours are low contrast", async () => {
    render(<ResultsTabs results={fixture("C")} metricInfo={METRIC_INFO} initialTab="metrics" />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /view as table/i }));
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("says a spiral run's change is what it added, not the running total", () => {
    const results = fixture("E");
    render(<ResultsTabs results={results} metricInfo={METRIC_INFO} initialTab="metrics" />);
    expect(screen.getByText(/what this iteration added/)).toBeInTheDocument();
  });

  it("falls back to a readable name when the HUD has none for a metric", () => {
    render(<ResultsTabs results={fixture("C")} metricInfo={{}} initialTab="metrics" />);
    expect(screen.getByText("Automation")).toBeInTheDocument();
  });
});

describe("Pipeline tab", () => {
  it("marks a stage the project never reached", () => {
    const results = fixture("C");
    results.pipeline.stages[4] = { ...results.pipeline.stages[4], locked: true };
    render(<ResultsTabs results={results} metricInfo={METRIC_INFO} initialTab="pipeline" />);
    expect(screen.getByText("Not reached")).toBeInTheDocument();
  });

  it("shows the inherited state only on a next-iteration run", () => {
    const { unmount } = render(
      <ResultsTabs results={fixture("E")} metricInfo={METRIC_INFO} initialTab="pipeline" />,
    );
    expect(screen.getByText("When you inherited it")).toBeInTheDocument();
    unmount();

    render(<ResultsTabs results={fixture("C")} metricInfo={METRIC_INFO} initialTab="pipeline" />);
    expect(screen.queryByText("When you inherited it")).not.toBeInTheDocument();
  });
});

// ── The screen ───────────────────────────────────────────────────────────────

function fakeSocket(overrides: Partial<WebSocketContextValue> = {}) {
  const listeners = new Map<string, EventCallback>();
  const value: WebSocketContextValue = {
    isConnected: true,
    userId: 1,
    email: "alice@example.test",
    setEmail: vi.fn(),
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

function renderScreen(socket: WebSocketContextValue) {
  return render(
    <WebSocketContext.Provider value={socket}>
      <ResultsScreen metricInfo={METRIC_INFO} />
    </WebSocketContext.Provider>,
  );
}

describe("ResultsScreen", () => {
  it("asks for a fresh computation on arrival, not the cached one", () => {
    const { value } = fakeSocket();
    renderScreen(value);
    expect(value.emit).toHaveBeenCalledWith("results:get", { refresh: true });
  });

  it("waits for the connection before asking", () => {
    const { value } = fakeSocket({ isConnected: false });
    renderScreen(value);
    expect(value.emit).not.toHaveBeenCalled();
  });

  it("shows a loading state until the results arrive, then the hero and the tabs", () => {
    const { value, push } = fakeSocket();
    renderScreen(value);
    expect(screen.queryByRole("region", { name: "Run summary" })).not.toBeInTheDocument();

    push("results:data", fixture("C"));

    expect(screen.getByRole("region", { name: "Run summary" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Run details" })).toBeInTheDocument();
  });

  it("keeps the duplicate-session notice for research campaigns", () => {
    const { value, push } = fakeSocket();
    renderScreen(value);
    push("results:data", fixture("C"));
    expect(screen.getByText(/refrain from participating again/)).toBeInTheDocument();
  });

  it("offers a retry when the results cannot be loaded, and asks again when pressed", async () => {
    const { value } = fakeSocket({ lastError: "boom" });
    renderScreen(value);

    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(value.emit).toHaveBeenCalledTimes(2);
  });
});

describe("ResultsScreen: playing again", () => {
  const replayable = () => ({ ...fixture("C"), replay_allowed: true });

  it("offers both new-game modes when the campaign allows it, and no research notice", () => {
    const { value, push } = fakeSocket();
    renderScreen(value);
    push("results:data", replayable());

    expect(screen.getByRole("button", { name: /Next iteration/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fresh start/ })).toBeInTheDocument();
    expect(screen.queryByText(/refrain from participating again/)).not.toBeInTheDocument();
    expect(screen.getByText(/results so far are kept whichever you pick/)).toBeInTheDocument();
  });

  it("offers neither, and keeps the notice, when the campaign does not allow replay", () => {
    const { value, push } = fakeSocket();
    renderScreen(value);
    push("results:data", { ...fixture("C"), replay_allowed: false });

    expect(screen.queryByRole("button", { name: /Next iteration/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fresh start/ })).not.toBeInTheDocument();
    expect(screen.getByText(/refrain from participating again/)).toBeInTheDocument();
  });

  it("puts the next iteration first, since it is the mode that teaches the spiral", () => {
    const { value, push } = fakeSocket();
    renderScreen(value);
    push("results:data", replayable());

    const labels = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const next = labels.findIndex((t) => t.includes("Next iteration"));
    const fresh = labels.findIndex((t) => t.includes("Fresh start"));
    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(fresh);
  });

  it.each([
    ["Next iteration", "spiral"],
    ["Fresh start", "fresh"],
  ])("sends the %s mode to the server as %s", async (label, mode) => {
    const { value, push } = fakeSocket();
    renderScreen(value);
    push("results:data", replayable());

    await userEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    expect(value.emit).toHaveBeenCalledWith("game:new_run", { mode });
  });

  it("disables both buttons once one is pressed, so a double click cannot start two runs", async () => {
    const { value, push } = fakeSocket();
    renderScreen(value);
    push("results:data", replayable());

    await userEvent.click(screen.getByRole("button", { name: /Fresh start/ }));

    expect(screen.getByRole("button", { name: /Starting/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next iteration/ })).toBeDisabled();
    const newRunCalls = vi.mocked(value.emit).mock.calls.filter(([event]) => event === "game:new_run");
    expect(newRunCalls).toHaveLength(1);
  });

  it("re-enables the buttons when the server refuses", async () => {
    const socket = fakeSocket();
    const { rerender } = renderScreen(socket.value);
    socket.push("results:data", replayable());
    await userEvent.click(screen.getByRole("button", { name: /Fresh start/ }));
    expect(screen.getByRole("button", { name: /Next iteration/ })).toBeDisabled();

    rerender(
      <WebSocketContext.Provider value={{ ...socket.value, lastError: "This campaign does not allow a new game." }}>
        <ResultsScreen metricInfo={METRIC_INFO} />
      </WebSocketContext.Provider>,
    );

    expect(screen.getByRole("button", { name: /Next iteration/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Fresh start/ })).toBeEnabled();
  });

  it("reloads into the new run once the server has opened it", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload } });
    try {
      const { value, push } = fakeSocket();
      renderScreen(value);
      push("results:data", replayable());

      push("game:new_run_started", { run_index: 2, mode: "spiral" });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});

