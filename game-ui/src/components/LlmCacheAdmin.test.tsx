import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LlmCacheAdmin, { formatRate } from "./LlmCacheAdmin";
import * as adminApi from "../services/api/admin";

const stats: adminApi.LlmCacheStats = {
  enabled: true,
  version: "abc123",
  maxsize: 1000,
  caches: [
    { name: "veto", label: "Action card veto", entries: 2, hits: 1, misses: 2, hit_rate: 1 / 3 },
    { name: "action_card", label: "Action card generation", entries: 0, hits: 0, misses: 0, hit_rate: null },
  ],
  total_entries: 2,
  total_hits: 1,
  total_requests: 3,
  total_hit_rate: 1 / 3,
};

describe("LlmCacheAdmin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("formats a missing hit rate as a dash", () => {
    expect(formatRate(null)).toBe("-");
    expect(formatRate(0.5)).toBe("50.0%");
  });

  it("lists every cache with its entries and hit rate", async () => {
    vi.spyOn(adminApi, "fetchLlmCacheStats").mockResolvedValue(stats);

    render(<LlmCacheAdmin />);

    await waitFor(() => expect(screen.getByText("Action card veto")).toBeTruthy());
    expect(screen.getByText("33.3%")).toBeTruthy();
    expect(screen.getByText("Action card generation")).toBeTruthy();
    expect(screen.getByText(/2 cached prompts/)).toBeTruthy();
    expect(screen.getByText(/build abc123/)).toBeTruthy();
  });

  it("says so when caching is switched off", async () => {
    vi.spyOn(adminApi, "fetchLlmCacheStats").mockResolvedValue({ ...stats, enabled: false });

    render(<LlmCacheAdmin />);

    await waitFor(() => expect(screen.getByText(/switched off/)).toBeTruthy());
  });

  it("shows the error when the request fails", async () => {
    vi.spyOn(adminApi, "fetchLlmCacheStats").mockRejectedValue(new Error("nope"));

    render(<LlmCacheAdmin />);

    await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
  });
});
