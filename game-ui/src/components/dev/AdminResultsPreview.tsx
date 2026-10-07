import AdminResults from "../Results/AdminResults";
import type { AdminResultsData, Stats } from "../Results/adminTypes";
import type { ResultsPayload } from "../Results/types";
import fixtures from "./resultsFixtures.json";

/**
 * Harness for the admin Results page, at `?dev=admin-results` in a dev build (see main.tsx).
 *
 * Stubs the two admin endpoints with fixture data so the page can be judged without a running
 * campaign of finished players. Only the network is faked: everything rendered is the real
 * component, including the drill-down, which shows a player's actual hero and tabs.
 */
const stats = (mean: number, n = 12): Stats => ({
  n, mean, median: mean, stdev: 0.14, min: Math.max(0, mean - 0.3), max: Math.min(1, mean + 0.25),
});

const DASHBOARD: AdminResultsData = {
  options: { include_playtest: false, runs: "first", campaign: null },
  aggregates: {
    runs: 12,
    fresh_runs: 9,
    spiral_runs: 3,
    overall: stats(0.58),
    grades: { S: 0, A: 2, B: 5, C: 3, D: 1, E: 1 },
    pillars: {
      pipeline_health: stats(0.55),
      stakeholder_relations: stats(0.61),
      intel_accuracy: stats(0.48),
      decision_quality: stats(0.66),
    },
    outcomes: { PASS: 34, SOFT_PASS: 15, VETO: 9, STALEMATE: 1, unfinished: 2 },
    hardest_challenges: [
      { name: "The Platform Choice", played: 12, vetoes: 5, soft_passes: 3, veto_rate: 0.4167 },
      { name: "Subject-Matter Expert Resistance", played: 11, vetoes: 3, soft_passes: 4, veto_rate: 0.2727 },
    ],
    challenges: [],
    intel: {
      accuracy: stats(0.74),
      coverage: stats(0.52),
      coverage_by_stakeholder: {
        data_dave: stats(0.82), model_monica: stats(0.7), requirements_reuben: stats(0.61),
        efficiency_emilia: stats(0.55), automation_alex: stats(0.4), reliability_ruth: stats(0.22),
      },
    },
    knowledge: {
      intro_percent: stats(41), latest_outro_percent: stats(69), delta: stats(2), delta_percent: stats(27.8),
      outro_percent_by_run: { "1": stats(66, 12), "2": stats(78, 3) },
    },
    metrics: {},
    metric_series: {
      model: [stats(0.2, 12), stats(0.35, 11), stats(0.5, 8)],
      automation: [stats(0.15, 12), stats(0.3, 11), stats(0.45, 8)],
    },
    mood_series: {
      data_dave: [stats(0.5, 12), stats(0.6, 11), stats(0.7, 8)],
      reliability_ruth: [stats(0.4, 12), stats(0.35, 11), stats(0.3, 8)],
    },
  },
  metric_info: {
    model: { name: "Model", metric_color: "#3b82f6", metric_icon: "ph:brain-duotone" },
    automation: { name: "Automation", metric_color: "#f97316", metric_icon: "ph:gear-six-duotone" },
  },
  stakeholder_order: ["data_dave", "model_monica", "requirements_reuben", "efficiency_emilia", "automation_alex", "reliability_ruth"],
  stakeholders: {
    data_dave: "Data Dave", model_monica: "Model Monica", requirements_reuben: "Requirements Reuben",
    efficiency_emilia: "Efficiency Emilia", automation_alex: "Automation Alex", reliability_ruth: "Reliability Ruth",
  },
  intel_items: {
    most_gathered: [
      { id: "a", stakeholder: "Data Dave", challenge: "The Introduction", text: "Dave wants every batch validated before it is stored.", gathered: 12, dealt: 12, rate: 1 },
      { id: "b", stakeholder: "Model Monica", challenge: "The Introduction", text: "Monica will not ship a simpler model.", gathered: 11, dealt: 12, rate: 0.9167 },
    ],
    least_gathered: [
      { id: "c", stakeholder: "Reliability Ruth", challenge: "The Automation Deadline", text: "Ruth needs a rollback path before anything auto-deploys.", gathered: 1, dealt: 11, rate: 0.0909 },
      { id: "d", stakeholder: "Automation Alex", challenge: "The Platform Choice", text: "Alex could live with a manual promotion step for now.", gathered: 2, dealt: 12, rate: 0.1667 },
    ],
  },
  players: [
    { name: "alice", campaign_key: "spring-cohort", playtest_tainted: false, runs: [
      { run_index: 1, grade: "B", overall: 0.61, is_spiral: false }, { run_index: 2, grade: "A", overall: 0.76, is_spiral: true } ] },
    { name: "bruno", campaign_key: "spring-cohort", playtest_tainted: false, runs: [{ run_index: 1, grade: "C", overall: 0.49, is_spiral: false }] },
    { name: "playtest-bot", campaign_key: "spring-cohort", playtest_tainted: true, runs: [{ run_index: 1, grade: "S", overall: 0.93, is_spiral: false }] },
  ],
  excluded_playtest_accounts: 1,
  unreadable_runs: 0,
};

const originalFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("/api/admin/results/player/")) {
    const run = Number(new URL(url).searchParams.get("run") ?? 1);
    const grade = run === 2 ? "E" : "C";
    return json({
      player: "alice", playtest_tainted: false, runs: [1, 2], run_index: run,
      results: (fixtures as unknown as Record<string, ResultsPayload>)[grade],
    });
  }
  if (url.includes("/api/admin/results")) return json(DASHBOARD);
  return originalFetch(input, init);
}) as typeof window.fetch;

export default function AdminResultsPreview() {
  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem 1rem", background: "#f1f5f9" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", background: "#ffffff", padding: "1.5rem", borderRadius: "1rem" }}>
        <AdminResults adminToken="preview" campaigns={[{ name: "Spring cohort", key: "spring-cohort" }]} />
      </div>
    </div>
  );
}
