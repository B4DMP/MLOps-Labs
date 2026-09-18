import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { healthBucket, HEALTH_BUCKET_WORD } from "../utils/systemHealth";
import styles from "./PerformanceDashboard.module.css";

// ── Types ────────────────────────────────────────────────────────────────────

interface PatternRef {
  id: string;
  kind: "anti" | "design";
  name: string;
}

interface StageData {
  id: string;
  name: string;
  band: boolean;
  locked: boolean;
  phase_id?: number;
  health?: number;
  health_band?: [number, number];
  status?: "healthy" | "degraded" | "broken";
  maturity?: number;
  broken?: number;
  starved?: number;
  debt?: number;
  patterns?: PatternRef[];
}

interface FlowData {
  from: string;
  to: string;
  level: number;
  weakest_edge_id: string;
}

interface ComponentData {
  id: string;
  name: string;
  owner_id?: string;
  knowledge: "unknown" | "current" | "stale";
  nominal?: number;
  effective?: number;
  capped_by?: string;
  story?: string;
  seen_at?: number;
  layout?: { x: number; y: number };
  debt?: Array<{ intended: number; applied: number; owner_id?: string }>;
  instances?: Array<{ id: string; kind: string; name: string; state: string; props: Record<string, string> }>;
}

interface EdgeData {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
  knowledge: "unknown" | "current" | "stale";
  level?: number;
  trigger?: string;
  story?: string;
  seen_at?: number;
  capped_by?: string;
}

interface TechnicalStage {
  components: ComponentData[];
  edges: EdgeData[];
}

interface GraphStatePayload {
  stages: StageData[];
  flows: FlowData[];
  feedback_flows: FlowData[];
  governance_flows: FlowData[];
  technical: Record<string, TechnicalStage>;
  system_health: number;
}

export interface PerformanceDashboardProps {
  isOpen?: boolean;
  isVisible?: boolean;
  onClose?: () => void;
  onToggle?: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: any;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_STAGES: StageData[] = [];
const LEVEL_LABELS = ["broken", "absent", "manual", "automated", "governed"];

const TRIGGER_ICONS: Record<string, string> = {
  none: "—",
  manual_request: "✋",
  schedule: "⏰",
  commit: "📦",
  data_arrival: "📊",
  alert: "🚨",
  approval: "✅",
};

function statusColor(status?: string): string {
  if (status === "healthy") return "#16a34a";
  if (status === "degraded") return "#ea580c";
  if (status === "broken") return "#dc3545";
  return "#64748b";
}

function healthText(stage: StageData): string {
  if (stage.locked) return "not there yet";
  if (stage.health_band) {
    const [lo, hi] = stage.health_band;
    return HEALTH_BUCKET_WORD[healthBucket((lo + hi) / 2)];
  }
  return HEALTH_BUCKET_WORD[healthBucket(stage.health)];
}

function LevelPips({ nominal, effective }: { nominal: number; effective?: number }) {
  const MAX = 4;
  return (
    <span className="d-inline-flex gap-1 align-items-center">
      {Array.from({ length: MAX + 1 }, (_, i) => {
        const isBroken = i === 0;
        const filled = i <= nominal;
        const cappedOff = effective !== undefined && i > effective && i <= nominal;
        let bg = "transparent";
        let border = "1px solid #cbd5e1";
        if (isBroken && nominal === 0) {
          bg = "#dc3545";
          border = "1px solid #dc3545";
        } else if (filled) {
          bg = cappedOff ? "#ea580c" : "#16a34a";
          border = `1px solid ${bg}`;
        }
        return (
          <span
            key={i}
            title={LEVEL_LABELS[i]}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              display: "inline-block",
              background: bg,
              border,
            }}
          />
        );
      })}
    </span>
  );
}

const GOVERNANCE_COLOR = "#b45309";

