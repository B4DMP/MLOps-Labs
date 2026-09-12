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

/** The player never sees the number, only where it sits. */
function healthBucket(value?: number): "healthy" | "strained" | "failing" | "unknown" {
  if (value === undefined) return "unknown";
  if (value > 75) return "healthy";
  if (value > 45) return "strained";
  return "failing";
}

const BUCKET_WORD: Record<string, string> = {
  healthy: "holding up",
  strained: "strained",
  failing: "failing",
  unknown: "unclear",
};

function healthText(stage: StageData): string {
  if (stage.locked) return "not there yet";
  if (stage.health_band) {
    const [lo, hi] = stage.health_band;
    const a = healthBucket(lo);
    const b = healthBucket(hi);
    return a === b ? BUCKET_WORD[a] : `${BUCKET_WORD[a]} to ${BUCKET_WORD[b]}`;
  }
  return BUCKET_WORD[healthBucket(stage.health)];
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

const BOX_W = 132;
const BOX_H = 52;

/** Where a line between two boxes should start and stop, so arrows touch borders. */
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

/** Two lines of label beat an ellipsis: the player needs the name. */
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

function nodeColor(c: ComponentData): string {
  if (c.knowledge === "unknown") return "#12161f";
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
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", maxWidth: "100%", margin: "0 auto" }}
    >
      {/* Edges first (underneath boxes) */}
      {technical.edges.map((e) => {
        const from = compById[e.from_id];
        const to = compById[e.to_id];
        if (!from?.layout || !to?.layout) return null;
        const [ax, ay, bx, by] = edgeEnds(from.layout.x, from.layout.y, to.layout.x, to.layout.y);
        const x1b = ax, y1b = ay, x2b = bx, y2b = by;
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
              x1={x1b} y1={y1b} x2={x2b} y2={y2b}
              stroke={color}
              strokeWidth={known && e.level && e.level >= 3 ? 2 : 1.5}
              className={
                !known ? undefined
                  : e.level === 0 ? "pipe-dead"
                  : e.level >= 3 ? "pipe-flow"
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

      {/* Component boxes */}
      {technical.components.map((c) => {
        if (!c.layout) return null;
        const { x, y } = c.layout;
        const bg = nodeColor(c);
        const border = nodeBorder(c);
        const rawName = c.name || c.id.split(".").pop()?.replace(/_/g, " ") || c.id;
        const lines = wrapLabel(rawName, 16);
        return (
          <g
            key={c.id}
            transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2})`}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectComponent(c.id)}
            opacity={c.knowledge === "stale" ? 0.8 : 1}
          >
            <rect width={BOX_W} height={BOX_H} rx={5} fill={bg} stroke={border} strokeWidth={1.5}
              strokeDasharray={c.knowledge === "unknown" ? "4 3" : undefined} />
            {lines.map((line, i) => (
              <text
                key={i}
                x={BOX_W / 2}
                y={14 + i * 11}
                fill={c.knowledge === "unknown" ? "#8b93a7" : "#e8edf7"}
                fontSize={9.5}
                textAnchor="middle"
                fontWeight="600"
              >
                {line}
              </text>
            ))}
            {c.knowledge === "unknown" && (
              <text x={BOX_W / 2} y={BOX_H - 8} fill="#6b7280" fontSize={8} textAnchor="middle">
                not looked at yet
              </text>
            )}
            {c.knowledge !== "unknown" && c.nominal !== undefined && (
              <g transform={`translate(${BOX_W / 2 - 22}, ${BOX_H - 14})`}>
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
  const name = c.name || c.id.split(".").pop()?.replace(/_/g, " ") || "Unknown";
  const known = c.knowledge !== "unknown";
  const running = c.effective ?? c.nominal;
  const held = c.capped_by && c.effective !== undefined && c.nominal !== undefined && c.effective < c.nominal;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #131a2b 0%, #0d1117 100%)",
        border: `1px solid ${nodeBorder(c)}`,
        borderRadius: 12,
        padding: "0.9rem 1rem",
        marginTop: "0.6rem",
        position: "relative",
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}
      >✕</button>

      <div className="d-flex align-items-center gap-2 mb-1">
        <span style={{ fontSize: "1.1rem" }}>{known ? "🧩" : "🌫"}</span>
        <span className="fw-bold text-white" style={{ fontSize: "0.95rem" }}>{name}</span>
        {c.owner_id && (
          <span className="badge" style={{ background: "rgba(148,163,184,0.2)", color: "#cbd5e1", fontSize: "0.66rem" }}>
            looked after by {c.owner_id.replace(/_/g, " ")}
          </span>
        )}
        {c.knowledge === "stale" && (
          <span className="badge" style={{ background: "rgba(255,193,7,0.18)", color: "#ffc107", fontSize: "0.66rem" }}>
            what you saw last time
          </span>
        )}
        {!known && (
          <span className="badge" style={{ background: "rgba(148,163,184,0.15)", color: "#94a3b8", fontSize: "0.66rem" }}>
            never looked at
          </span>
        )}
      </div>

      {known && c.nominal !== undefined ? (
        <>
          <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: "0.78rem", color: "#e2e8f0" }}>
            <LevelPips nominal={c.nominal} effective={c.effective} />
            <span>
              runs <strong>{LEVEL_LABELS[running ?? 0]}</strong>
              {held && <> though it is set up to run <strong>{LEVEL_LABELS[c.nominal]}</strong></>}
            </span>
          </div>

          {held && (
            <div className="d-flex align-items-start gap-2 mb-2" style={{ fontSize: "0.75rem", color: "#fd7e14" }}>
              <span>⛓</span>
              <span>
                Held back by <strong>{c.capped_by}</strong>. Raising this one alone changes nothing until that is fixed.
              </span>
            </div>
          )}

          {c.debt && c.debt.length > 0 && (
            <div className="d-flex align-items-start gap-2 mb-2" style={{ fontSize: "0.75rem", color: "#ffc107" }}>
              <span>🧾</span>
              <span>
                Built in a hurry: meant to be <strong>{LEVEL_LABELS[c.debt[0].intended]}</strong>, landed{" "}
                <strong>{LEVEL_LABELS[c.debt[0].applied]}</strong>
                {c.debt[0].owner_id && <> because {c.debt[0].owner_id.replace(/_/g, " ")} was not behind it</>}.
              </span>
            </div>
          )}

          {c.story && (
            <p className="mb-2" style={{ fontSize: "0.78rem", color: "#cbd5e1", lineHeight: 1.45, fontStyle: "italic" }}>
              {c.story}
            </p>
          )}

          {c.instances && c.instances.length > 0 && (
            <div className="mt-2">
              <div style={{ fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>
                what is running here
              </div>
              {c.instances.map((inst) => (
                <div key={inst.id} className="d-flex align-items-center gap-2 flex-wrap mt-1">
                  <span style={{ fontSize: "0.78rem", color: "#e2e8f0" }}>{inst.name}</span>
                  <span className="badge" style={{ background: "rgba(56,189,248,0.18)", color: "#7dd3fc", fontSize: "0.62rem" }}>
                    {inst.state}
                  </span>
                  {Object.entries(inst.props).map(([k, v]) => (
                    <span
                      key={k}
                      className="badge"
                      style={{ background: "rgba(148,163,184,0.15)", color: "#cbd5e1", fontSize: "0.62rem" }}
                      title={k.replace(/_/g, " ")}
                    >
                      {k.replace(/_/g, " ")}: {v}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="mb-0" style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
          You have never looked at this part of the system. Facts you file correctly, and objections
          from whoever looks after it, are what open it up.
        </p>
      )}
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
          background: "rgba(9, 11, 20, 0.97)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 14,
          padding: "1.25rem 1.5rem",
          width: "auto",
          minWidth: 380,
          maxWidth: "min(860px, 92vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0 text-white">
            {stage.name}
            {stage.health !== undefined && (
              <span className="ms-2 badge" style={{ background: statusColor(stage.status), fontSize: "0.75rem" }}>
                {healthText(stage)}
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

const PIPELINE_ANIM = `
@keyframes pipeFlow { to { stroke-dashoffset: -24; } }
@keyframes pipePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes pipeGlow {
  0%,100% { box-shadow: 0 0 0 0 rgba(220,53,69,0); }
  50% { box-shadow: 0 0 14px 2px rgba(220,53,69,0.45); }
}
.pipe-flow { stroke-dasharray: 6 6; animation: pipeFlow 1.1s linear infinite; }
.pipe-flow-slow { stroke-dasharray: 4 8; animation: pipeFlow 2.6s linear infinite; }
.pipe-dead { stroke-dasharray: 3 5; animation: pipePulse 1.4s ease-in-out infinite; }
.pipe-stage-failing { animation: pipeGlow 1.8s ease-in-out infinite; }
.pipe-bar { background-size: 200% 100%; animation: pipeFlow 0s; }
@keyframes pipeBar { to { background-position: -200% 0; } }
.pipe-bar-run { animation: pipeBar 1.4s linear infinite; }
`;

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
      <style>{PIPELINE_ANIM}</style>
      {/* Strip */}
      {isVisible && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(1040px, 94vw)",
            zIndex: 1040,
            background: "rgba(9, 11, 20, 0.96)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 14,
            boxShadow: "0 18px 45px rgba(0, 0, 0, 0.55)",
            padding: "10px 18px 12px",
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
                          className={flow ? (flow.level === 0 ? "" : "pipe-bar pipe-bar-run") : ""}
                          title={flow ? `Flow between stages: ${LEVEL_LABELS[flow.level]}` : undefined}
                          style={{
                            width: 24,
                            height: flow && flow.level === 0 ? 2 : 3,
                            backgroundImage: flow && flow.level > 0
                              ? `repeating-linear-gradient(90deg, ${statusColor(flow.level >= 3 ? "healthy" : "degraded")} 0 6px, transparent 6px 12px)`
                              : undefined,
                            background: flow && flow.level > 0
                              ? undefined
                              : flow
                                ? statusColor("broken")
                                : "#444",
                          }}
                        />
                      )}
                      <button
                        onClick={() => setSelectedStage(stage.id)}
                        className={!stage.locked && stage.status === "broken" ? "pipe-stage-failing" : undefined}
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
                        healthBucket(graphState.system_health) === "healthy" ? "healthy"
                          : healthBucket(graphState.system_health) === "strained" ? "degraded"
                          : "broken"
                      ),
                      whiteSpace: "nowrap",
                      marginTop: 2,
                    }}
                  >
                    The system as a whole: {BUCKET_WORD[healthBucket(graphState.system_health)]}
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
