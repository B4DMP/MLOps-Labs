/**
 * The admin Results page payloads, mirroring `results_service/aggregate.py` and
 * `services/admin_results.py`.
 */

import type { GradeLetter, PillarId, ResultsPayload } from "./types";

/** Mean, spread and range of the readings that exist. `stdev` is null below two readings, since
 * one reading has no spread and zero would claim everyone played identically. */
export interface Stats {
  n: number;
  mean: number | null;
  median: number | null;
  stdev: number | null;
  min: number | null;
  max: number | null;
}

export interface ChallengeDifficulty {
  name: string;
  played: number;
  vetoes: number;
  soft_passes: number;
  veto_rate: number;
}

export interface IntelItemRate {
  id: string;
  stakeholder: string;
  challenge: string;
  text: string;
  gathered: number;
  dealt: number;
  rate: number;
}

export interface AdminAggregates {
  runs: number;
  fresh_runs: number;
  spiral_runs: number;
  overall: Stats;
  grades: Record<GradeLetter, number>;
  pillars: Record<PillarId, Stats>;
  outcomes: { PASS: number; SOFT_PASS: number; VETO: number; unfinished: number };
  hardest_challenges: ChallengeDifficulty[];
  challenges: ChallengeDifficulty[];
  intel: {
    accuracy: Stats;
    coverage: Stats;
    coverage_by_stakeholder: Record<string, Stats>;
  };
  knowledge: {
    intro_percent: Stats;
    latest_outro_percent: Stats;
    delta: Stats;
    delta_percent: Stats;
    outro_percent_by_run: Record<string, Stats>;
  };
  metrics: Record<string, Stats>;
}

export interface AdminPlayerRun {
  run_index: number;
  grade: GradeLetter;
  overall: number;
  is_spiral: boolean;
}

export interface AdminResultsPlayer {
  name: string;
  campaign_key: string;
  playtest_tainted: boolean;
  runs: AdminPlayerRun[];
}

export interface AdminResultsData {
  options: { include_playtest: boolean; runs: "first" | "all"; campaign: string | null };
  aggregates: AdminAggregates;
  intel_items: { most_gathered: IntelItemRate[]; least_gathered: IntelItemRate[] };
  players: AdminResultsPlayer[];
  /** Accounts left out because they used a playtest tool, so a smaller n is never unexplained. */
  excluded_playtest_accounts: number;
  unreadable_runs: number;
}

export interface AdminPlayerResults {
  player: string;
  playtest_tainted: boolean;
  runs: number[];
  run_index: number;
  results: ResultsPayload;
}
