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
import PhaseOverview from "./PhaseOverview";
import GlossaryText from "./glossary/GlossaryText";
import { MetricsContext } from "./MetricProvider";
import { StakeholderContext, type Stakeholder } from "./StakeholderProvider";
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
/** Same notch count as `MetricTab`'s header gauges - the two have to agree, since this card
 *  shows the same six metrics as the header, just before/after instead of only "now". */
const METRIC_SEGMENTS = 10;

function filledSegments(value: number, max: number): number {
  if (!max) return 0;
  const ratio = Math.max(0, Math.min(1, value / max));
  return Math.round(ratio * METRIC_SEGMENTS);
}

/** Emotion dimensions where a *drop* is the good outcome for the stakeholder (less stress, less
 *  perceived risk). Everything else defaults to "higher is better" - do not read the raw sign
 *  as good/bad without checking this first. */
const INVERTED_EMOTION_DIMENSIONS = new Set(["stress", "perceived_risk", "frustration", "fear", "anxiety"]);

function emotionIsGood(dim: string, value: number): boolean {
  const inverted = INVERTED_EMOTION_DIMENSIONS.has(dim.toLowerCase());
  return inverted ? value < 0 : value > 0;
}

function prettifyLabel(raw: string): string {
  const spaced = raw.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
  /** Opens the Performance Dashboard so the player can check the full project graph/metrics
   *  against this debrief without losing their place. */
  onPerformanceToggle?: () => void;
  isPerformanceOpen?: boolean;
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

/** "req.acceptance_criteria" -> "acceptance criteria". Same idiom used for component ids elsewhere. */
function formatComponentId(id: string): string {
  return id.split(".").pop()?.replace(/_/g, " ") || id;
}

/** Falls back to the raw id only when the stakeholder isn't in the roster (shouldn't normally happen). */
function stakeholderName(id: string, stakeholders: Record<string, Stakeholder>): string {
  return stakeholders[id]?.name || prettifyLabel(id);
}

export default function AcSimulation({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  playedCard,
  onPerformanceToggle,
  isPerformanceOpen = false,
}: AcSimulationProps) {
  const { emit } = useGameWebSocket();
  const { metrics } = useContext(MetricsContext);
  const { stakeholders } = useContext(StakeholderContext);

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

  // Same 10-notch scale MetricTab uses in the Performance Dashboard header - these are that
  // exact metric, not a separate "project health" abstraction, so this card has to look like
  // that gauge or it reads as a different system. "Changed" means the segment count moved,
  // which is the smallest step the bar can actually show.
  //
  // `metrics[id].value` is still the PRE-rollout value here: the backend only mutates and
  // broadcasts the live metric value later, via `game:state_update`, which fires from
  // `game:state_update_request` when the player clicks "Proceed to Next Milestone" - not from
  // `simulation:run`/`graph:delta_report`, which this screen renders immediately on mount. So
  // `mObj.value` is "before", and "after" is derived by applying the delta forward, not back.
  const metricShifts = Object.entries(metrics).map(([mId, mObj]) => {
    const delta = report?.metric_deltas[mId] || 0;
    const beforeVal = mObj.value ?? mObj.start_value;
    const afterVal = beforeVal + delta;
    const beforeFilled = filledSegments(beforeVal, mObj.max_value);
    const afterFilled = filledSegments(afterVal, mObj.max_value);
    return { mId, mObj, beforeVal, afterVal, beforeFilled, afterFilled };
  });
  const changedMetrics = report ? metricShifts.filter((m) => m.beforeFilled !== m.afterFilled) : [];
  const steadyMetrics = report ? metricShifts.filter((m) => m.beforeFilled === m.afterFilled) : [];
  const improvedCount = changedMetrics.filter((m) => m.afterFilled > m.beforeFilled).length;
  const declinedCount = changedMetrics.length - improvedCount;
  const shortcutCount = report?.debt_created.length || 0;
  const grudgeCount = report?.grudges.created.length || 0;

  return (
    <div className={styles.pageWrapper}>
      {/* ── Top Header Strip ── */}
      <div className={styles.header}>
        <div className={styles.headerTitleBlock}>
          <h1 className={styles.headerTitle}>
            <Icon icon="ph:rocket-launch-bold" className={styles.headerIcon} />
            <span>Deployment Execution & Rollout Debrief</span>
          </h1>
          <p className={styles.headerSubtitle}>
            Engineering Rollout Log • Stakeholder Implementation & System Evolution
          </p>
        </div>
        <div className={styles.headerPhases}>
          <PhaseOverview />
        </div>
        {onPerformanceToggle && (
          <button
            type="button"
            className={`${styles.dashboardLink} ${isPerformanceOpen ? styles.dashboardLinkActive : ""}`}
            onClick={onPerformanceToggle}
            title={isPerformanceOpen ? "Close performance dashboard" : "Open the full performance dashboard"}
          >
            <Icon icon="ph:gauge-bold" />
            <span>Performance</span>
          </button>
        )}
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
                  <span>{outcomeInfo.headline}</span>
                </div>
                <span className={`${styles.outcomeBadge} ${outcomeInfo.badgeClass}`}>
                  <Icon icon={outcomeInfo.icon} />
                  {outcomeInfo.label}
                </span>
              </div>
              <p className={styles.directiveText}>
                <GlossaryText text={outcomeInfo.description} surface="intel_notes" />
              </p>
            </div>

            {/* Pitched Action Proposal - the cause everything below is a consequence of */}
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

            {/* 2. Main Layout: narrative (what happened) reads before the abstract summary */}
            <div className={styles.mainGrid}>
              {/* Main Column: Component Implementation Log & Human Sentiments */}
              <div className={styles.mainCol}>
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
                      <div className={styles.emptyState}>
                        <Icon icon="ph:info-bold" />
                        <span>
                          No components were modified in the environment graph. If the proposal was dropped or no
                          changes were scheduled, the pipeline remains at its previous baseline.
                        </span>
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

                          const isFlawless = !isDegraded && !isCapped && !isDelayed;

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
                              {/* Header: component + owner on one line, level transition on the other side */}
                              <div className={styles.rolloutItemHeader}>
                                <div className={styles.componentMeta}>
                                  <div className={styles.componentName}>
                                    <Icon icon="ph:cpu-bold" className="text-primary" />
                                    <span>{target.name || formatComponentId(target.id)}</span>
                                  </div>
                                  <div className={styles.componentTags}>
                                    <span className={styles.stageTag}>{target.stage}</span>
                                    <span className={styles.ownerChip} title={ownerRole}>
                                      <StakeholderAvatarComponent
                                        avatar={stCtx.avatar}
                                        stakeholderId={ownerId}
                                        stakeholderColor={stCtx.stakeholder_color}
                                        size={16}
                                      />
                                      {ownerName}
                                      <Icon icon="ph:info-bold" className={styles.ownerRoleHint} />
                                    </span>
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

                              {isFlawless ? (
                                /* Nothing went wrong here - a quiet one-liner, not a full callout. */
                                <div className={styles.flawlessLine}>
                                  <Icon icon={statusIcon} />
                                  <span>{statusTitle} - full stakeholder support, zero friction.</span>
                                </div>
                              ) : (
                                <div className={styles.rolloutDetails}>
                                  <div className={`${styles.statusCallout} ${statusCalloutClass}`}>
                                    <Icon icon={statusIcon} style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                                    <div>
                                      <strong>{statusTitle}: </strong>
                                      <span>
                                        <GlossaryText text={statusDescription} surface="intel_notes" />
                                      </span>
                                    </div>
                                  </div>

                                  {target.story && (
                                    <div className={styles.rolloutStory}>
                                      "<GlossaryText text={target.story} surface="intel_notes" />"
                                    </div>
                                  )}
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
                      <div className={styles.emptyState}>
                        <Icon icon="ph:handshake-bold" />
                        <span>No stakeholder friction recorded this cycle.</span>
                      </div>
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
                              <div className="d-flex align-items-center gap-2" title={stRole}>
                                <div style={{ width: 36, height: 36, flexShrink: 0 }}>
                                  <StakeholderAvatarComponent
                                    avatar={stCtx.avatar}
                                    stakeholderId={st.stakeholder_id}
                                    stakeholderColor={stCtx.stakeholder_color}
                                    size="100%"
                                  />
                                </div>
                                <div className="d-flex flex-column min-width-0 flex-grow-1">
                                  <strong className="text-truncate d-flex align-items-center gap-1" style={{ fontSize: "0.82rem" }}>
                                    {stName}
                                    <Icon icon="ph:info-bold" className={styles.ownerRoleHint} />
                                  </strong>
                                </div>
                              </div>

                              <div className="d-flex align-items-center justify-content-between">
                                <span className={`${styles.outcomeBadge} ${statusBadgeClass}`} style={{ fontSize: "0.7rem" }}>
                                  {statusLabel}
                                </span>
                              </div>

                              {st.emotion_deltas && Object.keys(st.emotion_deltas).length > 0 && (
                                <div className={styles.emotionPills}>
                                  {Object.entries(st.emotion_deltas)
                                    .filter(([, val]) => val !== 0)
                                    .map(([dim, val]) => {
                                      const good = emotionIsGood(dim, val);
                                      const risingRaw = val > 0;
                                      return (
                                        <span
                                          key={dim}
                                          className={`${styles.emotionPill} ${
                                            good ? styles.emotionPositive : styles.emotionNegative
                                          }`}
                                          title={`${prettifyLabel(dim)} ${risingRaw ? "went up" : "went down"} this rollout`}
                                        >
                                          <Icon icon={risingRaw ? "ph:arrow-up-bold" : "ph:arrow-down-bold"} />
                                          {prettifyLabel(dim)}
                                        </span>
                                      );
                                    })}
                                </div>
                              )}

                              {st.story && (
                                <div className={styles.stakeholderStory}>
                                  "<GlossaryText text={st.story} surface="intel_notes" />"
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Grudges: severity follows the stakeholder's power - a high-power grudge is a
                        much bigger liability than a low-power one, and should read that way. */}
                    {report.grudges.created.length > 0 && (
                      <div className={styles.grudgeBlock}>
                        <span className={styles.grudgeBlockLabel}>
                          <Icon icon="ph:bookmark-simple-bold" /> Grudges recorded:
                        </span>
                        {report.grudges.created.map((g, i) => {
                            const power = (stakeholders[g.stakeholder_id]?.power || "").toLowerCase();
                            const isHighPower = power === "high";
                            return (
                              <span
                                key={`${g.stakeholder_id}-${i}`}
                                className={`${styles.grudgeChip} ${isHighPower ? styles.grudgeChipSevere : styles.grudgeChipMinor}`}
                                title="Will remember this compromise and bring heightened skepticism into future debates."
                              >
                                <Icon icon={isHighPower ? "ph:warning-bold" : "ph:bookmark-simple-bold"} />
                                {stakeholderName(g.stakeholder_id, stakeholders)}
                                {isHighPower && <span className={styles.grudgeChipTag}>high power</span>}
                              </span>
                            );
                          })}
                      </div>
                    )}
                    {report.grudges.fired.length > 0 && (
                      <div className={`${styles.alertNote} ${styles.alertNeutral} mt-1`}>
                        <Icon icon="ph:clock-countdown-bold" style={{ fontSize: "1.1rem", flexShrink: 0 }} />
                        <div>
                          <strong>Prior Grudge Triggered:</strong>{" "}
                          {report.grudges.fired
                            .map((g) => `${stakeholderName(g.stakeholder_id, stakeholders)} (${g.detail || g.effect})`)
                            .join(", ")}
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
                                <strong>{formatComponentId(e.target)}</strong> moved from {formatLevel(e.before)} to{" "}
                                {formatLevel(e.after)}
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
                                <strong>{formatComponentId(p.target)}</strong> adapted from{" "}
                                {formatLevel(p.effective.before)} to {formatLevel(p.effective.after)}
                                {p.via && ` (via ${formatComponentId(p.via)})`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Summary Column: abstract Project Dimensions & architecture debt, read after the story */}
              <div className={styles.summaryCol}>
                {/* Project Dimensions Shift (6 MLOps Metrics) */}
                <div className={styles.surfaceCard}>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>
                      <Icon icon="ph:compass-tool-bold" />
                      <span>Project Dimensions Shift</span>
                    </h3>
                  </div>
                  <div className={styles.cardBody}>
                    <p className={styles.metricsExplainer}>
                      The same six project metrics from the Performance Dashboard header - here's
                      how this rollout moved them.
                    </p>
                    {changedMetrics.length === 0 ? (
                      <div className={styles.emptyState}>
                        <Icon icon="ph:equals-bold" />
                        <span>No shifts this rollout - all six metrics are unchanged.</span>
                      </div>
                    ) : (
                      <div className={styles.metricsGrid}>
                        {changedMetrics.map(({ mId, mObj, beforeVal, afterVal, afterFilled }) => {
                          const improved = afterVal > beforeVal;
                          return (
                            <div
                              key={mId}
                              className={styles.metricCard}
                              style={{ ["--metric" as string]: mObj.metric_color }}
                            >
                              <span className={styles.metricBadge}>
                                <Icon icon={mObj.metric_icon} />
                              </span>
                              <div className={styles.metricCardBody}>
                                <div className={styles.metricTopline}>
                                  <span className={styles.metricName}>{mObj.name || mId}</span>
                                  <span
                                    className={`${styles.metricChange} ${
                                      improved ? styles.metricUp : styles.metricDown
                                    }`}
                                  >
                                    <Icon icon={improved ? "ph:trend-up-bold" : "ph:trend-down-bold"} />
                                    {beforeVal} → {afterVal}
                                    <span className={styles.metricMax}>/{mObj.max_value}</span>
                                  </span>
                                </div>
                                <span className={styles.metricSegments} aria-hidden>
                                  {Array.from({ length: METRIC_SEGMENTS }, (_, i) => (
                                    <span
                                      key={i}
                                      className={`${styles.segment} ${i < afterFilled ? styles.segmentOn : ""}`}
                                    />
                                  ))}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {steadyMetrics.length > 0 && (
                      <div className={styles.steadyMetricsLine}>
                        <Icon icon="ph:equals-bold" />
                        <span>
                          Unchanged: {steadyMetrics.map((m) => m.mObj.name).join(", ")}
                        </span>
                      </div>
                    )}
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
                    {Object.values(report.patterns).every((l) => l.length === 0) &&
                    report.debt_created.length === 0 &&
                    report.debt_cleared.length === 0 ? (
                      <div className={styles.emptyState}>
                        <Icon icon="ph:tree-structure-bold" />
                        <span>No architectural changes or technical shortcuts occurred this turn.</span>
                      </div>
                    ) : (
                      <div className="d-flex flex-wrap gap-2 mt-1">
                        {report.patterns.gained.map((p) => (
                          <span key={p} className="badge bg-success text-light p-2 d-flex align-items-center gap-1">
                            <Icon icon="ph:sparkle-bold" />
                            Pattern: {p}
                          </span>
                        ))}
                        {report.patterns.anti_resolved.map((p) => (
                          <span key={p} className="badge bg-success text-light p-2 d-flex align-items-center gap-1">
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
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Footer Strip ── */}
      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          {report && (
            <div className={styles.stakesSummary}>
              {shortcutCount > 0 && (
                <span className={`${styles.stakeChip} ${styles.stakeWarn}`}>
                  <Icon icon="ph:warning-octagon-bold" /> {shortcutCount} shortcut{shortcutCount === 1 ? "" : "s"}
                </span>
              )}
              {grudgeCount > 0 && (
                <span className={`${styles.stakeChip} ${styles.stakeWarn}`}>
                  <Icon icon="ph:bookmark-simple-bold" /> {grudgeCount} grudge{grudgeCount === 1 ? "" : "s"}
                </span>
              )}
              {improvedCount > 0 && (
                <span className={`${styles.stakeChip} ${styles.stakeGood}`}>
                  <Icon icon="ph:trend-up-bold" /> {improvedCount} improved
                </span>
              )}
              {declinedCount > 0 && (
                <span className={`${styles.stakeChip} ${styles.stakeBad}`}>
                  <Icon icon="ph:trend-down-bold" /> {declinedCount} declined
                </span>
              )}
              {shortcutCount === 0 && grudgeCount === 0 && declinedCount === 0 && (
                <span className={`${styles.stakeChip} ${styles.stakeGood}`}>
                  <Icon icon="ph:check-bold" /> Clean rollout
                </span>
              )}
            </div>
          )}
          <div className={styles.footerHint}>
            <Icon icon="ph:info-bold" />
            <span>
              {payload?.next_challenge
                ? `Next Milestone: ${payload.next_challenge.phase_name || "Next Phase"} • ${payload.next_challenge.name}`
                : "Ready to proceed to the next milestone."}
            </span>
          </div>
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
