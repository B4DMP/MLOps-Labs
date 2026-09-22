import ResultsHero from "../Results/ResultsHero";
import ResultsTabs, { type ResultsTabId } from "../Results/ResultsTabs";
import type { MetricInfo } from "../Results/tabs/MetricsTab";
import type { ResultsPayload } from "../Results/types";
import fixtures from "./resultsFixtures.json";

/**
 * Harness for the results screen, at `?dev=results` in a dev build (see main.tsx).
 *
 * `?grade=S|C|E` picks a fixture (E is a next-iteration run) and `?width=NNN` sets the hero's
 * container width, so the card can be judged at the sizes it will actually be screenshotted at.
 * `?tab=intel|stakeholders|decisions|pipeline|metrics|knowledge|timeline` opens on that tab.
 *
 * The fixtures are generated from the real `EndgameEpilogue.json` prose rather than written by
 * hand, so the text lengths this lays out are the ones a player will really see.
 */
const METRIC_INFO: Record<string, MetricInfo> = {
  model: { name: "Model", metric_color: "#3b82f6", metric_icon: "lucide:brain-circuit" },
  automation: { name: "Automation", metric_color: "#f97316", metric_icon: "lucide:settings" },
  reliability: { name: "Reliability", metric_color: "#e11d48", metric_icon: "lucide:battery-full" },
  data: { name: "Data", metric_color: "#10b981", metric_icon: "lucide:database" },
  requirements: { name: "Requirements", metric_color: "#8b5cf6", metric_icon: "lucide:file-text" },
  efficiency: { name: "Efficiency", metric_color: "#06b6d4", metric_icon: "lucide:trending-up" },
};

export default function ResultsPreview() {
  const params = new URLSearchParams(window.location.search);
  const key = params.get("grade") ?? "C";
  const width = Number(params.get("width")) || 1100;
  const results = (fixtures as unknown as Record<string, ResultsPayload>)[key] ?? fixtures.C;

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem 1rem", background: "#0b1220" }}>
      <div style={{ width: Math.min(width, 1100), maxWidth: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <ResultsHero results={results as ResultsPayload} playtest={params.get("playtest") === "1"} />
        <ResultsTabs
          results={results as ResultsPayload}
          metricInfo={METRIC_INFO}
          initialTab={(params.get("tab") as ResultsTabId | null) ?? "intel"}
        />
      </div>
    </div>
  );
}
