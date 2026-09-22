import { forwardRef, useImperativeHandle } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminResults from "./AdminResults";
import type { AdminPlayerResults, AdminResultsData, Stats } from "./adminTypes";
import type { ResultsPayload } from "./types";
import fixtures from "../dev/resultsFixtures.json";

vi.mock("react-chartjs-2", () => ({ Line: () => <div data-testid="line-chart" /> }));

// The hero's medal animation renders into a shadow root with a constructable stylesheet, neither
// of which jsdom implements. The player's own behaviour is Lordicon's to test, not ours.
vi.mock("@lordicon/react", () => ({
  Player: forwardRef((_props: unknown, ref: React.Ref<{ playFromBeginning: () => void }>) => {
    useImperativeHandle(ref, () => ({ playFromBeginning: () => {} }));
    return <div data-testid="medal-icon" />;
  }),
}));

vi.mock("../../services/api/admin", () => ({
  fetchAdminResults: vi.fn(),
  fetchAdminPlayerResults: vi.fn(),
}));

import { fetchAdminPlayerResults, fetchAdminResults } from "../../services/api/admin";

const mockedResults = vi.mocked(fetchAdminResults);
const mockedPlayer = vi.mocked(fetchAdminPlayerResults);

const stats = (mean: number | null, n = 4): Stats => ({
  n,
  mean,
  median: mean,
  stdev: n > 1 && mean !== null ? 0.1 : null,
  min: mean,
  max: mean,
});

function dashboard(overrides: Partial<AdminResultsData> = {}): AdminResultsData {
  return {
    options: { include_playtest: false, runs: "first", campaign: null },
    aggregates: {
      runs: 4,
      fresh_runs: 3,
      spiral_runs: 1,
      overall: stats(0.62),
      grades: { S: 0, A: 1, B: 2, C: 1, D: 0, E: 0 },
      pillars: {
        pipeline_health: stats(0.6),
        stakeholder_relations: stats(0.5),
        intel_accuracy: stats(0.4),
        decision_quality: stats(0.7),
      },
      outcomes: { PASS: 9, SOFT_PASS: 4, VETO: 3, unfinished: 1 },
      hardest_challenges: [{ name: "The Platform Choice", played: 4, vetoes: 3, soft_passes: 0, veto_rate: 0.75 }],
      challenges: [],
      intel: {
        accuracy: stats(0.8),
        coverage: stats(0.5),
        coverage_by_stakeholder: { data_dave: stats(0.9), reliability_ruth: stats(0.2) },
      },
      knowledge: {
        intro_percent: stats(40),
        latest_outro_percent: stats(70),
        delta: stats(2),
        delta_percent: stats(28.6),
        outro_percent_by_run: { "1": stats(70) },
      },
      metrics: {},
    },
    intel_items: {
      most_gathered: [
        { id: "r1", stakeholder: "Data Dave", challenge: "Intro", text: "Dave wants a schema", gathered: 4, dealt: 4, rate: 1 },
      ],
      least_gathered: [
        { id: "r9", stakeholder: "Reliability Ruth", challenge: "Intro", text: "Ruth wants rollback", gathered: 0, dealt: 4, rate: 0 },
      ],
    },
    players: [
      {
        name: "alice",
        campaign_key: "camp-1",
        playtest_tainted: false,
        runs: [
          { run_index: 1, grade: "B", overall: 0.6, is_spiral: false },
          { run_index: 2, grade: "A", overall: 0.75, is_spiral: true },
        ],
      },
      { name: "bob", campaign_key: "camp-1", playtest_tainted: true, runs: [{ run_index: 1, grade: "E", overall: 0.2, is_spiral: false }] },
    ],
    excluded_playtest_accounts: 0,
    unreadable_runs: 0,
    ...overrides,
  };
}

const playerResults = (run = 1): AdminPlayerResults => ({
  player: "alice",
  playtest_tainted: false,
  runs: [1, 2],
  run_index: run,
  results: structuredClone((fixtures as unknown as Record<string, ResultsPayload>).C),
});

const CAMPAIGNS = [{ name: "Camp One", key: "camp-1" }];

function renderPage() {
  return render(<AdminResults adminToken="tok" campaigns={CAMPAIGNS} />);
}

beforeEach(() => {
  mockedResults.mockReset();
  mockedPlayer.mockReset();
  mockedResults.mockResolvedValue(dashboard());
  mockedPlayer.mockResolvedValue(playerResults());
});