function CrossStageArcs({
  pipelineStages,
  flows,
  centres,
  width,
  variant,
}: {
  pipelineStages: StageData[];
  flows: FlowData[];
  centres: Record<string, number>;
  width: number;
  variant: "feedback" | "governance";
}) {
  const N = pipelineStages.length;
  const lockedIds = new Set(pipelineStages.filter((s) => s.locked).map((s) => s.id));
  const arcs = flows.filter((f) => {
    const fi = pipelineStages.findIndex((s) => s.id === f.from);
    const ti = pipelineStages.findIndex((s) => s.id === f.to);
    if (fi < 0 || ti < 0 || fi === ti) return false;
    if (lockedIds.has(f.from) || lockedIds.has(f.to)) return false;
    return centres[f.from] !== undefined && centres[f.to] !== undefined;
  });
  if (N === 0 || arcs.length === 0 || width <= 0) return null;

  const prefix = variant === "governance" ? "gv" : "fb";
  const W = width;
  const H = variant === "governance" ? 28 : 48;
  const cx = (i: number) => centres[pipelineStages[i].id];
  const colorFor = (level: number) =>
    variant === "governance" ? GOVERNANCE_COLOR : statusColor(level === 0 ? "broken" : level >= 3 ? "healthy" : "degraded");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      preserveAspectRatio="none"
      style={{ display: "block", marginBottom: 2 }}
      aria-hidden
    >
      <defs>
        {arcs.map((f) => {
          const key = `${prefix}-${f.from}-${f.to}`.replace(/\./g, "_");
          const color = colorFor(f.level);
          return (
            <marker key={key} id={key} markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
              {variant === "governance"
                ? <path d="M0,3 L3,0 L6,3 L3,6 z" fill={color} />
                : <path d="M0,0 L0,5 L5,2.5 z" fill={color} />}
            </marker>
          );
        })}
      </defs>
      {arcs.map((f) => {
        const fi = pipelineStages.findIndex((s) => s.id === f.from);
        const ti = pipelineStages.findIndex((s) => s.id === f.to);
        const x1 = cx(fi);
        const x2 = cx(ti);
        const dist = Math.abs(fi - ti);
        const arcTop = Math.max(2, H - dist * Math.floor((H - 2) / Math.max(N - 1, 1)));
        const color = colorFor(f.level);
        const key = `${prefix}-${f.from}-${f.to}`.replace(/\./g, "_");
        return (
          <path
            key={key}
            d={`M ${x1},${H} C ${x1},${arcTop} ${x2},${arcTop} ${x2},${H}`}
            fill="none"
            stroke={color}
            strokeWidth={1.75}
            strokeDasharray={variant === "governance" ? "2 3" : f.level === 0 ? "4 2" : undefined}
            markerEnd={`url(#${key})`}
            opacity={0.9}
          />
        );
      })}
    </svg>
  );
}

const BOX_W = 140;
const BOX_H = 56;

function edgeEnds(x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const halfW = BOX_W / 2 + 4;
  const halfH = BOX_H / 2 + 4;
  const scale = (w: number, h: number) => {
    const sx = dx === 0 ? Infinity : Math.abs(w / dx);
    const sy = dy === 0 ? Infinity : Math.abs(h / dy);
    return Math.min(sx, sy);
  };
  const s1 = scale(halfW, halfH);
  const s2 = scale(halfW, halfH);
  return [x1 + dx * s1, y1 + dy * s1, x2 - dx * s2, y2 - dy * s2];
}

