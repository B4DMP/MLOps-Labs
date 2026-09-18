import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogPanel,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./ComposeActionProposalModal.module.css";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import type { Stakeholder } from "./StakeholderProvider";

export interface AtomicChange {
  target: string;
  kind: "raise_to";
  value?: number;
}

export interface ComponentData {
  id: string;
  name: string;
  stage_id?: string;
  owner_id?: string;
  knowledge: "unknown" | "current" | "stale";
  nominal?: number;
  effective?: number;
  capped_by?: string;
  allowed_levels?: number[];
  layout?: { x: number; y: number };
}

export interface EdgeData {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
  knowledge: "unknown" | "current" | "stale";
  level?: number;
  trigger?: string;
}

export interface TechnicalStage {
  components: ComponentData[];
  edges: EdgeData[];
}

export interface StageData {
  id: string;
  name: string;
  phase_id?: number | null;
  band: boolean;
  locked: boolean;
}

export interface GraphStatePayload {
  stages: StageData[];
  technical: Record<string, TechnicalStage>;
}

export interface ComposeActionProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhase: number;
  currentChallenge: number;
  initialAtomicChanges?: AtomicChange[];
  onConfirmProposal: (atomicChanges: AtomicChange[]) => void;
  allowedTargets?: string[];
  upstreamMap?: Record<string, string[]>;
  predictions?: Array<{
    target: string;
    current: number;
    predicted: number;
    effective_current?: number;
    effective_predicted?: number;
    capped_by?: string;
    upstream_uncertain?: boolean;
    upstream_uncertain_nodes?: string[];
  }>;
  boundaryWarnings?: Array<{
    item_id: string;
    checkable: boolean;
    violated: boolean;
    line?: string;
    target_name?: string | null;
  }>;
  intelItems?: Array<{
    id: string;
    description: string;
    type?: string;
    categorized_type?: string;
    stakeholder_name?: string;
  }>;
  graphState?: GraphStatePayload | null;
  stakeholders?: Record<string, Stakeholder>;
  getStakeholderColor?: (st: any) => string;
}

export const LEVEL_LABELS = ["broken", "absent", "manual", "automated", "governed"];

export function formatLevel(level: number | undefined | null): string {
  if (level === undefined || level === null) return "unknown";
  return LEVEL_LABELS[level] || `level ${level}`;
}

export function formatLevelCap(level: number | undefined | null): string {
  const lbl = formatLevel(level);
  return lbl.charAt(0).toUpperCase() + lbl.slice(1);
}

const MAX_ATOMIC_CHANGES = 3;
const BOX_W = 150;
const BOX_H = 64;

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

function getNextAllowedLevel(curLevel: number, allowedLevels?: number[]): number | null {
  const allowed = allowedLevels && allowedLevels.length > 0 ? [...allowedLevels].sort((a, b) => a - b) : [0, 1, 2, 3, 4];
  const higher = allowed.filter((l) => l > curLevel);
  return higher.length > 0 ? higher[0] : null;
}

