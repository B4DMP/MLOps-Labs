/**
 * Deployment Execution & Rollout Debrief (Simulation Phase).
 *
 * Implements the deterministic simulation report:
 * 1. Executive Rollout Banner: Clear communication of proposal outcome.
 * 2. Component Implementation Log: Details which components were implemented by whom,
 *    how successfully (Flawless, Capped by upstream, Degraded by owner pushback, or Delayed),
 *    and real-world narrative story fragments.
 * 3. Project Dimensions Shift: Qualitative shifts in the 6 MLOps metrics without raw numerical
 *    developer health stats.
 * 4. Human Realities: Stakeholder execution dynamics, emotional impacts, and future grudges.
 * 5. Environmental Ripple Effects & Architectural Patterns.
 */

import { useEffect, useState, useContext } from "react";
import { Icon } from "@iconify/react";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import ActionCardCardComponent from "./ActionCardCardComponent";
import { MetricsContext } from "./MetricProvider";
import { StakeholderContext } from "./StakeholderProvider";
import { PhasesContext } from "./PhaseProvider";
import type { ActionCard } from "../types/ActionCard";
import { useGameWebSocket, useWebSocketEvent } from "../services/websocket/useGameWebSocket";
import styles from "./ac_simulation.module.css";

const LEVEL_LABELS = ["broken", "absent", "manual", "automated", "governed"];
const LEVEL_CLASS = [
  styles.levelBroken,
  styles.levelAbsent,
  styles.levelManual,
  styles.levelAutomated,
  styles.levelGoverned,
];

interface LevelPair {
  before: number;
  after: number;
}

interface TargetDelta {
  id: string;
  name?: string;
  stage: string;
  nominal: LevelPair;
  effective: LevelPair;
  capped_by?: { id: string; level: number } | null;
  degraded_by?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  status?: "flawless" | "capped" | "delayed" | "degraded" | string;
  story?: string;
}

interface StakeholderExecutionDelta {
  stakeholder_id: string;
  name: string;
  power?: string;
  interest?: string;
  status: "committed" | "resistant" | "overridden" | string;
  delivery_sentiment?: string | null;
  emotion_deltas?: Record<string, number>;
  story?: string;
}

interface DeltaReport {
  outcome: string;
  targets: TargetDelta[];
  debt_created: Array<{ target_id?: string; owner_id?: string; intended?: number; applied?: number }>;
  debt_cleared: Array<{ target_id?: string; owner_id?: string }>;
  world_events: Array<{ target: string; before: number; after: number; reason?: string }>;
  propagated: Array<{ target: string; effective: LevelPair; via?: string | null }>;
  stage_health: Record<string, LevelPair>;
  system_health: LevelPair;
  patterns: { gained: string[]; lost: string[]; anti_created: string[]; anti_resolved: string[] };
  grudges: {
    created: Array<{ stakeholder_id: string; reason?: string }>;
    fired: Array<{ stakeholder_id: string; effect: string; detail?: string; target?: string | null }>;
  };
  metric_deltas: Record<string, number>;
  stakeholders?: StakeholderExecutionDelta[];
}

interface DeltaReportPayload {
  report: DeltaReport;
  next_challenge?: { id: number; phase_id: number; name: string; phase_name: string } | null;
}

interface AcSimulationProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  playedCard?: ActionCard | null;
}

const OUTCOME_CONFIG: Record<
  string,
  { label: string; badgeClass: string; icon: string; headline: string; description: string }