function wrapLabel(name: string, max: number): string[] {
  const words = name.split(" ");
  const lines: string[] = [];
  let current = "";
  words.forEach((w) => {
    if ((current + " " + w).trim().length <= max) {
      current = (current + " " + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function nodeColor(c: ComponentData, isSelected: boolean): string {
  if (isSelected) return "#f0f7fa";
  if (c.knowledge === "unknown") return "#f8fafc";
  const eff = c.effective ?? c.nominal ?? 1;
  if (eff === 0) return "#fef2f2";
  if (c.knowledge === "stale") return "#fffbeb";
  return "#ffffff";
}

function nodeBorder(c: ComponentData, isSelected: boolean): string {
  if (isSelected) return "var(--primary-bg, #266682)";
  if (c.knowledge === "unknown") return "#cbd5e1";
  const eff = c.effective ?? c.nominal ?? 1;
  if (eff === 0) return "#dc3545";
  if (c.capped_by) return "#ea580c";
  return "#93c5fd";
}

function StageSvg({
  technical,
  selectedComponentId,
  onSelectComponent,
}: {
  technical: TechnicalStage;
  selectedComponentId: string | null;
  onSelectComponent: (id: string | null) => void;
}) {
  const compById = Object.fromEntries(technical.components.map((c) => [c.id, c]));
  const hasLayout = technical.components.some((c) => c.layout);

  if (!hasLayout) return null;

  const xs = technical.components.flatMap((c) => (c.layout ? [c.layout.x] : []));
  const ys = technical.components.flatMap((c) => (c.layout ? [c.layout.y] : []));
  const pad = 14;
  const svgW = Math.max(...xs) + BOX_W / 2 + pad * 2;
  const svgH = Math.max(...ys) + BOX_H / 2 + pad * 2;

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", maxWidth: "100%", maxHeight: "100%", margin: "0 auto" }}
    >
      {/* Connecting Edges */}
      {technical.edges.map((e) => {
        const from = compById[e.from_id];
        const to = compById[e.to_id];
        if (!from?.layout || !to?.layout) return null;
        const [ax, ay, bx, by] = edgeEnds(from.layout.x, from.layout.y, to.layout.x, to.layout.y);
        const x1b = ax, y1b = ay, x2b = bx, y2b = by;
        const known = e.knowledge !== "unknown";
        const color = known ? (e.level === 0 ? "#dc3545" : e.level && e.level >= 3 ? "#16a34a" : "#ea580c") : "#94a3b8";
        return (
          <g key={e.id} opacity={e.knowledge === "stale" ? 0.6 : 1}>
            <defs>
              <marker id={`arr-${e.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill={color} />
              </marker>
            </defs>
            <line
              x1={x1b} y1={y1b} x2={x2b} y2={y2b}
              stroke={color}
              strokeWidth={known && e.level && e.level >= 3 ? 2 : 1.5}
              className={
                !known ? undefined
                  : e.level === 0 ? "pipe-dead"
                  : e.level != null && e.level >= 3 ? "pipe-flow"
                  : "pipe-flow-slow"
              }
              strokeDasharray={e.knowledge === "unknown" ? "4 3" : undefined}
              markerEnd={`url(#arr-${e.id})`}
            />
            {known && e.trigger && e.trigger !== "none" && (
              <text x={(x1b + x2b) / 2} y={(y1b + y2b) / 2 - 4} fill={color} fontSize={10} textAnchor="middle">
                {TRIGGER_ICONS[e.trigger] ?? ""}
              </text>
            )}
          </g>
        );
      })}

      {/* Component Nodes */}
      {technical.components.map((c) => {
        if (!c.layout) return null;
        const { x, y } = c.layout;
        const isSelected = selectedComponentId === c.id;
        const bg = nodeColor(c, isSelected);
        const border = nodeBorder(c, isSelected);
        const rawName = c.name || c.id.split(".").pop()?.replace(/_/g, " ") || c.id;
        const lines = wrapLabel(rawName, 17);

        return (
          <g
            key={c.id}
            transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2})`}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectComponent(isSelected ? null : c.id)}
            opacity={c.knowledge === "stale" ? 0.85 : 1}
          >
            {/* Outer Box */}
            <rect
              width={BOX_W}
              height={BOX_H}
              rx={7}
              fill={bg}
              stroke={border}
              strokeWidth={isSelected ? 2.5 : 1.5}
              strokeDasharray={c.knowledge === "unknown" ? "4 3" : undefined}
            />

            {/* Click / Inspect Icon in corner */}
            <circle
              cx={BOX_W - 12}
              cy={12}
              r={7}
              fill={isSelected ? "var(--primary-bg, #266682)" : "#f1f5f9"}
              stroke={isSelected ? "var(--primary-bg, #266682)" : "#cbd5e1"}
              strokeWidth={1}
            />
            <text
              x={BOX_W - 12}
              y={15}
              fontSize={8}
              textAnchor="middle"
              fill={isSelected ? "#ffffff" : "#64748b"}
              fontWeight="bold"
            >
              🔍
            </text>

            {/* Component Title */}
            {lines.map((line, i) => (
              <text
                key={i}
                x={12}
                y={16 + i * 12}
                fill={c.knowledge === "unknown" ? "#64748b" : isSelected ? "var(--primary-bg, #266682)" : "#1e293b"}
                fontSize={10}
                fontWeight={isSelected ? "700" : "600"}
              >
                {line}
              </text>
            ))}

            {c.knowledge === "unknown" && (
              <text x={12} y={BOX_H - 10} fill="#94a3b8" fontSize={8.5}>
                not looked at yet
              </text>
            )}

            {/* Level Pips */}
            {c.knowledge !== "unknown" && c.nominal !== undefined && (
              <g transform={`translate(12, ${BOX_H - 12})`}>
                {Array.from({ length: 5 }, (_, i) => {
                  const filled = i <= c.nominal!;
                  const capped = c.effective !== undefined && i > c.effective && filled;
                  return (
                    <circle
                      key={i}
                      cx={i * 11}
                      cy={0}
                      r={4}
                      fill={i === 0 && c.nominal === 0 ? "#dc3545" : filled ? (capped ? "#ea580c" : "#16a34a") : "transparent"}
                      stroke={filled ? "none" : "#cbd5e1"}
                      strokeWidth={1}
                    />
                  );
                })}
              </g>
            )}

            {/* Stale Marker */}
            {c.knowledge === "stale" && c.seen_at !== undefined && (
              <text x={BOX_W - 12} y={BOX_H - 8} fill="#d97706" fontSize={8} textAnchor="end" fontWeight="600">
                #{c.seen_at}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Animations ───────────────────────────────────────────────────────────────

const PIPELINE_ANIM = `
@keyframes pipeFlow { to { stroke-dashoffset: -24; } }
@keyframes pipePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes pipeFailing {
  0%, 100% { border-color: #dc3545; }
  50% { border-color: rgba(220, 53, 69, 0.3); }
}
.pipe-flow { stroke-dasharray: 6 6; animation: pipeFlow 1.1s linear infinite; }
.pipe-flow-slow { stroke-dasharray: 4 8; animation: pipeFlow 2.6s linear infinite; }
.pipe-dead { stroke-dasharray: 3 5; animation: pipePulse 1.4s ease-in-out infinite; }
.pipe-stage-failing { animation: pipeFailing 1.8s ease-in-out infinite; }
.pipe-bar { background-size: 200% 100%; animation: pipeFlow 0s; }
@keyframes pipeBar { to { background-position: -200% 0; } }
.pipe-bar-run { animation: pipeBar 1.4s linear infinite; }
`;

// ── Main PerformanceDashboard Component ──────────────────────────────────────

export default function PerformanceDashboard({
  isOpen,
  isVisible,
  onClose,
  onToggle,
  currentPhase = 0,
}: PerformanceDashboardProps) {
  const isDashboardOpen = isOpen ?? isVisible ?? false;
  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else if (onToggle) onToggle();
  }, [onClose, onToggle]);

  const { emit, subscribe } = useGameWebSocket();
  const [graphState, setGraphState] = useState<GraphStatePayload | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedComp, setSelectedComp] = useState<string | null>(null);

  const stageRefs = useRef<Record<string, HTMLElement | null>>({});
  const buttonsRowRef = useRef<HTMLDivElement | null>(null);
  const [centres, setCentres] = useState<{ centres: Record<string, number>; width: number }>({
    centres: {},
    width: 0,
  });

  // Escape handling: the first Escape deselects component/stage, the second closes dashboard
  useEffect(() => {
    if (!isDashboardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedComp) setSelectedComp(null);
      else handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDashboardOpen, selectedComp, handleClose]);

  const requestState = useCallback(() => {
    emit("graph:state_request", { phase_id: currentPhase });
  }, [emit, currentPhase]);

  useEffect(() => {
    if (!isDashboardOpen) return;
    requestState();
    const unsub = subscribe("graph:state", (data: GraphStatePayload) => {
      setGraphState(data);
    });
    return unsub;
  }, [isDashboardOpen, requestState, subscribe]);

  useEffect(() => {
    if (!isDashboardOpen) return;
    requestState();
  }, [isDashboardOpen, currentPhase, requestState]);

  const pipelineStages = graphState?.stages ?? EMPTY_STAGES;

  // Default selected stage to current phase's stage or first unlocked stage if not already selected
  useEffect(() => {
    if (!selectedStage && pipelineStages.length > 0) {
      const unlockedStages = pipelineStages.filter((s) => !s.locked);
      const effectivePhase = currentPhase === 0 ? 1 : currentPhase;
      const targetStage =
        pipelineStages.find((s) => s.phase_id === effectivePhase && !s.locked) ||
        unlockedStages[0] ||
        pipelineStages[0];
      if (targetStage) {
        setSelectedStage(targetStage.id);
      }
    }
  }, [selectedStage, pipelineStages, currentPhase]);

  useLayoutEffect(() => {
    if (!isDashboardOpen || !buttonsRowRef.current) return;

    const measure = () => {
      const rowEl = buttonsRowRef.current;
      if (!rowEl) return;
      const rowLeft = rowEl.getBoundingClientRect().left;
      const next: Record<string, number> = {};
      pipelineStages.forEach((stage) => {
        const el = stageRefs.current[stage.id];
        if (!el) return;
        const r = el.getBoundingClientRect();
        next[stage.id] = Math.round(r.left - rowLeft + r.width / 2);
      });
      const width = Math.round(rowEl.scrollWidth || rowEl.offsetWidth);

      setCentres((prev) => {
        const widthSame = Math.abs(prev.width - width) < 2;
        const keysSame = Object.keys(next).length === Object.keys(prev.centres).length;
        const centresSame =
          keysSame &&
          Object.entries(next).every(
            ([k, v]) => Math.abs((prev.centres[k] ?? -999) - v) < 2
          );
        if (widthSame && centresSame) {
          return prev;
        }
        return { centres: next, width };
      });
    };

    measure();

    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(buttonsRowRef.current);
    return () => resizeObserver.disconnect();
  }, [isDashboardOpen, graphState, pipelineStages]);

  const activeStage = selectedStage
    ? graphState?.stages.find((s) => s.id === selectedStage)
    : null;

  const activeTechnical = activeStage && graphState?.technical[activeStage.id]
    ? graphState.technical[activeStage.id]
    : null;

  const selComponentData = activeTechnical && selectedComp
    ? activeTechnical.components.find((c) => c.id === selectedComp)
    : null;

  return (
    <div
      className={`${styles.helpOverlayLayer} ${
        isDashboardOpen ? styles.helpLayerVisible : styles.helpLayerHidden
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <style>{PIPELINE_ANIM}</style>
      <div className={styles.dashboardPanel}>
        {/* Header matching PrePhaseDialog modal system */}
        <div className={styles.header}>
          <h4 className={styles.headerTitle}>
            <Icon
              icon="material-symbols:dashboard-rounded"
              style={{ fontSize: "1.35rem", color: "#ffffff" }}
            />
            <span>Performance Dashboard</span>
          </h4>
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={handleClose}
            aria-label="Close Performance Dashboard"
            title="Close Performance Dashboard (Esc)"
            style={{ cursor: "pointer" }}
          />
        </div>

        {/* Modal Body */}
        <div className={styles.modalBody}>
          {/* Section 1: Phase Overview */}
          <div className={styles.sectionCard}>
            <span className={styles.sectionLabel}>
              <Icon icon="ph:clipboard-text-bold" style={{ fontSize: "1.05rem" }} /> Phase Overview
            </span>
            <div>
              <PhaseOverview />
            </div>
          </div>

          {/* Section 2: Performance Metrics */}
          <div className={styles.sectionCard}>
            <span className={styles.sectionLabel}>
              <Icon icon="ph:chart-bar-bold" style={{ fontSize: "1.05rem" }} /> Performance Metrics
            </span>
            <div>
              <MetricTab current_phase={currentPhase} />
            </div>
          </div>

          {/* Section 3: MLOps Project Graph with Side-by-Side Node Details */}
          <div className={`${styles.sectionCard} ${styles.graphSectionCard}`}>
            <span className={styles.sectionLabel}>
              <Icon icon="ph:target-bold" style={{ fontSize: "1.05rem" }} /> MLOps Project Graph
            </span>

            {/* Pipeline Stage Buttons Row */}
            {graphState ? (
              <div className={styles.graphContentWrapper}>
                <div style={{ overflowX: "auto", overflowY: "hidden", paddingTop: 10, paddingBottom: 2 }}>
                  <div style={{ width: "max-content", minWidth: "100%", padding: "2px 2px" }}>
                    <CrossStageArcs
                      pipelineStages={pipelineStages}
                      flows={graphState.governance_flows ?? []}
                      centres={centres.centres}
                      width={centres.width}
                      variant="governance"
                    />
                    <CrossStageArcs
                      pipelineStages={pipelineStages}
                      flows={graphState.feedback_flows ?? []}
                      centres={centres.centres}
                      width={centres.width}
                      variant="feedback"
                    />
                    <div
                      ref={buttonsRowRef}
                      className="d-flex align-items-center gap-2"
                      style={{ position: "relative", zIndex: 5, marginTop: 4 }}
                    >
                      {pipelineStages.map((stage, i) => {
                        const flow = graphState.flows.find((f) => f.from === pipelineStages[i - 1]?.id && f.to === stage.id);
                        const isStageActive = selectedStage === stage.id;

                        return (
                          <div
                            key={stage.id}
                            className="d-flex align-items-center gap-2"
                            ref={(el) => { stageRefs.current[stage.id] = el; }}
                          >
                            {i > 0 && (
                              stage.band ? (
                                <div
                                  title="Cross-cutting Governance & Infrastructure"
                                  style={{
                                    width: 28,
                                    height: 0,
                                    borderTop: "2px dashed #94a3b8",
                                    margin: "0 2px",
                                  }}
                                />
                              ) : (
                                <div
                                  className={flow ? (flow.level === 0 ? "" : "pipe-bar pipe-bar-run") : ""}
                                  title={flow ? `Flow between stages: ${LEVEL_LABELS[flow.level]}` : undefined}
                                  style={{
                                    width: 28,
                                    height: flow && flow.level === 0 ? 2 : 3,
                                    borderRadius: 2,
                                    background: !flow
                                      ? "#cbd5e1"
                                      : flow.level === 0
                                        ? statusColor("broken")
                                        : `repeating-linear-gradient(90deg, ${statusColor(flow.level >= 3 ? "healthy" : "degraded")} 0 7px, rgba(0,0,0,0.08) 7px 14px)`,
                                  }}
                                />
                              )
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (!stage.locked) {
                                  setSelectedStage(stage.id);
                                  setSelectedComp(null);
                                }
                              }}
                              className={`${styles.stageButton} ${isStageActive ? styles.stageButtonActive : ""} ${stage.locked ? styles.stageButtonLocked : ""} ${!stage.locked && stage.status === "broken" ? "pipe-stage-failing" : ""}`}
                              disabled={stage.locked}
                              title={stage.locked ? "Stage locked" : `Click to inspect ${stage.name}`}
                            >
                              <div className="fw-bold" style={{ color: stage.locked ? "#94a3b8" : "var(--text-primary, #1e293b)" }}>
                                {stage.name}
                              </div>
                              <div
                                style={{
                                  fontSize: "0.72rem",
                                  fontWeight: 600,
                                  color: stage.locked ? "#94a3b8" : statusColor(stage.status),
                                }}
                              >
                                {stage.locked ? "🔒 locked" : healthText(stage)}
                              </div>

                              {!stage.locked && (
                                <div className={styles.stageClickHint}>
                                  <Icon icon="ph:cursor-click-bold" />
                                  <span>{isStageActive ? "Viewing" : "Click to view"}</span>
                                </div>
                              )}

                              {!stage.locked && stage.patterns && stage.patterns.length > 0 && (
                                <div className="d-flex justify-content-center gap-1 mt-1">
                                  {stage.patterns.map((p) => (
                                    <span
                                      key={p.id}
                                      style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: "50%",
                                        background: p.kind === "anti" ? "#dc3545" : "#16a34a",
                                        display: "inline-block",
                                      }}
                                      title={p.name}
                                    />
                                  ))}
                                </div>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* System health summary */}
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-1 pt-1 border-top">
                  {graphState.system_health !== undefined && (
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 700,
                        color: statusColor(
                          healthBucket(graphState.system_health) === "healthy" ? "healthy"
                            : healthBucket(graphState.system_health) === "strained" ? "degraded"
                            : "broken"
                        ),
                      }}
                    >
                      The system as a whole: {HEALTH_BUCKET_WORD[healthBucket(graphState.system_health)]}
                    </div>
                  )}
                </div>

                {/* Two-column Layout: Graph Topology (Left) and Node Details (Right) */}
                {activeStage && activeTechnical ? (
                  <div className={styles.graphGrid}>
                    {/* Left Column: Stage Topology Canvas */}
                    <div className={styles.graphColumn}>
                      {/* Subheader with Stage Info & Legend */}
                      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 pt-1">
                        <div className="d-flex align-items-center gap-2">
                          <h6 className="mb-0 fw-bold" style={{ color: "var(--text-primary, #1e293b)", fontSize: "0.92rem" }}>
                            {activeStage.name} Architecture
                          </h6>
                          <span className="badge text-white" style={{ background: statusColor(activeStage.status), fontSize: "0.72rem" }}>
                            {healthText(activeStage)}
                          </span>
                          {!!activeStage.starved && (
                            <span className="badge bg-secondary" style={{ fontSize: "0.7rem" }}>
                              {activeStage.starved} starved
                            </span>
                          )}
                        </div>

                        {/* Legend */}
                        <div className="d-flex gap-3" style={{ fontSize: "0.76rem", color: "var(--text-secondary, #475569)" }}>
                          {(graphState.feedback_flows?.length ?? 0) > 0 && (
                            <span className="d-flex align-items-center gap-1">
                              <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={statusColor("healthy")} strokeWidth="2" /></svg>
                              feedback loop
                            </span>
                          )}
                          {(graphState.governance_flows?.length ?? 0) > 0 && (
                            <span className="d-flex align-items-center gap-1">
                              <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={GOVERNANCE_COLOR} strokeWidth="2" strokeDasharray="2 3" /></svg>
                              governance
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Active Patterns */}
                      {activeStage.patterns && activeStage.patterns.length > 0 && (
                        <div className="d-flex gap-1 flex-wrap">
                          {activeStage.patterns.map((p) => (
                            <span
                              key={p.id}
                              className="badge"
                              style={{ background: p.kind === "anti" ? "#dc3545" : "#16a34a", fontSize: "0.7rem" }}
                              title={p.id}
                            >
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* SVG Canvas Box */}
                      <div className={styles.graphCanvasBox}>
                        <StageSvg
                          technical={activeTechnical}
                          selectedComponentId={selectedComp}
                          onSelectComponent={setSelectedComp}
                        />
                      </div>

                      {/* Non-pipeline edges summary */}
                      {activeTechnical.edges.filter((e) => e.kind !== "pipeline" && e.knowledge !== "unknown").length > 0 && (
                        <div className="p-2 rounded bg-light border" style={{ fontSize: "0.76rem" }}>
                          <span className="fw-bold text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Cross-Stage Connections: </span>
                          {activeTechnical.edges.filter((e) => e.kind !== "pipeline" && e.knowledge !== "unknown").map((e, idx) => (
                            <span key={e.id} className="text-muted ms-2">
                              {idx > 0 && "• "}
                              {e.from_id.split(".").pop()} → {e.to_id.split(".").pop()}
                              {e.trigger && e.trigger !== "none" && <span className="ms-1">{TRIGGER_ICONS[e.trigger]}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right Column: Node Details Panel */}
                    <div className={styles.detailsColumn}>
                      <div className={styles.detailsCard}>
                        <div className={styles.detailsCardHeader}>
                          <span className="d-flex align-items-center gap-2">
                            <Icon icon={selComponentData ? "ph:cube-bold" : "ph:cards-bold"} />
                            <span>{selComponentData ? selComponentData.name : `${activeStage.name} Components`}</span>
                          </span>
                          {selComponentData && (
                            <button
                              type="button"
                              className="btn btn-sm btn-link text-white text-decoration-none p-0"
                              onClick={() => setSelectedComp(null)}
                              title="Back to component list"
                              style={{ fontSize: "0.78rem" }}
                            >
                              ✕ Close
                            </button>
                          )}
                        </div>

                        <div className={styles.detailsCardBody}>
                          {selComponentData ? (
                            /* Detailed view for selected component */
                            <>
                              <div className="d-flex align-items-center gap-2 flex-wrap">
                                <span style={{ fontSize: "1.2rem" }}>{selComponentData.knowledge !== "unknown" ? "🧩" : "🌫"}</span>
                                <span className="fw-bold fs-6" style={{ color: "var(--text-primary, #1e293b)" }}>
                                  {selComponentData.name}
                                </span>
                              </div>

                              <div className="d-flex gap-1 flex-wrap">
                                {selComponentData.owner_id && (
                                  <span className="badge bg-light text-secondary border" style={{ fontSize: "0.68rem" }}>
                                    Owner: {selComponentData.owner_id.replace(/_/g, " ")}
                                  </span>
                                )}
                                {selComponentData.knowledge === "stale" && (
                                  <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle" style={{ fontSize: "0.68rem" }}>
                                    stale snapshot
                                  </span>
                                )}
                                {selComponentData.knowledge === "unknown" && (
                                  <span className="badge bg-light text-muted border" style={{ fontSize: "0.68rem" }}>
                                    not yet analyzed
                                  </span>
                                )}
                              </div>

                              {selComponentData.knowledge !== "unknown" && selComponentData.nominal !== undefined ? (
                                <>
                                  <div className="p-2 rounded bg-light border">
                                    <div className="d-flex align-items-center justify-content-between mb-1">
                                      <span className="small text-muted fw-semibold">Implementation Level:</span>
                                      <LevelPips nominal={selComponentData.nominal} effective={selComponentData.effective} />
                                    </div>
                                    <div className="small" style={{ color: "var(--text-primary, #1e293b)" }}>
                                      Runs <strong>{LEVEL_LABELS[selComponentData.effective ?? selComponentData.nominal ?? 0]}</strong>
                                      {selComponentData.capped_by && selComponentData.effective !== undefined && selComponentData.nominal !== undefined && selComponentData.effective < selComponentData.nominal && (
                                        <> (set up for <strong>{LEVEL_LABELS[selComponentData.nominal]}</strong>)</>
                                      )}
                                    </div>
                                  </div>

                                  {selComponentData.capped_by && selComponentData.effective !== undefined && selComponentData.nominal !== undefined && selComponentData.effective < selComponentData.nominal && (
                                    <div className="p-2 rounded" style={{ fontSize: "0.78rem", color: "#9a3412", background: "#fff7ed", border: "1px solid #ffedd5" }}>
                                      <strong>⛓ Held Back:</strong> Bottlenecked by <strong>{selComponentData.capped_by}</strong>. Raising this component changes nothing until that is addressed.
                                    </div>
                                  )}

                                  {selComponentData.debt && selComponentData.debt.length > 0 && (
                                    <div className="p-2 rounded" style={{ fontSize: "0.78rem", color: "#854d0e", background: "#fefce8", border: "1px solid #fef08a" }}>
                                      <strong>🧾 Technical Debt:</strong> Meant to be <strong>{LEVEL_LABELS[selComponentData.debt[0].intended]}</strong>, landed <strong>{LEVEL_LABELS[selComponentData.debt[0].applied]}</strong>
                                      {selComponentData.debt[0].owner_id && <> without support from {selComponentData.debt[0].owner_id.replace(/_/g, " ")}</>}.
                                    </div>
                                  )}

                                  {selComponentData.story && (
                                    <p className="small mb-0" style={{ color: "var(--text-secondary, #475569)", fontStyle: "italic", lineHeight: 1.45 }}>
                                      "{selComponentData.story}"
                                    </p>
                                  )}

                                  {selComponentData.instances && selComponentData.instances.length > 0 && (
                                    <div>
                                      <span className="small text-muted fw-bold text-uppercase" style={{ fontSize: "0.68rem" }}>
                                        Running Services:
                                      </span>
                                      <div className="d-flex flex-column gap-1 mt-1">
                                        {selComponentData.instances.map((inst) => (
                                          <div key={inst.id} className="p-1 px-2 rounded bg-light border d-flex align-items-center justify-content-between" style={{ fontSize: "0.75rem" }}>
                                            <span className="fw-semibold">{inst.name}</span>
                                            <span className="badge bg-info-subtle text-info-emphasis border border-info-subtle">{inst.state}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <p className="text-muted small mb-0">
                                  You have not uncovered intel about this component yet. Verify stakeholder intel and resolve objections to unlock deeper insights.
                                </p>
                              )}

                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary mt-auto"
                                onClick={() => setSelectedComp(null)}
                              >
                                ← Back to Component List
                              </button>
                            </>
                          ) : (
                            /* Stage component list view when no single component is selected */
                            <>
                              <div className="alert alert-info border-0 p-2 mb-2 d-flex align-items-center gap-2" style={{ background: "rgba(38, 102, 130, 0.08)", color: "var(--primary-bg)", fontSize: "0.78rem" }}>
                                <Icon icon="ph:cursor-click-bold" className="flex-shrink-0" />
                                <span>Click any component in the diagram or list to view parameters.</span>
                              </div>

                              <div className="d-flex flex-column gap-2" style={{ overflowY: "auto" }}>
                                {activeTechnical.components.map((c) => {
                                  return (
                                    <div
                                      key={c.id}
                                      onClick={() => setSelectedComp(c.id)}
                                      className={styles.componentListItem}
                                      title="Click to view details"
                                    >
                                      <div className="d-flex align-items-center gap-2 min-width-0">
                                        <span style={{ fontSize: "1rem" }}>{c.knowledge !== "unknown" ? "🧩" : "🌫"}</span>
                                        <span className="fw-semibold text-truncate" style={{ fontSize: "0.82rem", color: "var(--text-primary, #1e293b)" }}>
                                          {c.name || c.id.split(".").pop()}
                                        </span>
                                      </div>
                                      <div className="d-flex align-items-center gap-2 flex-shrink-0">
                                        {c.knowledge !== "unknown" && c.nominal !== undefined && (
                                          <LevelPips nominal={c.nominal} effective={c.effective} />
                                        )}
                                        <Icon icon="ph:arrow-right-bold" style={{ color: "var(--primary-bg)", fontSize: "0.85rem" }} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="text-secondary" style={{ fontSize: "0.85rem" }}>Loading pipeline…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
