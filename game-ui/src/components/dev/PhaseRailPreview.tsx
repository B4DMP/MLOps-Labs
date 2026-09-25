import { useState } from "react";
import { Icon } from "@iconify/react";
import PhaseOverview from "../PhaseOverview";
import { PhasesContext, type PhaseData } from "../PhaseProvider";
import dash from "../PerformanceDashboard.module.css";
import brief from "../PrePhaseDialog.module.css";
import styles from "./PhaseRailPreview.module.css";

/**
 * Isolated harness for the lifecycle rail. Open `/?dev=phase-rail` in the running app.
 *
 * The rail lives in two headers and is sized relative to each of them, so bugs in it are
 * bugs about proportion and available width - neither of which can be seen in a unit test
 * (jsdom has no layout) or judged from one screenshot of one machine. This renders the real
 * component with the real stylesheets at several widths at once, so a change can be checked
 * against the narrow case and the wide case in the same glance.
 *
 * To reproduce a 125% browser font setting, use the browser's own zoom or font-size setting
 * while this page is open: everything here is sized the way the dialogs size it.
 */

const PHASES: PhaseData[] = [
  { id: 0, phase_name: "Introduction", phase_desc: "Introduction to the serious game mechanics and environment" },
  { id: 1, phase_name: "Requirement Engineering", phase_desc: "Business goal definition and stakeholder alignment" },
  { id: 2, phase_name: "Data Engineering", phase_desc: "Dataset preparation, addressing data quality, accessibility, and privacy" },
  { id: 3, phase_name: "Model Engineering", phase_desc: "Design, training, and evaluation of ML models" },
  { id: 4, phase_name: "Model Deployment", phase_desc: "Integration of models into production systems" },
  { id: 5, phase_name: "Monitoring/ Usage", phase_desc: "Production monitoring and infrastructure management" },
];

const WIDTHS = [1400, 1100, 900, 700];

export default function PhaseRailPreview() {
  const [currentPhase, setCurrentPhase] = useState(1);
  const [phaseCount, setPhaseCount] = useState(PHASES.length);
  const [compact, setCompact] = useState(false);

  const phases = PHASES.slice(0, phaseCount);
  const value = {
    currentPhase: Math.min(currentPhase, phases.length - 1),
    setCurrentPhase: () => {},
    phases,
    setPhases: () => {},
  };

  return (
    <PhasesContext.Provider value={value}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <h1>Phase rail</h1>
          <p>
            The real component and the real stylesheets, at four container widths. Use browser
            zoom or a larger default font size to check the scaling cases.
          </p>

          <div className={styles.controls}>
            <label>
              Current phase
              <input
                type="range"
                min={0}
                max={phases.length - 1}
                value={value.currentPhase}
                onChange={(e) => setCurrentPhase(Number(e.target.value))}
              />
              <span>{phases[value.currentPhase]?.phase_name}</span>
            </label>

            <label>
              Phase count
              <input
                type="range"
                min={2}
                max={PHASES.length}
                value={phaseCount}
                onChange={(e) => setPhaseCount(Number(e.target.value))}
              />
              <span>{phaseCount}</span>
            </label>

            <label>
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
              />
              {" "}Compact (tiny) rail
            </label>
          </div>
        </header>

        {WIDTHS.map((w) => (
          <section key={w} className={styles.case}>
            <span className={styles.caseLabel}>{w}px</span>

            <div className={styles.frame} style={{ width: w }}>
              {/* Performance Dashboard header */}
              <div className={dash.header}>
                <h4 className={dash.headerTitle}>
                  <Icon icon="material-symbols:dashboard-rounded" style={{ fontSize: "1.45em", color: "#fff" }} />
                  <span>Performance Dashboard</span>
                </h4>
                <div className={dash.headerPhases}>
                  <PhaseOverview compact={compact} />
                </div>
                <button type="button" className="btn-close btn-close-white" aria-label="Close" />
              </div>
            </div>

            <div className={styles.frame} style={{ width: w }}>
              {/* Phase Briefing header */}
              <div className={brief.header}>
                <div className={brief.headerTitleGroup}>
                  <h1 className={brief.headerTitle}>
                    <Icon icon="ph:projector-screen-chart-bold" className={brief.headerIcon} />
                    <span>Phase Briefing</span>
                  </h1>
                  <p className={brief.headerSubtitle}>Project Milestone Overview</p>
                </div>
                <div className={brief.headerPhases}>
                  <PhaseOverview compact={compact} />
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className={brief.phaseBadge}>Phase 1 of 5</span>
                  <button type="button" className="btn-close btn-close-white" aria-label="Close" />
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </PhasesContext.Provider>
  );
}
