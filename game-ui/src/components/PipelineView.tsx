import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";

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
  technical: Record<string, TechnicalStage>;
  system_health: number;
}

interface PipelineViewProps {
  currentPhase: number;
  isVisible: boolean;
  onToggle: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (status === "healthy") return "#198754";
  if (status === "degraded") return "#fd7e14";
  if (status === "broken") return "#dc3545";
  return "#6c757d";
}

function healthText(stage: StageData): string {
  if (stage.locked) return "—";
  if (stage.health_band) {
    const [lo, hi] = stage.health_band;
    if (lo === hi) return `${lo}`;
    return `${lo}–${hi}`;
  }
  return stage.health !== undefined ? `${stage.health}` : "—";
}

// Level pips: 5 circles (0 = broken/red, 1 = absent/grey, 2-4 = filled)
function LevelPips({ nominal, effective }: { nominal: number; effective?: number }) {
  const MAX = 4;
  return (
    <span className="d-inline-flex gap-1 align-items-center">
      {Array.from({ length: MAX + 1 }, (_, i) => {
        const isBroken = i === 0;
        const filled = i <= nominal;
        const cappedOff = effective !== undefined && i > effective && i <= nominal;
        let bg = "transparent";
        let border = "1px solid #6c757d";
        if (isBroken && nominal === 0) {
          bg = "#dc3545";
          border = "1px solid #dc3545";
        } else if (filled) {
          bg = cappedOff ? "#fd7e14" : "#198754";
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

// ── Feedback arcs overlay (strip) ────────────────────────────────────────────

function FeedbackArcs({
  pipelineStages,
  feedbackFlows,
  centres,
  width,
}: {
  pipelineStages: StageData[];
  feedbackFlows: FlowData[];
  /** Measured centre of each stage box, in px inside the row. Arcs without one are not drawn. */
  centres: Record<string, number>;
  width: number;
}) {
  const N = pipelineStages.length;
  const lockedIds = new Set(pipelineStages.filter((s) => s.locked).map((s) => s.id));
  // Cross-stage arcs between pipeline stages the player has actually reached: an arc into a
  // locked stage would give away that Ops feeds back into Modeling before they have been there.
  const arcs = feedbackFlows.filter((f) => {
    const fi = pipelineStages.findIndex((s) => s.id === f.from);
    const ti = pipelineStages.findIndex((s) => s.id === f.to);
    if (fi < 0 || ti < 0 || fi === ti) return false;
    if (lockedIds.has(f.from) || lockedIds.has(f.to)) return false;
    return centres[f.from] !== undefined && centres[f.to] !== undefined;
  });
  if (N === 0 || arcs.length === 0 || width <= 0) return null;

  const W = width;
  const H = 90;
  const cx = (i: number) => centres[pipelineStages[i].id];

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
          const key = `fb-${f.from}-${f.to}`.replace(/\./g, "_");
          const color = statusColor(
            f.level === 0 ? "broken" : f.level >= 3 ? "healthy" : "degraded"
          );
          return (
            <marker key={key} id={key} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L0,5 L5,2.5 z" fill={color} />
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
        // Arcs curve upward; taller arcs for longer distances to avoid overlap.
        const arcTop = Math.max(2, H - dist * Math.floor((H - 2) / Math.max(N - 1, 1)));
        const color = statusColor(
          f.level === 0 ? "broken" : f.level >= 3 ? "healthy" : "degraded"
        );
        const key = `fb-${f.from}-${f.to}`.replace(/\./g, "_");
        return (
          <path
            key={key}
            d={`M ${x1},${H} C ${x1},${arcTop} ${x2},${arcTop} ${x2},${H}`}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={f.level === 0 ? "4 2" : undefined}
            markerEnd={`url(#${key})`}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

// ── SVG topology for one stage ────────────────────────────────────────────────

const BOX_W = 110;
const BOX_H = 40;

function nodeColor(c: ComponentData): string {
  if (c.knowledge === "unknown") return "#1a1a1a";
  const eff = c.effective ?? c.nominal ?? 1;
  if (eff === 0) return "#3a0a0a";
  if (c.knowledge === "stale") return "#1a1830";
  return "#16213e";
}

function nodeBorder(c: ComponentData): string {
  if (c.knowledge === "unknown") return "#444";
  const eff = c.effective ?? c.nominal ?? 1;
  if (eff === 0) return "#dc3545";
  if (c.capped_by) return "#fd7e14";
  return "#2a4a8e";
}

function StageSvg({
  technical,
  onSelectComponent,
}: {
  technical: TechnicalStage;
  onSelectComponent: (id: string | null) => void;
}) {
  const compById = Object.fromEntries(technical.components.map((c) => [c.id, c]));
  const hasLayout = technical.components.some((c) => c.layout);

  if (!hasLayout) return null;

  // Compute viewport bounds
  const xs = technical.components.flatMap((c) => (c.layout ? [c.layout.x] : []));
  const ys = technical.components.flatMap((c) => (c.layout ? [c.layout.y] : []));
  const pad = 20;
  const svgW = Math.max(...xs) + BOX_W / 2 + pad * 2;
  const svgH = Math.max(...ys) + BOX_H / 2 + pad * 2;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", minHeight: 160 }}
    >
      {/* Edges first (underneath boxes) */}
      {technical.edges.map((e) => {
        const from = compById[e.from_id];
        const to = compById[e.to_id];
        if (!from?.layout || !to?.layout) return null;
        const x1 = from.layout.x;
        const y1 = from.layout.y;
        const x2 = to.layout.x;
        const y2 = to.layout.y;
        const known = e.knowledge !== "unknown";
        const color = known ? (e.level === 0 ? "#dc3545" : e.level && e.level >= 3 ? "#198754" : "#fd7e14") : "#444";
        return (
          <g key={e.id} opacity={e.knowledge === "stale" ? 0.5 : 1}>
            <defs>
              <marker id={`arr-${e.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill={color} />
              </marker>
            </defs>
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray={e.knowledge === "unknown" ? "4 3" : undefined}
              markerEnd={`url(#arr-${e.id})`}
            />
            {known && e.trigger && e.trigger !== "none" && (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fill={color} fontSize={10} textAnchor="middle">
                {TRIGGER_ICONS[e.trigger] ?? ""}
              </text>
            )}
          </g>
        );
      })}

      {/* Component boxes */}
      {technical.components.map((c) => {
        if (!c.layout) return null;
        const { x, y } = c.layout;
        const bg = nodeColor(c);
        const border = nodeBorder(c);
        const rawName = c.name || c.id.split(".").pop()?.replace(/_/g, " ") || c.id;
        const label = c.knowledge === "unknown"
          ? (rawName.length > 14 ? rawName.slice(0, 13) + "…" : rawName)
          : c.name.length > 14 ? c.name.slice(0, 13) + "…" : c.name;
        return (
          <g
            key={c.id}
            transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2})`}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectComponent(c.id)}
            opacity={c.knowledge === "stale" ? 0.65 : c.knowledge === "unknown" ? 0.45 : 1}
          >
            <rect width={BOX_W} height={BOX_H} rx={5} fill={bg} stroke={border} strokeWidth={1.5}
              strokeDasharray={c.knowledge === "unknown" ? "4 3" : undefined} />
            <text x={BOX_W / 2} y={14} fill={c.knowledge === "unknown" ? "#666" : "#ddd"} fontSize={9} textAnchor="middle" fontWeight="600">
              {label}
            </text>
            {c.knowledge !== "unknown" && c.nominal !== undefined && (
              <g transform={`translate(${BOX_W / 2 - 22}, 22)`}>
                {Array.from({ length: 5 }, (_, i) => {
                  const filled = i <= c.nominal!;
                  const capped = c.effective !== undefined && i > c.effective && filled;
                  return (
                    <circle
                      key={i}
                      cx={i * 11}
                      cy={0}
                      r={4}
                      fill={i === 0 && c.nominal === 0 ? "#dc3545" : filled ? (capped ? "#fd7e14" : "#198754") : "transparent"}
                      stroke={filled ? "none" : "#555"}
                      strokeWidth={1}
                    />
                  );
                })}
              </g>
            )}
            {c.knowledge === "stale" && c.seen_at !== undefined && (
              <text x={BOX_W / 2} y={BOX_H - 4} fill="#ffc107" fontSize={7} textAnchor="middle">
                #{c.seen_at}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Component detail card (shown below SVG when a box is clicked) ─────────────

function ComponentDetail({ c, onClose }: { c: ComponentData; onClose: () => void }) {
  return (
    <div
      style={{
        background: "#0d1117",
        border: `1px solid ${nodeBorder(c)}`,
        borderRadius: 6,
        padding: "0.6rem 0.8rem",
        marginTop: "0.5rem",
        position: "relative",
      }}
    >
      <button
        onClick={onClose}
        style={{ position: "absolute", top: 4, right: 8, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14 }}
      >✕</button>
      <div className="fw-semibold text-white mb-1" style={{ fontSize: "0.85rem" }}>
        {c.name || c.id.split(".").pop()?.replace(/_/g, " ") || "Unknown"}{c.knowledge === "unknown" && <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "#888" }}>(not yet explored)</span>}
        {c.knowledge !== "unknown" && c.nominal !== undefined && (
          <span className="ms-2"><LevelPips nominal={c.nominal} effective={c.effective} /></span>
        )}
        {c.knowledge === "stale" && c.seen_at !== undefined && (
          <span className="ms-2 text-warning" style={{ fontSize: "0.7rem" }}>as of #{c.seen_at}</span>
        )}
      </div>
      {c.story && <p className="mb-1 text-secondary" style={{ fontSize: "0.75rem" }}>{c.story}</p>}
      {c.capped_by && <p className="mb-1" style={{ fontSize: "0.7rem", color: "#fd7e14" }}>Capped by: {c.capped_by}</p>}
      {c.debt && c.debt.length > 0 && (
        <p className="mb-1" style={{ fontSize: "0.7rem", color: "#ffc107" }}>
          Debt: intended {LEVEL_LABELS[c.debt[0].intended]}, landed {LEVEL_LABELS[c.debt[0].applied]}
        </p>
      )}
      {c.instances && c.instances.map((inst) => (
        <div key={inst.id} style={{ fontSize: "0.7rem", color: "#aaa" }}>
          {inst.name} ({inst.state}) {Object.entries(inst.props).map(([k, v]) => `· ${k}: ${v}`).join(" ")}
        </div>
      ))}
    </div>
  );
}

// ── Technical modal for one stage ────────────────────────────────────────────

function StageModal({
  stage,
  technical,
  onClose,
}: {
  stage: StageData;
  technical: TechnicalStage;
  onClose: () => void;
}) {
  const [selectedComp, setSelectedComp] = useState<string | null>(null);
  const selComp = selectedComp ? technical.components.find((c) => c.id === selectedComp) : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 1060,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#1a1a2e",
          border: "1px solid #444",
          borderRadius: 10,
          padding: "1.5rem",
          maxWidth: 860,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0 text-white">
            {stage.name}
            {stage.health !== undefined && (
              <span className="ms-2 badge" style={{ background: statusColor(stage.status), fontSize: "0.75rem" }}>
                {stage.health}
              </span>
            )}
            {/* Starved: running at zero because something upstream is down, not broken here (D35). */}
            {!!stage.starved && (
              <span className="ms-1 badge" style={{ background: "#6c757d", fontSize: "0.7rem" }}
                    title="Running at zero because something upstream is down">
                {stage.starved} starved
              </span>
            )}
          </h5>
          <button className="btn-close btn-close-white" onClick={onClose} />
        </div>

        {/* Active patterns */}
        {stage.patterns && stage.patterns.length > 0 && (
          <div className="mb-2">
            {stage.patterns.map((p) => (
              <span
                key={p.id}
                className="badge me-1"
                style={{ background: p.kind === "anti" ? "#dc3545" : "#198754", fontSize: "0.7rem" }}
                title={p.id}
              >
                {p.name}
              </span>
            ))}
          </div>
        )}

        {/* SVG topology */}
        <div style={{ background: "#0d1117", borderRadius: 6, padding: "0.5rem", marginBottom: "0.75rem" }}>
          <StageSvg technical={technical} onSelectComponent={setSelectedComp} />
        </div>

        {/* Selected component detail */}
        {selComp && (
          <ComponentDetail c={selComp} onClose={() => setSelectedComp(null)} />
        )}

        {/* Fallback list for stages without layout / gov edges */}
        {!technical.components.some((c) => c.layout) && (
          <div className="d-flex flex-column gap-2">
            {technical.components.map((c) => (
              <div
                key={c.id}
                style={{
                  background: nodeColor(c),
                  border: `1px solid ${nodeBorder(c)}`,
                  borderRadius: 6,
                  padding: "0.5rem 0.8rem",
                  opacity: c.knowledge === "stale" ? 0.7 : 1,
                }}
              >
                <div className="d-flex align-items-center justify-content-between">
                  <span style={{ fontSize: "0.85rem", fontWeight: 600, color: c.knowledge === "unknown" ? "#555" : "#fff" }}>
                    {c.name || c.id.split(".").pop()?.replace(/_/g, " ") || c.id}
                  </span>
                  {c.knowledge !== "unknown" && c.nominal !== undefined && (
                    <LevelPips nominal={c.nominal} effective={c.effective} />
                  )}
                </div>
                {c.story && <p className="mb-0 mt-1 text-secondary" style={{ fontSize: "0.75rem" }}>{c.story}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Non-pipeline edges summary */}
        {technical.edges.filter((e) => e.kind !== "pipeline" && e.knowledge !== "unknown").length > 0 && (
          <div className="mt-3">
            <h6 className="text-white-50 mb-1" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1 }}>
              Governance / Feedback edges
            </h6>
            <div className="d-flex flex-column gap-1">
              {technical.edges.filter((e) => e.kind !== "pipeline" && e.knowledge !== "unknown").map((e) => (
                <div key={e.id} style={{ fontSize: "0.72rem", color: "#888" }}>
                  {e.from_id.split(".").pop()} → {e.to_id.split(".").pop()}
                  {e.trigger && e.trigger !== "none" && <span className="ms-1">{TRIGGER_ICONS[e.trigger]}</span>}
                  {e.level !== undefined && <span className="ms-1 text-secondary">lv{e.level}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function PipelineView({ currentPhase, isVisible, onToggle }: PipelineViewProps) {
  const { emit, subscribe } = useGameWebSocket();
  const [graphState, setGraphState] = useState<GraphStatePayload | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const stageRefs = useRef<Record<string, HTMLElement | null>>({});
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [centres, setCentres] = useState<{ centres: Record<string, number>; width: number }>({
    centres: {},
    width: 0,
  });

  // Escape closes the strip. Without it the overlay sits on top of the button that opened it.
  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedStage) setSelectedStage(null);
      else onToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVisible, selectedStage, onToggle]);

  const requestState = useCallback(() => {
    emit("graph:state_request", { phase_id: currentPhase });
  }, [emit, currentPhase]);

  useEffect(() => {
    requestState();
    const unsub = subscribe("graph:state", (data: GraphStatePayload) => {
      setGraphState(data);
    });
    return unsub;
  }, [requestState, subscribe]);

  // Re-request when phase changes.
  useEffect(() => {
    requestState();
  }, [currentPhase, requestState]);

  const pipelineStages = graphState?.stages.filter((s) => !s.band) ?? [];
  const bandStages = graphState?.stages.filter((s) => s.band) ?? [];

  useLayoutEffect(() => {
    if (!isVisible || !rowRef.current) return;
    const rowLeft = rowRef.current.getBoundingClientRect().left;
    const next: Record<string, number> = {};
    Object.entries(stageRefs.current).forEach(([id, el]) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      next[id] = r.left - rowLeft + r.width / 2;
    });
    const width = rowRef.current.scrollWidth;
    setCentres((prev) => {
      const same =
        prev.width === width &&
        Object.keys(next).length === Object.keys(prev.centres).length &&
        Object.entries(next).every(([k, v]) => Math.abs((prev.centres[k] ?? -1) - v) < 0.5);
      return same ? prev : { centres: next, width };
    });
  });

  const openModal = selectedStage
    ? graphState?.stages.find((s) => s.id === selectedStage)
    : null;

  return (
    <>
      {/* Strip */}
      {isVisible && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1040,
            background: "#0d1117",
            borderBottom: "1px solid #333",
            padding: "8px 16px",
          }}
        >
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={onToggle}
            title="Close the pipeline view (Esc)"
            aria-label="Close the pipeline view"
            style={{ position: "absolute", top: 8, right: 12, zIndex: 1 }}
          />
          {graphState ? (
            <div>
              {/* Pipeline row — scrolls horizontally so stages never wrap */}
              <div style={{ overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}>
              <div ref={rowRef} style={{ width: "max-content" }}>
              <FeedbackArcs
                pipelineStages={pipelineStages}
                feedbackFlows={graphState.feedback_flows ?? []}
                centres={centres.centres}
                width={centres.width}
              />
              <div className="d-flex align-items-center gap-2">
                {pipelineStages.map((stage, i) => {
                  const flow = graphState.flows.find((f) => f.from === pipelineStages[i - 1]?.id && f.to === stage.id);
                  return (
                    <div
                      key={stage.id}
                      className="d-flex align-items-center gap-2"
                      ref={(el) => { stageRefs.current[stage.id] = el; }}
                    >
                      {i > 0 && (
                        <div
                          style={{
                            width: 24,
                            height: 2,
                            background: flow
                              ? statusColor(flow.level >= 3 ? "healthy" : flow.level >= 2 ? "degraded" : "broken")
                              : "#444",
                          }}
                        />
                      )}
                      <button
                        onClick={() => setSelectedStage(stage.id)}
                        style={{
                          background: stage.locked ? "#111" : "#16213e",
                          border: `1px solid ${stage.locked ? "#333" : statusColor(stage.status)}`,
                          borderRadius: 6,
                          padding: "4px 10px",
                          cursor: stage.locked ? "default" : "pointer",
                          color: "#fff",
                          fontSize: "0.78rem",
                          minWidth: 90,
                          textAlign: "center",
                        }}
                        disabled={stage.locked}
                      >
                        <div className="fw-semibold">{stage.name}</div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: stage.locked ? "#666" : statusColor(stage.status),
                          }}
                        >
                          {stage.locked ? "locked" : healthText(stage)}
                        </div>
                        {!stage.locked && stage.patterns && stage.patterns.length > 0 && (
                          <div className="d-flex justify-content-center gap-1 mt-1">
                            {stage.patterns.map((p) => (
                              <span
                                key={p.id}
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: "50%",
                                  background: p.kind === "anti" ? "#dc3545" : "#198754",
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

                {/* System health — outside the scroll container */}
                {graphState.system_health !== undefined && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: statusColor(
                        graphState.system_health > 75 ? "healthy"
                          : graphState.system_health > 45 ? "degraded"
                          : "broken"
                      ),
                      whiteSpace: "nowrap",
                      marginTop: 2,
                    }}
                  >
                    System health: {Math.round(graphState.system_health)}
                  </div>
                )}

              {/* Governance / Infra band */}
              {bandStages.length > 0 && (
                <div className="d-flex gap-2 mt-1" style={{ paddingLeft: 4 }}>
                  {bandStages.map((stage) => (
                    <button
                      key={stage.id}
                      onClick={() => !stage.locked && setSelectedStage(stage.id)}
                      style={{
                        background: "#0a0a1a",
                        border: `1px solid ${statusColor(stage.status)}`,
                        borderRadius: 4,
                        padding: "2px 8px",
                        color: "#aaa",
                        fontSize: "0.7rem",
                        cursor: stage.locked ? "default" : "pointer",
                      }}
                      disabled={stage.locked}
                    >
                      {stage.name} {healthText(stage)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-secondary" style={{ fontSize: "0.8rem" }}>Loading pipeline…</span>
          )}
        </div>
      )}

      {/* Stage modal */}
      {openModal && graphState?.technical[openModal.id] && (
        <StageModal
          stage={openModal}
          technical={graphState.technical[openModal.id]}
          onClose={() => setSelectedStage(null)}
        />
      )}
    </>
  );
}

export default PipelineView;