> = {
  PASS: {
    label: "Full Alignment",
    badgeClass: styles.outcomePass,
    icon: "ph:check-circle-bold",
    headline: "Proposal Approved & Deployed with Consensus",
    description:
      "The stakeholder room backed your action proposal. Implementation proceeds cleanly across designated components, with full organizational buy-in.",
  },
  SOFT_PASS: {
    label: "Soft Pass (Friction)",
    badgeClass: styles.outcomeSoftPass,
    icon: "ph:warning-circle-bold",
    headline: "Proposal Passed with Unresolved Friction",
    description:
      "The card passed, but low-power stakeholder resistance resulted in corner-cutting, partial implementation, or technical debt left behind in production.",
  },
  VETO_BROKEN: {
    label: "Overruled via Escalation",
    badgeClass: styles.outcomeVetoBroken,
    icon: "ph:lightning-bold",
    headline: "Executive Escalation Overrode Resistance",
    description:
      "You forced the proposal through over serious stakeholder objections. The changes are deployed, but alienated owners have degraded operational support on owned systems.",
  },
  STALEMATE: {
    label: "Stalemate",
    badgeClass: styles.outcomeStalemate,
    icon: "ph:x-circle-bold",
    headline: "Negotiations Stalled • Proposal Dropped",
    description:
      "Deadlock in the meeting prevented agreement. The proposal was not enacted, and external environmental shifts proceeded without intervention.",
  },
};

function formatLevel(level: number): string {
  return LEVEL_LABELS[level] ?? String(level);
}