describe("AdminResults", () => {
  it("loads with the study-safe defaults: first runs only, playtest accounts out", async () => {
    renderPage();

    await waitFor(() => expect(mockedResults).toHaveBeenCalled());
    expect(mockedResults).toHaveBeenLastCalledWith("tok", { campaign: "all", runs: "first", includePlaytest: false });
    expect(screen.getByRole("button", { name: "First runs only" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: /Include playtest accounts/ })).not.toBeChecked();
  });

  it("shows the headline numbers, the grades and the pillars", async () => {
    renderPage();

    expect(await screen.findByText("Finished runs")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("Grade B")).toBeInTheDocument();
    for (const pillar of ["Pipeline health", "Stakeholder relations", "Intel accuracy", "Decision quality"]) {
      expect(screen.getByText(pillar)).toBeInTheDocument();
    }
  });

  it("names the most vetoed challenge and the intel players tend to miss", async () => {
    renderPage();

    expect(await screen.findByText("The Platform Choice")).toBeInTheDocument();
    expect(screen.getByText("Ruth wants rollback")).toBeInTheDocument();
    expect(screen.getByText(/found in 0 of 4/)).toBeInTheDocument();
  });

  it("refetches when the runs, playtest or campaign filter changes", async () => {
    renderPage();
    await screen.findByText("Finished runs");

    await userEvent.click(screen.getByRole("button", { name: "All runs" }));
    await waitFor(() => expect(mockedResults).toHaveBeenLastCalledWith("tok", { campaign: "all", runs: "all", includePlaytest: false }));

    await userEvent.click(screen.getByRole("checkbox", { name: /Include playtest accounts/ }));
    await waitFor(() => expect(mockedResults).toHaveBeenLastCalledWith("tok", { campaign: "all", runs: "all", includePlaytest: true }));

    await userEvent.selectOptions(screen.getByRole("combobox"), "camp-1");
    await waitFor(() => expect(mockedResults).toHaveBeenLastCalledWith("tok", { campaign: "camp-1", runs: "all", includePlaytest: true }));
  });

  it("says how many playtest accounts were left out, rather than showing a smaller n unexplained", async () => {
    mockedResults.mockResolvedValue(dashboard({ excluded_playtest_accounts: 2 }));
    renderPage();

    expect(await screen.findByText(/2 playtest accounts left/)).toBeInTheDocument();
  });

  it("does not show that note once the playtest accounts are included", async () => {
    mockedResults.mockResolvedValue(dashboard({ excluded_playtest_accounts: 0 }));
    renderPage();
    await screen.findByText("Finished runs");

    expect(screen.queryByText(/playtest account.* left/)).not.toBeInTheDocument();
  });

  it("warns when runs could not be read, so a missing run is never silent", async () => {
    mockedResults.mockResolvedValue(dashboard({ unreadable_runs: 1 }));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("1 run could not be read");
  });

  it("explains an empty campaign instead of showing a page of zeros", async () => {
    const empty = dashboard({ players: [] });
    empty.aggregates = { ...empty.aggregates, runs: 0 };
    mockedResults.mockResolvedValue(empty);
    renderPage();

    expect(await screen.findByText(/No finished games yet/)).toBeInTheDocument();
    expect(screen.queryByText("Finished runs")).not.toBeInTheDocument();
  });

  it("shows a fetch failure as an alert", async () => {
    mockedResults.mockRejectedValue(new Error("Unauthorized admin access"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized admin access");
  });

  it("shows n/a for a measurement that does not exist, not a zero", async () => {
    const unmeasured = dashboard();
    unmeasured.aggregates.knowledge.delta_percent = stats(null, 0);
    unmeasured.aggregates.knowledge.delta = stats(null, 0);
    mockedResults.mockResolvedValue(unmeasured);
    renderPage();

    const tile = (await screen.findByText("Knowledge change")).closest("div") as HTMLElement;
    expect(within(tile).getByText("n/a")).toBeInTheDocument();
  });

  it("flags a playtest account in the player list", async () => {
    renderPage();
    await screen.findByText("Players");

    const bob = screen.getByText("bob").closest("tr") as HTMLElement;
    expect(within(bob).getByText("Playtest")).toBeInTheDocument();
    const alice = screen.getByText("alice").closest("tr") as HTMLElement;
    expect(within(alice).queryByText("Playtest")).not.toBeInTheDocument();
  });

  it("offers every finished run of a player, replays included", async () => {
    renderPage();
    await screen.findByText("Players");

    expect(screen.getByRole("button", { name: /Run 1: B/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run 2: A/ })).toBeInTheDocument();
  });

  it("opens exactly what the player saw when a run is picked", async () => {
    renderPage();
    await screen.findByText("Players");

    await userEvent.click(screen.getByRole("button", { name: /Run 2: A/ }));

    await waitFor(() => expect(mockedPlayer).toHaveBeenCalledWith("tok", "alice", 2));
    expect(await screen.findByText("alice, run 1")).toBeInTheDocument();
    // The same hero and tabs the player had.
    expect(screen.getByRole("region", { name: "Run summary" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Run details" })).toBeInTheDocument();
  });

  it("shows a failed drill-down without losing the page", async () => {
    mockedPlayer.mockRejectedValue(new Error("'alice' has not finished run 2"));
    renderPage();
    await screen.findByText("Players");

    await userEvent.click(screen.getByRole("button", { name: /Run 2: A/ }));

    expect(await screen.findByText(/has not finished run 2/)).toBeInTheDocument();
    expect(screen.getByText("Finished runs")).toBeInTheDocument();
  });
});
