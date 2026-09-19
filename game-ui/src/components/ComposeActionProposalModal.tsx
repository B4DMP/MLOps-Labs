import { useState, useEffect, useMemo, useCallback } from "react";
import { Icon } from "@iconify/react";
import styles from "./ComposeActionProposalModal.module.css";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import type { Stakeholder } from "./StakeholderProvider";

export interface AtomicChange {
  target: string;
  kind?: "raise_to" | "set_trigger" | "set_attr" | string;
  value?: any;
  trigger?: string;
  attr?: string;
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
  attributes?: Record<string, { values: string[]; initial: string }>;
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
  allowed_levels?: number[];
  allowed_triggers?: string[];
  slack?: number;
  capped_by?: string;
  story?: string;
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

export function formatTrigger(trigger: string | undefined | null): string {
  if (!trigger) return "none";
  return trigger.replace(/_/g, " ");
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
  boundaryWarnings: _boundaryWarnings = [],
  intelItems: _intelItems = [],
  graphState: propGraphState = null,
}: ComposeActionProposalModalProps) {
  const { emit, subscribe } = useGameWebSocket();

  const [localGraphState, setLocalGraphState] = useState<GraphStatePayload | null>(propGraphState);
  const [atomicChanges, setAtomicChanges] = useState<AtomicChange[]>(initialAtomicChanges);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [activeStageId, setActiveStageId] = useState<string>("req");

  // Selected edge form state
  const [selectedEdgeTargetLevel, setSelectedEdgeTargetLevel] = useState<number | null>(null);
  const [selectedEdgeTargetTrigger, setSelectedEdgeTargetTrigger] = useState<string | null>(null);

  // Selected component form state
  const [selectedCompTargetLevel, setSelectedCompTargetLevel] = useState<number | null>(null);

  useEffect(() => {
    if (propGraphState) {
      setLocalGraphState(propGraphState);
    }
  }, [propGraphState]);

  const graphState = localGraphState || propGraphState;

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setAtomicChanges(initialAtomicChanges);
      setSelectedCompId(null);
      setSelectedEdgeId(null);
      setHoveredCompId(null);
      setHoveredEdgeId(null);
    }
  }, [isOpen, initialAtomicChanges]);

  // Request graph state on open and listen to live updates
  useEffect(() => {
    if (!isOpen) return;
    emit("graph:state_request", { phase_id: currentPhase === 0 ? 1 : currentPhase });
    const unsub = subscribe("graph:state", (data: GraphStatePayload) => {
      setLocalGraphState(data);
    });
    return unsub;
  }, [isOpen, currentPhase, emit, subscribe]);

  // Determine active phase stage ID (Phase 0 maps to Phase 1: 'req')
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

  // Map of all edges by ID across stages
  const allEdgesMap = useMemo(() => {
    const map = new Map<string, EdgeData>();
    if (!graphState?.technical) return map;
    Object.values(graphState.technical).forEach((tech) => {
      (tech.edges || []).forEach((e) => {
        map.set(e.id, e);
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

  // All components and edges for currently active stage (all are visible to player)
  const currentStageTechnical = useMemo(() => {
    if (!graphState?.technical || !graphState.technical[activeStageId]) {
      return { components: [], edges: [] };
    }
    const tech = graphState.technical[activeStageId];
    const components = tech.components || [];
    const compIds = new Set(components.map((c) => c.id));
    const edges = (tech.edges || []).filter((e) => compIds.has(e.from_id) && compIds.has(e.to_id));
    return { components, edges };
  }, [graphState, activeStageId]);

  // Helper to determine if a node or edge can be edited in current phase/challenge
  const isTargetEditable = useCallback(
    (targetId: string, targetType: "component" | "edge", targetStageId?: string): { editable: boolean; reason?: string } => {
      const comp = allComponentsMap.get(targetId);
      const edge = allEdgesMap.get(targetId);
      const knowledge = targetType === "component" ? comp?.knowledge : edge?.knowledge;

      // 1. Undiscovered / Unknown State Guard
      if (knowledge === "unknown") {
        return {
          editable: false,
          reason: "Undiscovered. You must collect intel on this node before it becomes accessible for action proposals.",
        };
      }

      // 2. Stage / Phase check
      const sId = targetStageId || comp?.stage_id || (edge ? allComponentsMap.get(edge.to_id)?.stage_id : undefined);
      if (sId === "gov" || sId === "infra") {
        return { editable: true };
      }

      if (sId && sId !== phaseStageId) {
        const stageObj = graphState?.stages?.find((s) => s.id === sId);
        const pNum = stageObj?.phase_id ?? "?";
        return {
          editable: false,
          reason: `Associated with Phase ${pNum} (${stageObj?.name || sId}). Only nodes in Phase ${currentPhase} and Governance can be modified in this challenge.`,
        };
      }

      // 3. Challenge relevance check (if allowedTargets has targets)
      if (allowedTargets.length > 0) {
        if (targetType === "edge" && edge) {
          if (!allowedTargets.includes(edge.from_id) || !allowedTargets.includes(edge.to_id)) {
            return {
              editable: false,
              reason: "This edge is not relevant to the current challenge requirements.",
            };
          }
        } else if (targetType === "component") {
          if (!allowedTargets.includes(targetId)) {
            return {
              editable: false,
              reason: "This component is not relevant to the current challenge requirements.",
            };
          }
        }
      }

      return { editable: true };
    },
    [allComponentsMap, allEdgesMap, phaseStageId, currentPhase, graphState, allowedTargets]
  );

  // Predecessor nodes for dependency highlighting
  const activeHighlightedPredecessors = useMemo(() => {
    const target = hoveredCompId || selectedCompId;
    if (!target) return new Set<string>();
    const list = upstreamMap[target] || [];
    return new Set<string>(list);
  }, [hoveredCompId, selectedCompId, upstreamMap]);

  // Helper to check upstream uncertainty (undiscovered nodes)
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

  // Selected Edge state
  const selectedEdgeData = selectedEdgeId ? allEdgesMap.get(selectedEdgeId) : null;
  const isSelectedEdgeSlotted = selectedEdgeId ? atomicChanges.some((c) => c.target === selectedEdgeId) : false;
  const selectedEdgeChange = selectedEdgeId ? atomicChanges.find((c) => c.target === selectedEdgeId) : undefined;
  const selectedEdgeEditable = selectedEdgeId
    ? isTargetEditable(selectedEdgeId, "edge", activeStageId)
    : { editable: false };

  // Sync edge form state on selection change
  useEffect(() => {
    if (!selectedEdgeData) return;
    if (selectedEdgeChange) {
      setSelectedEdgeTargetLevel(
        typeof selectedEdgeChange.value === "number" ? selectedEdgeChange.value : selectedEdgeData.level ?? 1
      );
      setSelectedEdgeTargetTrigger(selectedEdgeChange.trigger || selectedEdgeData.trigger || "none");
    } else {
      const cur = selectedEdgeData.level ?? 1;
      const next = getNextAllowedLevel(cur, selectedEdgeData.allowed_levels) ?? cur;
      setSelectedEdgeTargetLevel(next);

      if (next >= 3) {
        const autoTrigger =
          selectedEdgeData.trigger && selectedEdgeData.trigger !== "none" && selectedEdgeData.trigger !== "manual_request"
            ? selectedEdgeData.trigger
            : selectedEdgeData.allowed_triggers?.find((t) => t !== "none" && t !== "manual_request") || "scheduled";
        setSelectedEdgeTargetTrigger(autoTrigger);
      } else if (next === 2) {
        setSelectedEdgeTargetTrigger("manual_request");
      } else {
        setSelectedEdgeTargetTrigger("none");
      }
    }
  }, [selectedEdgeId, selectedEdgeData, selectedEdgeChange]);

  // Selected Component state
  const selectedCompData = selectedCompId ? allComponentsMap.get(selectedCompId) : null;
  const isSelectedCompSlotted = selectedCompId ? atomicChanges.some((c) => c.target === selectedCompId) : false;
  const selectedCompChange = selectedCompId ? atomicChanges.find((c) => c.target === selectedCompId) : undefined;
  const selectedCompEditable = selectedCompId
    ? isTargetEditable(selectedCompId, "component", selectedCompData?.stage_id || activeStageId)
    : { editable: false };
  const selectedUpstreamStatus = selectedCompId ? isUpstreamUncertain(selectedCompId) : { uncertain: false, unknownNodes: [] };

  // Sync component form state on selection change
  useEffect(() => {
    if (!selectedCompData) return;
    if (selectedCompChange) {
      setSelectedCompTargetLevel(
        typeof selectedCompChange.value === "number" ? selectedCompChange.value : selectedCompData.nominal ?? 1
      );
    } else {
      const cur = selectedCompData.nominal ?? 1;
      const next = getNextAllowedLevel(cur, selectedCompData.allowed_levels) ?? cur;
      setSelectedCompTargetLevel(next);
    }
  }, [selectedCompId, selectedCompData, selectedCompChange]);

  // Slot handlers
  const handleSaveComponentSlot = (targetId: string, level: number) => {
    setAtomicChanges((prev) => {
      const filtered = prev.filter((c) => c.target !== targetId);
      if (filtered.length >= MAX_ATOMIC_CHANGES) return prev;
      return [...filtered, { target: targetId, kind: "raise_to", value: level }];
    });
  };

  const handleSaveEdgeSlot = (edgeId: string, level: number, trigger: string | null) => {
    setAtomicChanges((prev) => {
      const filtered = prev.filter((c) => c.target !== edgeId);
      if (filtered.length >= MAX_ATOMIC_CHANGES) return prev;
      return [
        ...filtered,
        {
          target: edgeId,
          kind: "raise_to",
          value: level,
          trigger: trigger || undefined,
        },
      ];
    });
  };

  const handleRemoveTargetSlot = (targetId: string) => {
    setAtomicChanges((prev) => prev.filter((c) => c.target !== targetId));
  };

  const handleRemoveSlot = (index: number) => {
    setAtomicChanges((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleConfirm = () => {
    onConfirmProposal(atomicChanges);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={styles.proposalContainer}>
      {/* ── Header ── */}
      <div className={styles.modalHeader}>
        <div className={styles.headerTitleGroup}>
          <Icon icon="ph:git-merge-bold" style={{ fontSize: "1.4rem" }} />
          <div>
            <h3 className={styles.headerTitle}>Compose Action Proposal</h3>
            <p className={styles.headerSubtitle}>
              Configure up to 3 atomic improvements to components or workflow edges
            </p>
          </div>
        </div>

        <div className="d-flex align-items-center gap-2">
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
            aria-label="Back to boardroom"
            title="Back to boardroom"
          >
            <Icon icon="ph:arrow-u-up-left-bold" />
            <span>Back to Boardroom</span>
          </button>
        </div>
      </div>

      {/* ── Stage Tabs Bar ── */}
      <div className={styles.stageTabsBar}>
        {(graphState?.stages || []).map((stage) => {
          const isGov = stage.id === "gov";
          const isActivePhase = stage.id === phaseStageId;
          const isSelected = activeStageId === stage.id;
          const isOtherPhase = !isGov && !isActivePhase;

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => {
                setActiveStageId(stage.id);
                setSelectedCompId(null);
                setSelectedEdgeId(null);
              }}
              className={`${styles.stageTab} ${isSelected ? styles.stageTabActive : ""}`}
              title={isOtherPhase ? `${stage.name} (Phase ${stage.phase_id} - View Only)` : stage.name}
            >
              <Icon
                icon={
                  isGov
                    ? "ph:shield-check-bold"
                    : isOtherPhase
                    ? "ph:lock-simple-bold"
                    : "ph:cube-bold"
                }
              />
              <span>{stage.name}</span>
              {isActivePhase && <span className={styles.stageBadgeActive}>Active Phase</span>}
              {isGov && <span className={styles.stageBadgeGov}>Always Accessible</span>}
              {isOtherPhase && stage.phase_id && (
                <span className={styles.stageBadgeOtherPhase}>Phase {stage.phase_id}</span>
              )}
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
                <span>Undiscovered</span>
              </div>
              <div className={styles.legendItem}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    border: "1.5px solid #cbd5e1",
                    background: "#f1f5f9",
                    display: "inline-block",
                    borderRadius: 3,
                    textAlign: "center",
                    lineHeight: "12px",
                    fontSize: "9px",
                  }}
                >
                  🔒
                </span>
                <span>Other Phase (Locked)</span>
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
                <span>⚡ Slotted Upgrade</span>
              </div>
            </div>

            <span style={{ fontSize: "0.74rem", color: "#64748b" }}>
              Showing {currentStageTechnical.components.length} components • {currentStageTechnical.edges.length} edges
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
                    <div>No components in this stage.</div>
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
                  <defs>
                    <marker id="arr-default" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
                    </marker>
                    <marker id="arr-primary" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="var(--primary-bg)" />
                    </marker>
                    <marker id="arr-success" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="#16a34a" />
                    </marker>
                    <marker id="arr-danger" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="#dc3545" />
                    </marker>
                    <marker id="arr-warning" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="#ea580c" />
                    </marker>
                    <marker id="arr-selected" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                      <path d="M0,0 L0,7 L7,3.5 z" fill="var(--primary-bg)" />
                    </marker>
                  </defs>

                  {/* SVG Pipeline Edges */}
                  {edges.map((e) => {
                    const from = compById[e.from_id];
                    const to = compById[e.to_id];
                    if (!from?.layout || !to?.layout) return null;

                    const [ax, ay, bx, by] = edgeEnds(from.layout.x, from.layout.y, to.layout.x, to.layout.y);
                    const isSelected = selectedEdgeId === e.id;
                    const isHovered = hoveredEdgeId === e.id;
                    const isSlotted = atomicChanges.some((c) => c.target === e.id);
                    const edgeEdit = isTargetEditable(e.id, "edge", activeStageId);
                    const isOtherPhase = !edgeEdit.editable && e.knowledge !== "unknown";
                    const isPredecessorLine =
                      activeHighlightedPredecessors.has(e.from_id) &&
                      (selectedCompId === e.to_id || hoveredCompId === e.to_id);
                    const isFromUnknown = from.knowledge === "unknown";

                    let color = "#94a3b8";
                    let markerId = "arr-default";

                    if (isSelected || isSlotted) {
                      color = "var(--primary-bg)";
                      markerId = "arr-primary";
                    } else if (isPredecessorLine) {
                      color = isFromUnknown ? "#f59e0b" : "var(--primary-bg)";
                      markerId = isFromUnknown ? "arr-warning" : "arr-primary";
                    } else if (isOtherPhase) {
                      color = "#cbd5e1";
                      markerId = "arr-default";
                    } else if (e.knowledge !== "unknown") {
                      if (e.level === 0) {
                        color = "#dc3545";
                        markerId = "arr-danger";
                      } else if (e.level && e.level >= 3) {
                        color = "#16a34a";
                        markerId = "arr-success";
                      } else {
                        color = "#ea580c";
                        markerId = "arr-warning";
                      }
                    }

                    const mx = (ax + bx) / 2;
                    const my = (ay + by) / 2;

                    return (
                      <g key={e.id}>
                        {/* Visible edge line */}
                        <line
                          x1={ax}
                          y1={ay}
                          x2={bx}
                          y2={by}
                          stroke={color}
                          strokeWidth={isSelected ? 3.5 : isSlotted ? 3 : isHovered ? 2.5 : isPredecessorLine ? 2.5 : 1.5}
                          strokeDasharray={isOtherPhase || isFromUnknown || e.knowledge === "unknown" ? "4 3" : undefined}
                          markerEnd={`url(#${markerId})`}
                        />

                        {/* Midpoint badge: Slotted ⚡ or Locked 🔒 */}
                        {isSlotted && (
                          <g transform={`translate(${mx - 10}, ${my - 10})`} style={{ pointerEvents: "none" }}>
                            <circle cx="10" cy="10" r="10" fill="var(--primary-bg)" stroke="#ffffff" strokeWidth={1.5} />
                            <text x="10" y="14" fontSize="10" textAnchor="middle" fill="#ffffff" fontWeight="bold">
                              ⚡
                            </text>
                          </g>
                        )}
                        {isOtherPhase && !isSlotted && (
                          <g transform={`translate(${mx - 8}, ${my - 8})`} style={{ pointerEvents: "none" }}>
                            <circle cx="8" cy="8" r="8" fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                            <text x="8" y="11" fontSize="9" textAnchor="middle">
                              🔒
                            </text>
                          </g>
                        )}

                        {/* Wide transparent hit area for easy clicking */}
                        <line
                          x1={ax}
                          y1={ay}
                          x2={bx}
                          y2={by}
                          stroke="transparent"
                          strokeWidth={18}
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedEdgeId(isSelected ? null : e.id);
                            setSelectedCompId(null);
                          }}
                          onMouseEnter={() => setHoveredEdgeId(e.id)}
                          onMouseLeave={() => setHoveredEdgeId(null)}
                        >
                          <title>
                            {`Edge: ${from.name} ➔ ${to.name} (${e.id})\nLevel: ${formatLevel(e.level)}\nTrigger: ${
                              e.trigger || "none"
                            }`}
                          </title>
                        </line>
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
                    const compEdit = isTargetEditable(c.id, "component", c.stage_id || activeStageId);
                    const isOtherPhase = !compEdit.editable && !isUnknown;
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
                    } else if (isOtherPhase) {
                      bg = "#f8fafc";
                      border = "#cbd5e1";
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
                        onClick={() => {
                          setSelectedCompId(isSelected ? null : c.id);
                          setSelectedEdgeId(null);
                        }}
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
                          strokeDasharray={isOtherPhase || isUnknown ? "4 3" : undefined}
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

                        {/* Other Phase Lock Badge */}
                        {isOtherPhase && !isSlotted && (
                          <g transform={`translate(${BOX_W - 24}, 4)`}>
                            <circle cx="8" cy="8" r="8" fill="#f1f5f9" stroke="#cbd5e1" />
                            <text x="8" y="11" fontSize="9" textAnchor="middle">
                              🔒
                            </text>
                          </g>
                        )}

                        {/* Node Title */}
                        {lines.map((line, i) => (
                          <text
                            key={i}
                            x={12}
                            y={18 + i * 14}
                            fill={isUnknown || isOtherPhase ? "#64748b" : "#0f172a"}
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
                              🔍 Undiscovered
                            </text>
                          </g>
                        ) : isOtherPhase ? (
                          <g transform="translate(12, 46)">
                            <text x="0" y="0" fill="#64748b" fontSize="9" fontWeight="600">
                              🔒 Phase Locked ({formatLevelCap(c.nominal ?? 1)})
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
            {/* ── Selected EDGE Inspector ── */}
            {selectedEdgeData ? (
              <div className={styles.inspectorCard}>
                <div className={styles.inspectorHeader}>
                  <div className="d-flex align-items-center gap-2">
                    <Icon icon="ph:flow-arrow-bold" style={{ fontSize: "1.1rem", color: "var(--primary-bg)" }} />
                    <span className={styles.inspectorTitle}>
                      {allComponentsMap.get(selectedEdgeData.from_id)?.name || selectedEdgeData.from_id} ➔{" "}
                      {allComponentsMap.get(selectedEdgeData.to_id)?.name || selectedEdgeData.to_id}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-secondary text-decoration-none p-0"
                    onClick={() => setSelectedEdgeId(null)}
                  >
                    ✕
                  </button>
                </div>

                <div className={styles.inspectorBody}>
                  <div className={styles.propRow}>
                    <span className={styles.propLabel}>Workflow ID:</span>
                    <span className={styles.propVal}>{selectedEdgeData.id}</span>
                  </div>

                  <div className={styles.propRow}>
                    <span className={styles.propLabel}>Type & Slack:</span>
                    <div className="d-flex align-items-center gap-1">
                      <span className={styles.edgeBadgeKind}>{selectedEdgeData.kind}</span>
                      <span className="badge bg-light text-dark border">
                        {selectedEdgeData.slack === 1 ? "Soft (Slack: 1)" : "Hard (Slack: 0)"}
                      </span>
                    </div>
                  </div>

                  {/* Undiscovered Guard */}
                  {selectedEdgeData.knowledge === "unknown" ? (
                    <div className={styles.fogBanner}>
                      <Icon icon="ph:eye-slash-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                      <div>
                        <strong>Undiscovered:</strong> You have not collected intel on this workflow edge
                        yet. Its current maturity and trigger are unconfirmed, so no improvements can be proposed.
                      </div>
                    </div>
                  ) : !selectedEdgeEditable.editable ? (
                    /* Other Phase Locked Guard */
                    <div className={styles.lockedPhaseBanner}>
                      <Icon icon="ph:lock-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                      <div>
                        <strong>Phase Locked:</strong> {selectedEdgeEditable.reason}
                      </div>
                    </div>
                  ) : (
                    /* Editable Edge Controls */
                    <>
                      <div className={styles.propRow}>
                        <span className={styles.propLabel}>Current Status:</span>
                        <span className={styles.propVal}>
                          {formatLevelCap(selectedEdgeData.level ?? 1)}
                        </span>
                      </div>

                      <div className={styles.propRow}>
                        <span className={styles.propLabel}>Current Trigger:</span>
                        <span className={styles.propVal}>
                          <code>{selectedEdgeData.trigger || "none"}</code>
                        </span>
                      </div>

                      {/* Edge Edit Form */}
                      <div className="mt-2 pt-2 border-top d-flex flex-column gap-3">
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>
                            <Icon icon="ph:arrow-fat-line-up-bold" />
                            <span>Target Maturity Level:</span>
                          </label>
                          <select
                            className={styles.selectInput}
                            value={selectedEdgeTargetLevel ?? (selectedEdgeData.level ?? 1)}
                            onChange={(e) => {
                              const newLvl = Number(e.target.value);
                              setSelectedEdgeTargetLevel(newLvl);
                              if (newLvl >= 3) {
                                const defaultAuto =
                                  selectedEdgeData.allowed_triggers?.find(
                                    (t) => t !== "none" && t !== "manual_request"
                                  ) || "scheduled";
                                setSelectedEdgeTargetTrigger(defaultAuto);
                              } else if (newLvl === 2) {
                                setSelectedEdgeTargetTrigger("manual_request");
                              } else {
                                setSelectedEdgeTargetTrigger("none");
                              }
                            }}
                          >
                            {(selectedEdgeData.allowed_levels && selectedEdgeData.allowed_levels.length > 0
                              ? selectedEdgeData.allowed_levels
                              : [0, 1, 2, 3, 4]
                            ).map((lvl) => (
                              <option key={lvl} value={lvl}>
                                Level {lvl} ({formatLevelCap(lvl)})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Edge Trigger Selector (Automatic triggers available at Level >= 3) */}
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>
                            <Icon icon="ph:lightning-bold" />
                            <span>Trigger Mode:</span>
                          </label>
                          {(selectedEdgeTargetLevel ?? (selectedEdgeData.level ?? 1)) >= 3 ? (
                            <select
                              className={styles.selectInput}
                              value={selectedEdgeTargetTrigger || "scheduled"}
                              onChange={(e) => setSelectedEdgeTargetTrigger(e.target.value)}
                            >
                              {(selectedEdgeData.allowed_triggers || ["scheduled", "on_commit", "on_data_arrival"])
                                .filter((t) => t !== "none" && t !== "manual_request")
                                .map((t) => (
                                  <option key={t} value={t}>
                                    {formatTrigger(t)} ({t})
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              disabled
                              className={styles.selectInput}
                              value={
                                (selectedEdgeTargetLevel ?? (selectedEdgeData.level ?? 1)) === 2
                                  ? "manual_request (automatic for Manual)"
                                  : "none (automatic for Absent/Broken)"
                              }
                            />
                          )}
                        </div>
                      </div>

                      {/* Slotted Edge Control */}
                      {isSelectedEdgeSlotted ? (
                        <div className="d-flex flex-column gap-2 mt-2">
                          <div
                            className="p-2 rounded"
                            style={{ background: "#e0f2fe", border: "1px solid #bae6fd", fontSize: "0.8rem" }}
                          >
                            <span className="fw-bold" style={{ color: "var(--primary-bg)" }}>
                              ⚡ Slotted in Action Proposal:
                            </span>
                            <div className="mt-1">
                              Maturity: <strong>{formatLevelCap(selectedEdgeChange?.value)}</strong>
                              {selectedEdgeChange?.trigger && (
                                <>
                                  {" "}• Trigger: <code>{selectedEdgeChange.trigger}</code>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="d-flex gap-2">
                            <button
                              type="button"
                              className={styles.actionButton}
                              style={{ width: "auto", flex: 1 }}
                              onClick={() =>
                                handleSaveEdgeSlot(
                                  selectedEdgeData.id,
                                  selectedEdgeTargetLevel ?? (selectedEdgeData.level ?? 1),
                                  selectedEdgeTargetTrigger
                                )
                              }
                            >
                              <Icon icon="ph:arrows-clockwise-bold" />
                              <span>Update Slot</span>
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              style={{ background: "#dc2626", borderColor: "#b91c1c", width: "auto", flex: 1 }}
                              onClick={() => handleRemoveTargetSlot(selectedEdgeData.id)}
                            >
                              <Icon icon="ph:trash-bold" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2">
                          {atomicChanges.length >= MAX_ATOMIC_CHANGES ? (
                            <button type="button" disabled className={styles.actionButton}>
                              <span>Slots Full (3/3 Configured)</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() =>
                                handleSaveEdgeSlot(
                                  selectedEdgeData.id,
                                  selectedEdgeTargetLevel ?? (selectedEdgeData.level ?? 1),
                                  selectedEdgeTargetTrigger
                                )
                              }
                            >
                              <Icon icon="ph:plus-circle-bold" />
                              <span>
                                Slot Edge Upgrade ({formatLevelCap(selectedEdgeTargetLevel)})
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : selectedCompData ? (
              /* ── Selected COMPONENT Inspector ── */
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

                  {/* Undiscovered Guard */}
                  {selectedCompData.knowledge === "unknown" ? (
                    <div className={styles.fogBanner}>
                      <Icon icon="ph:eye-slash-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                      <div>
                        <strong>Undiscovered:</strong> You have not collected intel on this component
                        yet. Its current maturity is unconfirmed, so no improvements can be proposed.
                      </div>
                    </div>
                  ) : !selectedCompEditable.editable ? (
                    /* Other Phase Locked Guard */
                    <div className={styles.lockedPhaseBanner}>
                      <Icon icon="ph:lock-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                      <div>
                        <strong>Phase Locked:</strong> {selectedCompEditable.reason}
                      </div>
                    </div>
                  ) : (
                    /* Editable Component Controls */
                    <>
                      <div className={styles.propRow}>
                        <span className={styles.propLabel}>Current Status:</span>
                        <span className={styles.propVal}>
                          {formatLevelCap(selectedCompData.nominal ?? 1)}
                        </span>
                      </div>

                      {/* Pipeline Dependency / Functional Level Analysis */}
                      {selectedUpstreamStatus.uncertain ? (
                        <div className={styles.uncertainBanner}>
                          <Icon icon="ph:question-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Real Functional Status Uncertain:</strong> Upstream pipeline dependency (
                            <em>{selectedUpstreamStatus.unknownNodes.join(", ")}</em>) is undiscovered.
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
                            <strong>{formatLevel(selectedCompData.effective)}</strong> by{" "}
                            <strong>{selectedCompData.capped_by}</strong>. Raising this component alone changes
                            nothing until that bottleneck is upgraded.
                          </div>
                        </div>
                      ) : (
                        <div className={styles.satisfiedBanner}>
                          <Icon icon="ph:check-circle-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Dependencies Satisfied:</strong> Runs at full functional capacity (
                            {formatLevelCap(selectedCompData.effective ?? selectedCompData.nominal ?? 1)}).
                          </div>
                        </div>
                      )}

                      {/* Component Level Selector */}
                      <div className="mt-2 pt-2 border-top d-flex flex-column gap-2">
                        <div className={styles.formGroup}>
                          <label className={styles.formLabel}>
                            <Icon icon="ph:arrow-fat-line-up-bold" />
                            <span>Target Maturity Level:</span>
                          </label>
                          <select
                            className={styles.selectInput}
                            value={selectedCompTargetLevel ?? (selectedCompData.nominal ?? 1)}
                            onChange={(e) => setSelectedCompTargetLevel(Number(e.target.value))}
                          >
                            {(selectedCompData.allowed_levels && selectedCompData.allowed_levels.length > 0
                              ? selectedCompData.allowed_levels
                              : [0, 1, 2, 3, 4]
                            ).map((lvl) => (
                              <option key={lvl} value={lvl}>
                                Level {lvl} ({formatLevelCap(lvl)})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Slotted Action Control */}
                      {isSelectedCompSlotted ? (
                        <div className="d-flex flex-column gap-2 mt-2">
                          <div
                            className="p-2 rounded"
                            style={{ background: "#e0f2fe", border: "1px solid #bae6fd", fontSize: "0.8rem" }}
                          >
                            <span className="fw-bold" style={{ color: "var(--primary-bg)" }}>
                              ⚡ Slotted in Action Proposal:
                            </span>
                            <div className="mt-1">
                              Will advance from <strong>{formatLevelCap(selectedCompData.nominal ?? 1)}</strong> to{" "}
                              <strong>{formatLevelCap(selectedCompChange?.value)}</strong>
                            </div>
                          </div>
                          <div className="d-flex gap-2">
                            <button
                              type="button"
                              className={styles.actionButton}
                              style={{ width: "auto", flex: 1 }}
                              onClick={() =>
                                handleSaveComponentSlot(
                                  selectedCompData.id,
                                  selectedCompTargetLevel ?? (selectedCompData.nominal ?? 1)
                                )
                              }
                            >
                              <Icon icon="ph:arrows-clockwise-bold" />
                              <span>Update Slot</span>
                            </button>
                            <button
                              type="button"
                              className={styles.actionButton}
                              style={{ background: "#dc2626", borderColor: "#b91c1c", width: "auto", flex: 1 }}
                              onClick={() => handleRemoveTargetSlot(selectedCompData.id)}
                            >
                              <Icon icon="ph:trash-bold" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2">
                          {atomicChanges.length >= MAX_ATOMIC_CHANGES ? (
                            <button type="button" disabled className={styles.actionButton}>
                              <span>Slots Full (3/3 Configured)</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.actionButton}
                              onClick={() =>
                                handleSaveComponentSlot(
                                  selectedCompData.id,
                                  selectedCompTargetLevel ?? (selectedCompData.nominal ?? 1)
                                )
                              }
                            >
                              <Icon icon="ph:plus-circle-bold" />
                              <span>
                                Advance to {formatLevelCap(selectedCompTargetLevel)}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* ── Empty Inspector State ── */
              <div className={styles.emptyInspector}>
                <Icon icon="ph:cursor-click-bold" className={styles.emptyIcon} />
                <h5 className="fw-bold mb-1" style={{ fontSize: "0.92rem", color: "#1e293b" }}>
                  Select a Node or Edge
                </h5>
                <p className="mb-0" style={{ fontSize: "0.78rem" }}>
                  Click on any component or workflow connection on the canvas to inspect its maturity, configure
                  triggers, or slot an action proposal upgrade.
                </p>
              </div>
            )}

            {/* ── Proposal Slots (1 to 3) ── */}
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
                  const isEdge = change.target.startsWith("e.") || allEdgesMap.has(change.target);
                  const edge = allEdgesMap.get(change.target);
                  const comp = allComponentsMap.get(change.target);

                  const displayName = isEdge
                    ? `${allComponentsMap.get(edge?.from_id || "")?.name || edge?.from_id || "Source"} ➔ ${
                        allComponentsMap.get(edge?.to_id || "")?.name || edge?.to_id || "Target"
                      }`
                    : comp?.name || change.target;

                  const curLevel = isEdge ? edge?.level ?? 1 : comp?.nominal ?? 1;
                  const nextLevel = typeof change.value === "number" ? change.value : curLevel + 1;

                  return (
                    <div
                      key={idx}
                      className={`${styles.slotCard} ${styles.slotCardSlotted}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        if (isEdge) {
                          setSelectedEdgeId(change.target);
                          setSelectedCompId(null);
                        } else {
                          setSelectedCompId(change.target);
                          setSelectedEdgeId(null);
                        }
                      }}
                    >
                      <div className={styles.slotHeader}>
                        <div className="d-flex align-items-center gap-2">
                          <span className={styles.slotIndex}>Slot {idx + 1}</span>
                          <span className={styles.slotNodeName}>{displayName}</span>
                        </div>
                        <button
                          type="button"
                          className={styles.slotRemoveBtn}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleRemoveSlot(idx);
                          }}
                          title="Remove change"
                        >
                          <Icon icon="ph:x-bold" />
                          <span>Remove</span>
                        </button>
                      </div>
                      <div className={styles.slotChangeInfo}>
                        <Icon
                          icon={isEdge ? "ph:flow-arrow-bold" : "ph:arrow-fat-line-up-bold"}
                          style={{ color: "var(--primary-bg)" }}
                        />
                        <span>
                          Advance from <strong>{formatLevelCap(curLevel)}</strong> ➔{" "}
                          <strong>{formatLevelCap(nextLevel)}</strong>
                          {change.trigger && (
                            <span className="ms-1 text-muted">
                              • <code>{change.trigger}</code>
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={idx} className={`${styles.slotCard} ${styles.slotCardEmpty}`}>
                    <Icon icon="ph:plus-dashed-bold" className="me-1" />
                    <span>Slot {idx + 1}: Empty (Click a node or edge to slot)</span>
                  </div>
                );
              })}
            </div>
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
    </div>
  );
}
