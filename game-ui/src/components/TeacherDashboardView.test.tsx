import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeacherDashboardView } from "./TeacherDashboardView";
import type { TeacherDashboardData, TeacherPlayerRow } from "../services/api/teacher";

const player = (overrides: Partial<TeacherPlayerRow>): TeacherPlayerRow => ({
  name: "ada", email: "ada@example.test", gameProgression: "Challenge 3", progressIndex: 2, phaseIndex: 1,
  challengeNumber: 3, introPercentage: 0, outroPercentage: 0, useQuestionnaire: false, playTime: "0d 0h 5m",
  playTimeMinutes: 5, campaign_name: "Spring", campaign_key: "spring", runs: 1, playtestTainted: false,
  lastActive: null, online: true, ...overrides,
});

const dataWith = (players: TeacherPlayerRow[]): TeacherDashboardData => ({
  type: "teacher_data_update", players, campaigns: [], total_player_amount: players.length,
  finished_player_amount: 0, online_player_amount: 1,
});

describe("TeacherDashboardView token reset", () => {
  it("offers the reset only to players in a challenge, and only with a handler", async () => {
    const fetchData = vi.fn().mockResolvedValue(
      dataWith([player({}), player({ name: "bo", email: "bo@example.test", progressIndex: 4 })]),
    );
    const { rerender } = render(<TeacherDashboardView fetchData={fetchData} pollMs={1e9} onResetTokens={vi.fn()} />);

    await screen.findByText("ada");
    expect(screen.getAllByRole("button", { name: /reset tokens/i })).toHaveLength(1);

    rerender(<TeacherDashboardView fetchData={fetchData} pollMs={1e9} />);
    expect(screen.queryByRole("button", { name: /reset tokens/i })).toBeNull();
  });

  it("asks for confirmation before resetting, then says it worked", async () => {
    const onResetTokens = vi.fn().mockResolvedValue(undefined);
    render(
      <TeacherDashboardView
        fetchData={vi.fn().mockResolvedValue(dataWith([player({})]))}
        pollMs={1e9}
        onResetTokens={onResetTokens}
      />,
    );
    await screen.findByText("ada");

    await userEvent.click(screen.getByRole("button", { name: /reset tokens/i }));
    expect(onResetTokens).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onResetTokens).toHaveBeenCalledWith("ada@example.test"));
    expect(await screen.findByText(/Tokens refilled for ada/)).toBeTruthy();
  });
});
