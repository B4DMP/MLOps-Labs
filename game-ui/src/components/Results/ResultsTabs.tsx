import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import DecisionsTab from "./tabs/DecisionsTab";
import IntelTab from "./tabs/IntelTab";
import KnowledgeTab from "./tabs/KnowledgeTab";
import MetricsTab, { type MetricInfo } from "./tabs/MetricsTab";
import PipelineTab from "./tabs/PipelineTab";
import StakeholdersTab from "./tabs/StakeholdersTab";
import TimelineTab from "./tabs/TimelineTab";
import type { ResultsPayload } from "./types";
import styles from "./ResultsTabs.module.css";

type TabId = "intel" | "stakeholders" | "decisions" | "pipeline" | "metrics" | "knowledge" | "timeline";

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: "intel", label: "Intel", icon: "ph:magnifying-glass-bold" },
  { id: "stakeholders", label: "Stakeholders", icon: "ph:users-three-bold" },
  { id: "decisions", label: "Decisions", icon: "ph:gavel-bold" },
  { id: "pipeline", label: "Pipeline", icon: "ph:heartbeat-bold" },
  { id: "metrics", label: "Metrics", icon: "ph:chart-line-up-bold" },
  { id: "knowledge", label: "Knowledge", icon: "ph:graduation-cap-bold" },
  { id: "timeline", label: "Timeline", icon: "ph:clock-counter-clockwise-bold" },
];

/** A campaign with the questionnaire off never measured the player, so there is nothing for this
 * tab to say: leave it out rather than show an empty panel. */
function hasKnowledge(results: ResultsPayload): boolean {
  return (
    results.knowledge.intro.correct !== null &&
    results.knowledge.outro_per_run.some((run) => run.correct !== null)
  );
}

export type ResultsTabId = TabId;

export interface ResultsTabsProps {
  results: ResultsPayload;
  metricInfo: Record<string, MetricInfo>;
  /** Which tab opens first. Defaults to Intel; the dev harness and tests use it to land on one. */
  initialTab?: TabId;
}

/**
 * The detail behind the hero: one tab per section, all read off the same payload.
 *
 * A proper tablist (arrow keys move between tabs, Home and End jump to the ends) rather than a row
 * of buttons, since a screen this dense is exactly where keyboard and screen reader users need the
 * structure spelled out.
 */
export default function ResultsTabs({ results, metricInfo, initialTab = "intel" }: ResultsTabsProps) {
  const tabs = useMemo(
    () => TABS.filter((tab) => tab.id !== "knowledge" || hasKnowledge(results)),
    [results],
  );
  const [active, setActive] = useState<TabId>(initialTab);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (event: KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(tabs[next].id);
    buttons.current[tabs[next].id]?.focus();
  };

  const current = tabs.some((t) => t.id === active) ? active : tabs[0].id;

  return (
    <div className={styles.wrap}>
      <div className={styles.tabList} role="tablist" aria-label="Run details">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              buttons.current[tab.id] = el;
            }}
            id={`results-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={current === tab.id}
            aria-controls={`results-panel-${tab.id}`}
            tabIndex={current === tab.id ? 0 : -1}
            className={`${styles.tab} ${current === tab.id ? styles.tabActive : ""}`}
            onClick={() => setActive(tab.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <Icon icon={tab.icon} aria-hidden />
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={`results-panel-${current}`}
        role="tabpanel"
        aria-labelledby={`results-tab-${current}`}
        className={styles.panel}
      >
        {current === "intel" && <IntelTab results={results} />}
        {current === "stakeholders" && <StakeholdersTab results={results} />}
        {current === "decisions" && <DecisionsTab results={results} />}
        {current === "pipeline" && <PipelineTab results={results} />}
        {current === "metrics" && <MetricsTab results={results} metricInfo={metricInfo} />}
        {current === "knowledge" && <KnowledgeTab results={results} />}
        {current === "timeline" && <TimelineTab results={results} />}
      </div>
    </div>
  );
}