export default function AcSimulation({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  playedCard,
}: AcSimulationProps) {
  const { emit } = useGameWebSocket();
  const { metrics } = useContext(MetricsContext);
  const { stakeholders } = useContext(StakeholderContext);
  const { phases } = useContext(PhasesContext);

  const [payload, setPayload] = useState<DeltaReportPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useWebSocketEvent<DeltaReportPayload>("graph:delta_report", (data) => setPayload(data));

  useEffect(() => {
    emit("simulation:run", { phase_id: currentPhase, challenge_id: currentChallenge });
  }, [emit, currentPhase, currentChallenge]);

  const handleContinueClick = () => {
    setLoading(true);
    onContinue();
  };

  const report = payload?.report;
  const outcomeInfo = report
    ? OUTCOME_CONFIG[report.outcome] || OUTCOME_CONFIG.PASS
    : OUTCOME_CONFIG.PASS;

  const displayPhaseNumber = currentPhase + 1;
  const totalPhases = phases?.length || 1;

  return (
    <div className={styles.pageWrapper}>
      {/* ── Top Header Strip ── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>
            <Icon icon="ph:rocket-launch-bold" className={styles.headerIcon} />
            <span>Deployment Execution & Rollout Debrief</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Engineering Rollout Log • Stakeholder Implementation & System Evolution
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className={styles.phaseBadge}>
            <Icon icon="ph:projector-screen-chart-bold" />
            Phase {displayPhaseNumber} of {totalPhases} • Milestone {currentChallenge + 1}
          </span>
        </div>
      </div>

      {/* ── Body Area ── */}
      <div className={styles.modalBody}>
        {/* Loading Indicator */}
        {!report && (
          <div className="card border-secondary shadow-sm p-4">
            <div className="d-flex align-items-center gap-3">
              <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
              <span className="fw-semibold text-muted">
                Executing deployment, resolving upstream bottlenecks, and logging stakeholder realities...
              </span>
            </div>
          </div>
        )}

        {report && (
          <>
            {/* 1. Executive Directive Banner */}
            <div className={styles.directiveBanner}>
              <div className={styles.directiveBannerHeader}>
                <div className={styles.directiveTitleArea}>
                  <Icon icon={outcomeInfo.icon} className={styles.directiveIcon} />
                  <span>{outcomeInfo.headline}</span>
                </div>
                <span className={`${styles.outcomeBadge} ${outcomeInfo.badgeClass}`}>
                  <Icon icon={outcomeInfo.icon} />
                  {outcomeInfo.label}
                </span>
              </div>
              <p className={styles.directiveText}>{outcomeInfo.description}</p>
            </div>

            {/* 2. Main Two-Column Layout */}
            <div className={styles.mainGrid}>
              {/* Left Column: Committed Proposal & Project Dimensions */}
              <div className={styles.leftCol}>
                {/* Committed Proposal Summary */}
                {playedCard && (
                  <div className={styles.surfaceCard}>
                    <div className={styles.cardHeader}>
                      <h3 className={styles.cardTitle}>
                        <Icon icon="ph:cards-bold" />
                        <span>Pitched Action Proposal</span>
                      </h3>
                    </div>
                    <div className={styles.cardBody}>
                      <ActionCardCardComponent
                        card={playedCard}
                        stakeholders={stakeholders as any}
                        isMinimized={true}
                        isInteractive={false}
                      />
                    </div>
                  </div>
                )}

                {/* Project Dimensions Shift (6 MLOps Metrics) */}
                <div className={styles.surfaceCard}>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>
                      <Icon icon="ph:compass-tool-bold" />
                      <span>Project Dimensions Shift</span>
                    </h3>
                    <span className="text-muted small">6 MLOps Metrics</span>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.metricsGrid}>
                      {Object.entries(metrics).map(([mId, mObj]) => {
                        const delta = report.metric_deltas[mId] || 0;
                        const deltaClass =
                          delta > 0
                            ? styles.metricUp
                            : delta < 0
                            ? styles.metricDown
                            : styles.metricNeutral;
                        return (
                          <div key={mId} className={styles.metricCard}>
                            <div className={styles.metricHeader}>
                              <span className={styles.metricName} title={mObj.name || mId}>
                                {mObj.name || mId}
                              </span>
                              <span className={`${styles.metricDelta} ${deltaClass}`}>
                                {delta > 0 ? `+${delta}` : delta === 0 ? "±0" : delta}
                              </span>
                            </div>
                            <span className={styles.metricValue}>
                              Current Level: {mObj.value ?? mObj.start_value}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Architectural Patterns & Technical Shortcuts */}
                <div className={styles.surfaceCard}>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>
                      <Icon icon="ph:tree-structure-bold" />
                      <span>Architecture & Technical Shortcuts</span>
                    </h3>
                  </div>
                  <div className={styles.cardBody}>
                    {/* Shortcuts / Debt Incurred */}
                    {report.debt_created.length > 0 && (
                      <div className={`${styles.alertNote} ${styles.alertWarning}`}>
                        <Icon icon="ph:warning-octagon-bold" style={{ fontSize: "1.1rem", flexShrink: 0 }} />
                        <div>
                          <strong>{report.debt_created.length} Technical Shortcut(s) Left Behind:</strong> Unfinished
                          handoffs and rushed compromises create latent friction in future phases.
                        </div>
                      </div>
                    )}
                    {report.debt_cleared.length > 0 && (
                      <div className={`${styles.alertNote} ${styles.alertSuccess}`}>
                        <Icon icon="ph:check-circle-bold" style={{ fontSize: "1.1rem", flexShrink: 0 }} />
                        <div>
                          <strong>{report.debt_cleared.length} Shortcut(s) Cleaned Up:</strong> Proper governance
                          resolved outstanding debt!
                        </div>
                      </div>
                    )}

                    {/* Patterns Gained / Cleared */}
                    <div className="d-flex flex-wrap gap-2 mt-1">
                      {report.patterns.gained.map((p) => (
                        <span key={p} className="badge bg-success text-light p-2 d-flex align-items-center gap-1">
                          <Icon icon="ph:sparkle-bold" />
                          Pattern: {p}
                        </span>
                      ))}
                      {report.patterns.anti_resolved.map((p) => (
                        <span key={p} className="badge bg-info text-dark p-2 d-flex align-items-center gap-1">
                          <Icon icon="ph:wrench-bold" />
                          Antipattern Cleared: {p}
                        </span>
                      ))}
                      {report.patterns.anti_created.map((p) => (
                        <span key={p} className="badge bg-danger text-light p-2 d-flex align-items-center gap-1">
                          <Icon icon="ph:bug-beetle-bold" />
                          Antipattern: {p}
                        </span>
                      ))}
                      {report.patterns.lost.map((p) => (
                        <span key={p} className="badge bg-warning text-dark p-2 d-flex align-items-center gap-1">
                          <Icon icon="ph:warning-bold" />
                          Pattern Lost: {p}
                        </span>
                      ))}
                      {Object.values(report.patterns).every((l) => l.length === 0) &&
                        report.debt_created.length === 0 &&
                        report.debt_cleared.length === 0 && (
                          <span className="text-muted small">
                            No architectural changes or technical shortcuts occurred this turn.
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Component Implementation Log & Human Sentiments */}
              <div className={styles.rightCol}>
                {/* ── Component Implementation Log (Core Focus) ── */}
                <div className={styles.surfaceCard}>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>
                      <Icon icon="ph:list-checks-bold" />
                      <span>Component Implementation Log</span>
                    </h3>
                    <span className="text-muted small">
                      {report.targets.length} Component{report.targets.length === 1 ? "" : "s"} Targeted
                    </span>
                  </div>
                  <div className={styles.cardBody}>
                    {report.targets.length === 0 ? (
                      <div className="text-muted p-3 text-center">
                        <Icon icon="ph:info-bold" className="fs-4 mb-2 d-block mx-auto text-secondary" />
                        No components were modified in the environment graph. If the proposal was dropped or no
                        changes were scheduled, the pipeline remains at its previous baseline.
                      </div>
                    ) : (
                      <div className={styles.rolloutList}>
                        {report.targets.map((target) => {
                          const ownerId = target.owner_id || "";
                          const stCtx = stakeholders[ownerId] || {};
                          const ownerName = target.owner_name || stCtx.name || ownerId || "System Lead";
                          const ownerRole = stCtx.role_description || "Component Owner";

                          const isCapped = target.status === "capped" || (target.capped_by && target.nominal.after !== target.effective.after);
                          const isDegraded = target.status === "degraded" || Boolean(target.degraded_by);
                          const isDelayed = target.status === "delayed";

                          let statusCalloutClass = styles.statusFlawless;
                          let statusIcon = "ph:check-circle-bold";
                          let statusTitle = "Flawless Implementation";
                          let statusDescription =
                            "Successfully delivered at target maturity with full stakeholder support and zero friction.";

                          if (isDegraded) {
                            statusCalloutClass = styles.statusDegraded;
                            statusIcon = "ph:hand-palm-bold";
                            statusTitle = `Degraded Rollout • Owner Pushback (${target.degraded_by || ownerName})`;
                            statusDescription =
                              "The responsible stakeholder resisted execution, taking shortcuts or reducing effective operational quality.";
                          } else if (isCapped) {
                            statusCalloutClass = styles.statusCapped;
                            statusIcon = "ph:lock-key-bold";
                            statusTitle = `Upstream Bottleneck Constraint (Capped by ${target.capped_by?.id || "predecessor"})`;
                            statusDescription = `Component reached nominal ${formatLevel(
                              target.nominal.after
                            )}, but operates throttled at ${formatLevel(
                              target.effective.after
                            )} because upstream dependencies lag behind.`;
                          } else if (isDelayed) {
                            statusCalloutClass = styles.statusDelayed;
                            statusIcon = "ph:clock-countdown-bold";
                            statusTitle = "Partial Delivery / Technical Shortcut Left Behind";
                            statusDescription =
                              "Component landed, but missing metadata, partial scripts, or handoff delays created technical debt.";
                          }

                          return (
                            <div key={target.id} className={styles.rolloutItem}>
                              {/* Header: Component Name, Stage, Level Transition */}
                              <div className={styles.rolloutItemHeader}>
                                <div className={styles.componentMeta}>
                                  <div className={styles.componentName}>
                                    <Icon icon="ph:cpu-bold" className="text-primary" />
                                    <span>{target.name || target.id}</span>
                                  </div>
                                  <div className={styles.componentTags}>
                                    <span className={styles.stageTag}>{target.stage}</span>
                                    <span className={styles.idTag}>{target.id}</span>
                                  </div>
                                </div>

                                <div className={styles.levelTransition}>
                                  <span className={`${styles.levelPip} ${LEVEL_CLASS[target.nominal.before] || ""}`}>
                                    {formatLevel(target.nominal.before)}
                                  </span>
                                  <Icon icon="ph:arrow-right-bold" className="text-muted" />
                                  <span className={`${styles.levelPip} ${LEVEL_CLASS[target.nominal.after] || ""}`}>
                                    {formatLevel(target.nominal.after)}
                                  </span>
                                </div>
                              </div>

                              {/* Responsible Stakeholder Row */}
                              <div className={styles.ownerRow}>
                                <div className={styles.ownerAvatarWrap}>
                                  <StakeholderAvatarComponent
                                    avatar={stCtx.avatar}
                                    stakeholderId={ownerId}
                                    stakeholderColor={stCtx.stakeholder_color}
                                    size="100%"
                                  />
                                </div>
                                <div className={styles.ownerInfo}>
                                  <div className={styles.ownerName}>
                                    <span>{ownerName}</span>
                                    {stCtx.power && (
                                      <span className="badge bg-light text-dark border px-2 py-0" style={{ fontSize: "0.68rem" }}>
                                        {stCtx.power} power
                                      </span>
                                    )}
                                  </div>
                                  <span className={styles.ownerRole}>{ownerRole}</span>
                                </div>
                              </div>

                              {/* Implementation Status Callout */}
                              <div className={`${styles.statusCallout} ${statusCalloutClass}`}>
                                <Icon icon={statusIcon} style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                                <div>
                                  <strong>{statusTitle}: </strong>
                                  <span>{statusDescription}</span>
                                </div>
                              </div>

                              {/* Narrative Story Fragment */}
                              {target.story && (
                                <div className={styles.rolloutStory}>
                                  "{target.story}"
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Stakeholder Sentiments & Human Realities ── */}
                <div className={styles.surfaceCard}>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>
                      <Icon icon="ph:users-three-bold" />
                      <span>Stakeholder Realities & Social Alignment</span>
                    </h3>
                    <span className="text-muted small">Human Reactions</span>
                  </div>
                  <div className={styles.cardBody}>
                    {(!report.stakeholders || report.stakeholders.length === 0) ? (
                      <p className="text-muted small mb-0">No stakeholder friction recorded this cycle.</p>
                    ) : (
                      <div className={styles.stakeholderGrid}>
                        {report.stakeholders.map((st) => {
                          const stCtx = stakeholders[st.stakeholder_id] || {};
                          const stName = st.name || stCtx.name || st.stakeholder_id;
                          const stRole = stCtx.role_description || `${st.power || "low"} power`;

                          const statusBadgeClass =
                            st.status === "committed"
                              ? styles.outcomePass
                              : st.status === "resistant"
                              ? styles.outcomeSoftPass
                              : styles.outcomeVetoBroken;

                          const statusLabel =
                            st.status === "committed"
                              ? "🟢 Committed"
                              : st.status === "resistant"
                              ? "🟡 Resistant (Friction)"
                              : "🔴 Overruled (Escalation)";

                          return (
                            <div key={st.stakeholder_id} className={styles.stakeholderCard}>
                              <div className="d-flex align-items-center gap-2">
                                <div style={{ width: 36, height: 36, flexShrink: 0 }}>
                                  <StakeholderAvatarComponent
                                    avatar={stCtx.avatar}
                                    stakeholderId={st.stakeholder_id}
                                    stakeholderColor={stCtx.stakeholder_color}
                                    size="100%"
                                  />
                                </div>
                                <div className="d-flex flex-column min-width-0 flex-grow-1">
                                  <strong className="text-truncate" style={{ fontSize: "0.82rem" }}>
                                    {stName}
                                  </strong>
                                  <span className="text-muted text-truncate" style={{ fontSize: "0.7rem" }}>
                                    {stRole}
                                  </span>
                                </div>
                              </div>

                              <div className="d-flex align-items-center justify-content-between">
                                <span className={`${styles.outcomeBadge} ${statusBadgeClass}`} style={{ fontSize: "0.7rem" }}>
                                  {statusLabel}
                                </span>
                              </div>

                              {st.emotion_deltas && Object.keys(st.emotion_deltas).length > 0 && (
                                <div className={styles.emotionPills}>
                                  {Object.entries(st.emotion_deltas).map(([dim, val]) => (
                                    <span
                                      key={dim}
                                      className={`${styles.emotionPill} ${
                                        val >= 0 ? styles.emotionPositive : styles.emotionNegative
                                      }`}
                                    >
                                      {dim}: {val > 0 ? `+${val}` : val}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {st.story && (
                                <div className="text-muted small" style={{ fontSize: "0.74rem", fontStyle: "italic" }}>
                                  "{st.story}"
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Grudges Alert */}
                    {report.grudges.created.length > 0 && (
                      <div className={`${styles.alertNote} ${styles.alertWarning} mt-2`}>
                        <Icon icon="ph:bookmark-simple-bold" style={{ fontSize: "1.1rem", flexShrink: 0 }} />
                        <div>
                          <strong>Grudge Recorded:</strong>{" "}
                          {report.grudges.created.map((g) => g.stakeholder_id).join(", ")} will remember this
                          compromise and bring heightened skepticism into future debates.
                        </div>
                      </div>
                    )}
                    {report.grudges.fired.length > 0 && (
                      <div className={`${styles.alertNote} ${styles.alertInfo} mt-1`}>
                        <Icon icon="ph:clock-countdown-bold" style={{ fontSize: "1.1rem", flexShrink: 0 }} />
                        <div>
                          <strong>Prior Grudge Triggered:</strong>{" "}
                          {report.grudges.fired.map((g) => `${g.stakeholder_id} (${g.detail || g.effect})`).join(", ")}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Environmental Events & Ripple Effects ── */}
                {(report.world_events.length > 0 || report.propagated.length > 0) && (
                  <div className={styles.surfaceCard}>
                    <div className={styles.cardHeader}>
                      <h3 className={styles.cardTitle}>
                        <Icon icon="ph:globe-hemisphere-east-bold" />
                        <span>Environmental Events & Ripple Effects</span>
                      </h3>
                    </div>
                    <div className={styles.cardBody}>
                      {report.world_events.length > 0 && (
                        <div>
                          <span className="small fw-bold text-muted d-block mb-1">External Incidents</span>
                          <ul className="list-group list-group-flush small">
                            {report.world_events.map((e, i) => (
                              <li key={`${e.target}-${i}`} className="list-group-item px-0 py-1 bg-transparent">
                                <strong>{e.target}</strong> moved from {formatLevel(e.before)} to {formatLevel(e.after)}
                                {e.reason && <span className="text-muted"> ({e.reason})</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {report.propagated.length > 0 && (
                        <div className="mt-2">
                          <span className="small fw-bold text-muted d-block mb-1">Downstream Ripple Flow</span>
                          <ul className="list-group list-group-flush small">
                            {report.propagated.map((p) => (
                              <li key={p.target} className="list-group-item px-0 py-1 bg-transparent text-muted">
                                <Icon icon="ph:flow-arrow-bold" className="me-1 text-primary" />
                                <strong>{p.target}</strong> adapted from {formatLevel(p.effective.before)} to{" "}
                                {formatLevel(p.effective.after)}
                                {p.via && ` (via upstream link ${p.via})`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Footer Strip ── */}
      <div className={styles.footer}>
        <div className={styles.footerHint}>
          <Icon icon="ph:info-bold" />
          <span>
            {payload?.next_challenge
              ? `Next Milestone: ${payload.next_challenge.phase_name || "Next Phase"} • ${payload.next_challenge.name}`
              : "Ready to proceed to the next milestone."}
          </span>
        </div>
        <div className={styles.actions}>
          <button
            onClick={handleContinueClick}
            disabled={loading || !report}
            className={styles.actionButton}
          >
            <span>{loading ? "Advancing..." : "Proceed to Next Milestone"}</span>
            <Icon icon="ph:arrow-right-bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