export default function ComposeActionProposalModal({
  isOpen,
  onClose,
  currentPhase,
  currentChallenge: _currentChallenge,
  initialAtomicChanges = [],
  onConfirmProposal,
  allowedTargets = [],
  upstreamMap = {},
  predictions = [],
  boundaryWarnings = [],
  intelItems: _intelItems = [],
  graphState: propGraphState = null,
}: ComposeActionProposalModalProps) {
  const { emit, subscribe } = useGameWebSocket();

  const [localGraphState, setLocalGraphState] = useState<GraphStatePayload | null>(propGraphState);
  const [atomicChanges, setAtomicChanges] = useState<AtomicChange[]>(initialAtomicChanges);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const [activeStageId, setActiveStageId] = useState<string>("req");

  useEffect(() => {
    if (propGraphState) {
      setLocalGraphState(propGraphState);
    }
  }, [propGraphState]);

  const graphState = propGraphState || localGraphState;

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setAtomicChanges(initialAtomicChanges);
      setSelectedCompId(null);
      setHoveredCompId(null);
    }
  }, [isOpen, initialAtomicChanges]);

  // Request graph state on open if not already provided
  useEffect(() => {
    if (!isOpen) return;
    if (!propGraphState && !localGraphState) {
      emit("graph:state_request", { phase_id: currentPhase });
    }
    const unsub = subscribe("graph:state", (data: GraphStatePayload) => {
      setLocalGraphState(data);
    });
    return unsub;
  }, [isOpen, currentPhase, propGraphState, localGraphState, emit, subscribe]);

  // Determine active phase stage ID (Phase 0 is the introduction phase; skipped for stage calculation to Phase 1: 'req')
  const phaseStageId = useMemo(() => {
    if (!graphState?.stages) return "req";
    const effectivePhase = currentPhase === 0 ? 1 : currentPhase;
    const st = graphState.stages.find((s) => s.phase_id === effectivePhase);
    return st ? st.id : "req";
  }, [graphState, currentPhase]);

  // Default active stage tab
  useEffect(() => {
    if (isOpen && phaseStageId) {
      setActiveStageId(phaseStageId);
    }
  }, [isOpen, phaseStageId]);

  // Map of all components by ID across stages
  const allComponentsMap = useMemo(() => {
    const map = new Map<string, ComponentData>();
    if (!graphState?.technical) return map;
    Object.values(graphState.technical).forEach((tech) => {
      (tech.components || []).forEach((c) => {
        map.set(c.id, c);
      });
    });
    return map;
  }, [graphState]);

  // Map predictions by target ID
  const predictionMap = useMemo(() => {
    const map = new Map<string, (typeof predictions)[0]>();
    predictions.forEach((p) => {
      map.set(p.target, p);
    });
    return map;
  }, [predictions]);

  // Components and edges for currently active stage
  const currentStageTechnical = useMemo(() => {
    if (!graphState?.technical || !graphState.technical[activeStageId]) {
      return { components: [], edges: [] };
    }
    const tech = graphState.technical[activeStageId];

    // Filter components:
    // For 'gov', always viewable & editable.
    // For lifecycle stage, only allow components in allowedTargets (if allowedTargets is loaded)
    const filteredComponents = tech.components.filter((c) => {
      if (activeStageId === "gov") return true;
      if (allowedTargets.length > 0) {
        return allowedTargets.includes(c.id);
      }
      return true;
    });

    const compIds = new Set(filteredComponents.map((c) => c.id));
    const filteredEdges = tech.edges.filter((e) => compIds.has(e.from_id) && compIds.has(e.to_id));

    return { components: filteredComponents, edges: filteredEdges };
  }, [graphState, activeStageId, allowedTargets]);

  // Predecessor nodes for dependency highlighting
  const activeHighlightedPredecessors = useMemo(() => {
    const target = hoveredCompId || selectedCompId;
    if (!target) return new Set<string>();
    const list = upstreamMap[target] || [];
    return new Set<string>(list);
  }, [hoveredCompId, selectedCompId, upstreamMap]);

  // Helper to check upstream uncertainty (fog of war)
  const isUpstreamUncertain = useCallback(
    (compId: string): { uncertain: boolean; unknownNodes: string[] } => {
      const pred = predictionMap.get(compId);
      if (pred && pred.upstream_uncertain) {
        return { uncertain: true, unknownNodes: pred.upstream_uncertain_nodes || [] };
      }
      const predecessors = upstreamMap[compId] || [];
      const unknownNodes = predecessors.filter((pid) => {
        const c = allComponentsMap.get(pid);
        return !c || c.knowledge === "unknown";
      });
      return { uncertain: unknownNodes.length > 0, unknownNodes };
    },
    [predictionMap, upstreamMap, allComponentsMap]
  );

  // Slot handlers
  const handleToggleSlotted = (targetId: string) => {
    const existingIndex = atomicChanges.findIndex((c) => c.target === targetId);
    if (existingIndex >= 0) {
      setAtomicChanges((prev) => prev.filter((_, idx) => idx !== existingIndex));
      return;
    }

    if (atomicChanges.length >= MAX_ATOMIC_CHANGES) {
      return;
    }

    const comp = allComponentsMap.get(targetId);
    const curLevel = comp?.nominal ?? 1;
    const nextLevel = getNextAllowedLevel(curLevel, comp?.allowed_levels);
    if (nextLevel === null) {
      return;
    }

    setAtomicChanges((prev) => [...prev, { target: targetId, kind: "raise_to", value: nextLevel }]);
  };

  const handleRemoveSlot = (index: number) => {
    setAtomicChanges((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleConfirm = () => {
    onConfirmProposal(atomicChanges);
    onClose();
  };

  const selectedCompData = selectedCompId ? allComponentsMap.get(selectedCompId) : null;
  const isSelectedSlotted = selectedCompId ? atomicChanges.some((c) => c.target === selectedCompId) : false;
  const selectedNextLevel = selectedCompData ? getNextAllowedLevel(selectedCompData.nominal ?? 1, selectedCompData.allowed_levels) : null;
  const selectedUpstreamStatus = selectedCompId ? isUpstreamUncertain(selectedCompId) : { uncertain: false, unknownNodes: [] };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <DialogBackdrop className={styles.backdrop} />

      <div className={styles.dialogWrapper}>
        <DialogPanel className={styles.modalContainer}>
          {/* ── Modal Header ── */}
          <div className={styles.modalHeader}>
            <div className={styles.headerTitleGroup}>
              <Icon icon="ph:git-merge-bold" style={{ fontSize: "1.4rem" }} />
              <div>
                <h3 className={styles.headerTitle}>Compose Action Proposal</h3>
                <p className={styles.headerSubtitle}>
                  Configure up to 3 atomic improvements to the MLOps architecture
                </p>
              </div>
            </div>

            <div className="d-flex align-items-center gap-3">
              <div
                className={`${styles.slotsIndicator} ${
                  atomicChanges.length === MAX_ATOMIC_CHANGES ? styles.slotsFull : ""
                }`}
              >
                <Icon icon="ph:cpu-bold" />
                <span>
                  {atomicChanges.length} / {MAX_ATOMIC_CHANGES} Slots Configured
                </span>
              </div>

              <button
                type="button"
                className={styles.closeBtn}
                onClick={onClose}
                aria-label="Close compose modal"
              >
                <Icon icon="ph:x-bold" />
              </button>
            </div>
          </div>

          {/* ── Stage Tabs Bar ── */}
          <div className={styles.stageTabsBar}>
            {(graphState?.stages || []).map((stage) => {
              const isGov = stage.id === "gov";
              const isActivePhase = stage.id === phaseStageId;
              const isAllowed = isGov || isActivePhase;
              const isSelected = activeStageId === stage.id;

              return (
                <button
                  key={stage.id}
                  type="button"
                  disabled={!isAllowed}
                  onClick={() => {
                    if (isAllowed) {
                      setActiveStageId(stage.id);
                      setSelectedCompId(null);
                    }
                  }}
                  className={`${styles.stageTab} ${isSelected ? styles.stageTabActive : ""} ${
                    !isAllowed ? styles.stageTabLocked : ""
                  }`}
                  title={!isAllowed ? `Stage locked (active in phase ${stage.phase_id})` : stage.name}
                >
                  <Icon icon={isGov ? "ph:shield-check-bold" : !isAllowed ? "ph:lock-bold" : "ph:cube-bold"} />
                  <span>{stage.name}</span>
                  {isActivePhase && <span className={styles.stageBadgeActive}>Active Phase</span>}
                  {isGov && <span className={styles.stageBadgeGov}>Always Accessible</span>}
                </button>
              );
            })}
          </div>

          {/* ── Split Body ── */}
          <div className={styles.modalBody}>
            {/* Left: Graph Canvas Viewport */}
            <div className={styles.canvasArea}>
              <div className={styles.canvasToolbar}>
                <div className={styles.canvasLegend}>
                  <div className={styles.legendItem}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        border: "1.5px dashed #94a3b8",
                        background: "#f8fafc",
                        display: "inline-block",
                        borderRadius: 3,
                      }}
                    />
                    <span>Fog of War</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        border: "1.5px solid #16a34a",
                        background: "#dcfce7",
                        display: "inline-block",
                        borderRadius: 3,
                      }}
                    />
                    <span>Satisfied</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        border: "1.5px solid #ea580c",
                        background: "#ffedd5",
                        display: "inline-block",
                        borderRadius: 3,
                      }}
                    />
                    <span>Bottlenecked</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        border: "2px solid var(--primary-bg)",
                        background: "#e0f2fe",
                        display: "inline-block",
                        borderRadius: 3,
                      }}
                    />
                    <span>⚡ Proposed Upgrade</span>
                  </div>
                </div>

                <span style={{ fontSize: "0.74rem", color: "#64748b" }}>
                  Showing {currentStageTechnical.components.length} relevant components
                </span>
              </div>

              {/* SVG Topology Canvas */}
              <div className={styles.canvasBox}>
                {(() => {
                  if (!graphState) {
                    return (
                      <div className="d-flex flex-column align-items-center justify-content-center p-5 text-muted h-100">
                        <div
                          className="spinner-border mb-3"
                          role="status"
                          style={{ width: "2.5rem", height: "2.5rem", color: "var(--primary-bg)" }}
                        >
                          <span className="visually-hidden">Loading...</span>
                        </div>
                        <div className="fw-semibold" style={{ fontSize: "0.88rem" }}>
                          Loading MLOps architecture...
                        </div>
                      </div>
                    );
                  }

                  const comps = currentStageTechnical.components;
                  const edges = currentStageTechnical.edges;
                  if (comps.length === 0) {
                    return (
                      <div className="text-center p-4 text-muted">
                        <Icon icon="ph:info-bold" style={{ fontSize: "2rem" }} className="mb-2" />
                        <div>No editable components in this stage for current challenge.</div>
                      </div>
                    );
                  }

                  const xs = comps.flatMap((c) => (c.layout ? [c.layout.x] : []));
                  const ys = comps.flatMap((c) => (c.layout ? [c.layout.y] : []));
                  const pad = 40;
                  const svgW = Math.max(500, (xs.length > 0 ? Math.max(...xs) : 400) + BOX_W / 2 + pad * 2);
                  const svgH = Math.max(350, (ys.length > 0 ? Math.max(...ys) : 300) + BOX_H / 2 + pad * 2);

                  const compById = Object.fromEntries(comps.map((c) => [c.id, c]));

                  return (
                    <svg
                      width={svgW}
                      height={svgH}
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      style={{ display: "block", maxWidth: "100%", maxHeight: "100%", margin: "0 auto" }}
                    >
                      {/* SVG Pipeline Edges */}
                      {edges.map((e) => {
                        const from = compById[e.from_id];
                        const to = compById[e.to_id];
                        if (!from?.layout || !to?.layout) return null;

                        const [ax, ay, bx, by] = edgeEnds(from.layout.x, from.layout.y, to.layout.x, to.layout.y);
                        const isPredecessorLine =
                          activeHighlightedPredecessors.has(e.from_id) &&
                          (selectedCompId === e.to_id || hoveredCompId === e.to_id);
                        const isFromUnknown = from.knowledge === "unknown";

                        let color = "#94a3b8";
                        if (isPredecessorLine) {
                          color = isFromUnknown ? "#f59e0b" : "var(--primary-bg)";
                        } else if (e.knowledge !== "unknown") {
                          color = e.level === 0 ? "#dc3545" : e.level && e.level >= 3 ? "#16a34a" : "#ea580c";
                        }

                        return (
                          <g key={e.id}>
                            <defs>
                              <marker
                                id={`arr-${e.id}`}
                                markerWidth="6"
                                markerHeight="6"
                                refX="5"
                                refY="3"
                                orient="auto"
                              >
                                <path d="M0,0 L0,6 L6,3 z" fill={color} />
                              </marker>
                            </defs>
                            <line
                              x1={ax}
                              y1={ay}
                              x2={bx}
                              y2={by}
                              stroke={color}
                              strokeWidth={isPredecessorLine ? 2.5 : 1.5}
                              strokeDasharray={isFromUnknown || e.knowledge === "unknown" ? "4 3" : undefined}
                              markerEnd={`url(#arr-${e.id})`}
                            />
                          </g>
                        );
                      })}

                      {/* SVG Component Nodes */}
                      {comps.map((c) => {
                        if (!c.layout) return null;
                        const { x, y } = c.layout;
                        const isSelected = selectedCompId === c.id;
                        const isSlotted = atomicChanges.some((change) => change.target === c.id);
                        const isPredecessor = activeHighlightedPredecessors.has(c.id);
                        const isUnknown = c.knowledge === "unknown";
                        const upstreamCheck = isUpstreamUncertain(c.id);

                        let bg = "#ffffff";
                        let border = "#cbd5e1";

                        if (isSlotted) {
                          bg = "#e0f2fe";
                          border = "var(--primary-bg)";
                        } else if (isSelected) {
                          bg = "#f0f7fa";
                          border = "var(--primary-bg)";
                        } else if (isPredecessor) {
                          bg = isUnknown ? "#fef3c7" : "#f1f5f9";
                          border = isUnknown ? "#f59e0b" : "var(--primary-bg)";
                        } else if (isUnknown) {
                          bg = "#f8fafc";
                          border = "#94a3b8";
                        } else if (c.capped_by) {
                          bg = "#fff7ed";
                          border = "#ea580c";
                        }

                        const lines = wrapLabel(c.name || c.id, 16);

                        return (
                          <g
                            key={c.id}
                            transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2})`}
                            style={{ cursor: "pointer" }}
                            onClick={() => setSelectedCompId(isSelected ? null : c.id)}
                            onMouseEnter={() => setHoveredCompId(c.id)}
                            onMouseLeave={() => setHoveredCompId(null)}
                          >
                            {/* Node Background */}
                            <rect
                              width={BOX_W}
                              height={BOX_H}
                              rx={8}
                              fill={bg}
                              stroke={border}
                              strokeWidth={isSlotted ? 2.5 : isSelected ? 2 : 1.5}
                              strokeDasharray={isUnknown ? "4 3" : undefined}
                            />

                            {/* Slotted Badge */}
                            {isSlotted && (
                              <g transform={`translate(${BOX_W - 28}, 4)`}>
                                <circle cx="10" cy="10" r="10" fill="var(--primary-bg)" />
                                <text
                                  x="10"
                                  y="14"
                                  fontSize="10"
                                  textAnchor="middle"
                                  fill="#ffffff"
                                  fontWeight="bold"
                                >
                                  ⚡
                                </text>
                              </g>
                            )}

                            {/* Node Title */}
                            {lines.map((line, i) => (
                              <text
                                key={i}
                                x={12}
                                y={18 + i * 14}
                                fill={isUnknown ? "#64748b" : "#0f172a"}
                                fontSize="11"
                                fontWeight={isSelected || isSlotted ? "700" : "600"}
                              >
                                {line}
                              </text>
                            ))}

                            {/* Status Subtitle / Level Badge */}
                            {isUnknown ? (
                              <g transform="translate(12, 46)">
                                <text x="0" y="0" fill="#64748b" fontSize="9" fontWeight="500">
                                  🌫 Unknown (Fog of War)
                                </text>
                              </g>
                            ) : upstreamCheck.uncertain ? (
                              <g transform="translate(12, 46)">
                                <text x="0" y="0" fill="#b45309" fontSize="9" fontWeight="600">
                                  ❓ Status Uncertain
                                </text>
                              </g>
                            ) : c.capped_by ? (
                              <g transform="translate(12, 46)">
                                <text x="0" y="0" fill="#c2410c" fontSize="9" fontWeight="600">
                                  ⛓ Capped: {formatLevelCap(c.effective)}
                                </text>
                              </g>
                            ) : (
                              <g transform="translate(12, 46)">
                                <text x="0" y="0" fill="#16a34a" fontSize="9" fontWeight="600">
                                  {formatLevelCap(c.nominal ?? 1)}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  );
                })()}
              </div>
            </div>

            {/* Right: Inspector & Slots Panel */}
            <div className={styles.sidebarArea}>
              <div className={styles.sidebarContent}>
                {/* Selected Component Inspector */}
                {selectedCompData ? (
                  <div className={styles.inspectorCard}>
                    <div className={styles.inspectorHeader}>
                      <span className={styles.inspectorTitle}>
                        <Icon icon="ph:cube-bold" className="me-1" />
                        {selectedCompData.name}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-secondary text-decoration-none p-0"
                        onClick={() => setSelectedCompId(null)}
                      >
                        ✕
                      </button>
                    </div>

                    <div className={styles.inspectorBody}>
                      <div className={styles.propRow}>
                        <span className={styles.propLabel}>Component ID:</span>
                        <span className={styles.propVal}>{selectedCompData.id}</span>
                      </div>

                      {selectedCompData.knowledge === "unknown" ? (
                        <div className={styles.fogBanner}>
                          <Icon icon="ph:cloud-fog-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Shrouded in Fog of War:</strong> This component has not been analyzed or
                            inspected yet. Its current maturity is unconfirmed.
                          </div>
                        </div>
                      ) : (
                        <div className={styles.propRow}>
                          <span className={styles.propLabel}>Current Status:</span>
                          <span className={styles.propVal}>
                            {formatLevelCap(selectedCompData.nominal ?? 1)}
                          </span>
                        </div>
                      )}

                      {/* Pipeline Dependency / Functional Level Analysis */}
                      {selectedUpstreamStatus.uncertain ? (
                        <div className={styles.uncertainBanner}>
                          <Icon icon="ph:question-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Real Functional Status Uncertain:</strong> Upstream pipeline dependency (
                            <em>{selectedUpstreamStatus.unknownNodes.join(", ")}</em>) is in the Fog of War. You
                            cannot verify the real functionality of this component until upstream nodes are
                            inspected.
                          </div>
                        </div>
                      ) : selectedCompData.capped_by &&
                        selectedCompData.effective !== undefined &&
                        selectedCompData.nominal !== undefined &&
                        selectedCompData.effective < selectedCompData.nominal ? (
                        <div className={styles.bottleneckBanner}>
                          <Icon icon="ph:link-break-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Held Back by Bottleneck:</strong> Effective functionality is capped at{" "}
                            <strong>{formatLevel(selectedCompData.effective)}</strong> by <strong>{selectedCompData.capped_by}</strong>. Raising
                            this component alone changes nothing until that bottleneck is upgraded.
                          </div>
                        </div>
                      ) : selectedCompData.knowledge !== "unknown" ? (
                        <div className={styles.satisfiedBanner}>
                          <Icon icon="ph:check-circle-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Dependencies Satisfied:</strong> Runs at full functional capacity (
                            {formatLevelCap(selectedCompData.effective ?? selectedCompData.nominal ?? 1)}).
                          </div>
                        </div>
                      ) : null}

                      {/* Slotted Action Control */}
                      {isSelectedSlotted ? (
                        <div className="d-flex flex-column gap-2 mt-2">
                          <div
                            className="p-2 rounded"
                            style={{ background: "#e0f2fe", border: "1px solid #bae6fd", fontSize: "0.8rem" }}
                          >
                            <span className="fw-bold" style={{ color: "var(--primary-bg)" }}>
                              ⚡ Slotted for Improvement:
                            </span>
                            <div className="mt-1">
                              Will advance from <strong>{formatLevelCap(selectedCompData.nominal ?? 1)}</strong> to{" "}
                              <strong>{formatLevelCap(selectedNextLevel)}</strong>
                            </div>
                          </div>
                          <button
                            type="button"
                            className={styles.actionButton}
                            style={{ background: "#dc2626", borderColor: "#b91c1c" }}
                            onClick={() => handleToggleSlotted(selectedCompData.id)}
                          >
                            <Icon icon="ph:trash-bold" />
                            <span>Remove from Action Proposal</span>
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2">
                          {selectedNextLevel === null ? (
                            <button type="button" disabled className={styles.actionButton}>
                              <span>Already at Maximum Maturity ({formatLevelCap(4)})</span>
                            </button>
                          ) : atomicChanges.length >= MAX_ATOMIC_CHANGES ? (
                            <button type="button" disabled className={styles.actionButton}>
                              <span>Slots Full (3/3 Configured)</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() => handleToggleSlotted(selectedCompData.id)}
                            >
                              <Icon icon="ph:plus-circle-bold" />
                              <span>
                                Advance to {formatLevelCap(selectedNextLevel)}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyInspector}>
                    <Icon icon="ph:cursor-click-bold" className={styles.emptyIcon} />
                    <h5 className="fw-bold mb-1" style={{ fontSize: "0.92rem", color: "#1e293b" }}>
                      Select a Node on the Canvas
                    </h5>
                    <p className="mb-0" style={{ fontSize: "0.78rem" }}>
                      Click on any visible component to inspect its maturity, analyze upstream dependencies, or slot
                      a +1 level upgrade.
                    </p>
                  </div>
                )}

                {/* Proposal Slots (1 to 3) */}
                <div className={styles.slotsSection}>
                  <div className={styles.slotsSectionHeader}>
                    <h4 className={styles.slotsTitle}>
                      <Icon icon="ph:stack-bold" />
                      <span>Configured Atomic Changes</span>
                    </h4>
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                      {atomicChanges.length} of {MAX_ATOMIC_CHANGES} used
                    </span>
                  </div>

                  {Array.from({ length: MAX_ATOMIC_CHANGES }, (_, idx) => {
                    const change = atomicChanges[idx];
                    if (change) {
                      const comp = allComponentsMap.get(change.target);
                      const cur = comp?.nominal ?? 1;
                      const next = change.value ?? cur + 1;
                      return (
                        <div key={idx} className={`${styles.slotCard} ${styles.slotCardSlotted}`}>
                          <div className={styles.slotHeader}>
                            <div className="d-flex align-items-center gap-2">
                              <span className={styles.slotIndex}>Slot {idx + 1}</span>
                              <span className={styles.slotNodeName}>{comp?.name || change.target}</span>
                            </div>
                            <button
                              type="button"
                              className={styles.slotRemoveBtn}
                              onClick={() => handleRemoveSlot(idx)}
                              title="Remove change"
                            >
                              <Icon icon="ph:x-bold" />
                              <span>Remove</span>
                            </button>
                          </div>
                          <div className={styles.slotChangeInfo}>
                            <Icon icon="ph:arrow-fat-line-up-bold" style={{ color: "var(--primary-bg)" }} />
                            <span>
                              Advance status from <strong>{formatLevelCap(cur)}</strong> ➔{" "}
                              <strong>{formatLevelCap(next)}</strong>
                            </span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={idx} className={`${styles.slotCard} ${styles.slotCardEmpty}`}>
                        <Icon icon="ph:plus-dashed-bold" className="me-1" />
                        <span>Slot {idx + 1}: Empty (Click a component to slot an upgrade)</span>
                      </div>
                    );
                  })}
                </div>

                {/* Stakeholder Boundary Warnings Preview */}
                {boundaryWarnings.length > 0 && (
                  <div
                    className="p-2 rounded"
                    style={{ background: "#fef2f2", border: "1px solid #fee2e2", fontSize: "0.78rem" }}
                  >
                    <div className="fw-bold text-danger mb-1 d-flex align-items-center gap-1">
                      <Icon icon="ph:warning-octagon-bold" />
                      <span>Boundary Constraint Warnings:</span>
                    </div>
                    {boundaryWarnings.map((w, i) => (
                      <div key={i} className="text-danger small">
                        • {w.line || `Constraint violation on ${w.target_name || w.item_id}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Modal Footer ── */}
          <div className={styles.modalFooter}>
            <div className={styles.footerLeft}>
              <Icon icon="ph:info-bold" />
              <span>
                {atomicChanges.length === 0
                  ? "Select at least 1 atomic improvement to confirm proposal."
                  : `${atomicChanges.length} atomic change${
                      atomicChanges.length > 1 ? "s" : ""
                    } will be evaluated by the stakeholders.`}
              </span>
            </div>

            <div className={styles.footerRight}>
              <button type="button" className={styles.secondaryBtn} onClick={onClose}>
                Discard
              </button>

              <button
                type="button"
                className={styles.actionButton}
                style={{ width: "auto", minWidth: 220 }}
                disabled={atomicChanges.length === 0}
                onClick={handleConfirm}
              >
                <Icon icon="ph:check-bold" />
                <span>Confirm Action Proposal ({atomicChanges.length})</span>
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
