import { useState, useEffect, useCallback, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { Icon } from "@iconify/react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import IntelArtifactViewer from "./IntelArtifactViewer";
import type { IntelEntry, StakeholderDossierEntry } from "./StakeholderDossier";
import { StakeholderContext } from "./StakeholderProvider";
import { StakeholderAvatarComponent } from "./StakeholderAvatarComponent";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { healthBucket, HEALTH_BUCKET_WORD } from "../utils/systemHealth";
import {
  CappedChainGlyph,
  edgeStrokeWidth,
  FlowParticle,
  LevelMeter,
  NodeDefs,
  NodeIcon,
  NodeTitleAberration,
  LevelCaption,
  NODE_STATE_ANIM,
  ScanlineDefs,
  SelectionReticle,
  StaleScanline,
  TriggerChip,
} from "./graph/nodeChrome";
import {
  NODE_COLORS,
  NODE_ICON_OFFSET,
  NODE_CAPTION_Y,
  NODE_METER_Y,
  NODE_PAD_X,
  NODE_TITLE_LH,
  NODE_TITLE_Y,
  NODE_RX,
  RAIL_W,
  nodeFace,
  BOX_W,
  BOX_H,
  AUTOMATION_LABELS,
  formatAxisLevel,
  TRIGGER_ICONS,
  compactLayout,
  edgeEnds,
  fitToBoxStyle,
  wrapLabel,
} from "../utils/stageCanvas";
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
  nominal_automation?: number;
  nominal_governance?: number;
  effective_automation?: number;
  effective_governance?: number;
  allowed_automation?: number[];
  allowed_governance?: number[];
  capped_by?: string;
  story?: string;
  seen_at?: number;
  icon?: string;
  layout?: { x: number; y: number };
  debt?: Array<{ intended: number; applied: number; axis?: "automation" | "governance"; owner_id?: string }>;
  instances?: Array<{ id: string; kind: string; name: string; state: string; props: Record<string, string> }>;
}

interface EdgeData {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
  knowledge: "unknown" | "current" | "stale";
  automation?: number;
  governance?: number;
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
  /** The player's dossier, used to link a component to the notes that are about it. */
  dossierData?: StakeholderDossierEntry[];
  /** Opens the dossier on a stakeholder's page. Owners become links when this is given. */
  onOpenStakeholder?: (stakeholderId: string) => void;
}

/** What sits on one side of the stage being inspected. */
interface StageNeighbour {
  icon: string;
  label: string;
  title: string;
  stageId?: string;
  color?: string;
}

/** One dossier note, carrying the page it was found on so the artifact can be attributed. */
interface LinkedNote {
  item: IntelEntry;
  stakeholderName: string;
}

const NOTE_SOURCE_META: Record<string, { icon: string; label: string }> = {
  public_record: { icon: "ph:megaphone-bold", label: "Said openly in the team channel" },
  interview: { icon: "ph:chats-circle-bold", label: "They told you this directly" },
  debate: { icon: "ph:microphone-stage-bold", label: "Came out during the pitch" },
  offline_artifact: { icon: "ph:file-text-bold", label: "You read this in a document" },
};

function noteSourceMeta(item: IntelEntry) {
  return NOTE_SOURCE_META[(item.source || "offline_artifact").toLowerCase()]
    ?? NOTE_SOURCE_META.offline_artifact;
}

/** A note can be opened as an artifact only when there is a document behind it. */
function artifactContentOf(item: IntelEntry): string | null {
  return item.artifact?.content || item.debug?.artifact?.content || null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_STAGES: StageData[] = [];

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

/** Highest rung a target allows on an axis, or the axis maximum when the payload omits it. */
function axisCeiling(allowed?: number[]): number {
  return allowed && allowed.length > 0 ? Math.max(...allowed) : 3;
}

/** Governance pips: one per rung above `none`, violet, no capped state (governance never caps). */
function GovernancePips({ level }: { level: number }) {
  return (
    <span className="d-inline-flex gap-1 align-items-center" title={`Governance: ${formatAxisLevel("governance", level)}`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            display: "inline-block",
            background: i <= level ? "#7c3aed" : "transparent",
            border: `1px solid ${i <= level ? "#7c3aed" : "#d8cff5"}`,
          }}
        />
      ))}
    </span>
  );
}

/** Both axes side by side: automation as round pips (green, orange where capped), governance
 *  as violet squares - different shapes so the two never read as one scale. */
function AxisPips({ c }: { c: ComponentData }) {
  return (
    <span className="d-inline-flex gap-2 align-items-center">
      <LevelPips nominal={c.nominal_automation ?? 1} effective={c.effective_automation} />
      <GovernancePips level={c.nominal_governance ?? 0} />
    </span>
  );
}

/** Automation pips, broken..automated. */
function LevelPips({ nominal, effective }: { nominal: number; effective?: number }) {
  const MAX = AUTOMATION_LABELS.length - 1;
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
            title={`Automation: ${AUTOMATION_LABELS[i]}`}
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

function CrossStageArcs({
  pipelineStages,
  flows,
  centres,
  width,
}: {
  pipelineStages: StageData[];
  flows: FlowData[];
  centres: Record<string, number>;
  width: number;
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

  const W = width;
  const H = 48;
  const cx = (i: number) => centres[pipelineStages[i].id];
  const colorFor = (level: number) => statusColor(level === 0 ? "broken" : level >= 3 ? "healthy" : "degraded");

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
          const color = colorFor(f.level);
          return (
            <marker key={key} id={key} markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={color} />
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
        const key = `fb-${f.from}-${f.to}`.replace(/\./g, "_");
        return (
          <path
            key={key}
            d={`M ${x1},${H} C ${x1},${arcTop} ${x2},${arcTop} ${x2},${H}`}
            fill="none"
            stroke={color}
            strokeWidth={1.75}
            strokeDasharray={f.level === 0 ? "4 2" : undefined}
            markerEnd={`url(#${key})`}
            opacity={0.9}
          />
        );
      })}
    </svg>
  );
}

/** Connector between two stage buttons: a dashed pipe with an arrowhead, so the strip
 *  reads as a direction of travel rather than a row of ties. */
function StageConnector({ flow, toId }: { flow?: FlowData; toId: string }) {
  const W = 34;
  const H = 14;
  const markerId = `conn-${toId}`.replace(/\./g, "_");
  const color = !flow
    ? "#cbd5e1"
    : flow.level === 0
      ? statusColor("broken")
      : statusColor(flow.level >= 3 ? "healthy" : "degraded");
  const animation = !flow
    ? undefined
    : flow.level === 0
      ? "pipe-dead"
      : flow.level >= 3
        ? "pipe-flow"
        : "pipe-flow-slow";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flexShrink: 0, overflow: "visible" }}>
      <title>
        {flow
          ? `Flow between stages: ${formatAxisLevel("automation", flow.level)}`
          : "No flow between these stages yet"}
      </title>
      <defs>
        <marker id={markerId} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L0,5 L5,2.5 z" fill={color} />
        </marker>
      </defs>
      <line
        x1={0}
        y1={H / 2}
        x2={W - 7}
        y2={H / 2}
        stroke={color}
        strokeWidth={2.25}
        strokeDasharray={animation ? undefined : "4 3"}
        className={animation}
        markerEnd={`url(#${markerId})`}
      />
    </svg>
  );
}

/** The colour of a component's status rail: what the player should worry about first. */
function railColor(c: ComponentData): string {
  if (c.knowledge === "unknown") return NODE_COLORS.unknown;
  // Broken is what this component is; capped covers what its upstream does to it, starving
  // included. Reading `effective` here would paint every victim of one break as broken.
  if ((c.nominal_automation ?? 1) === 0) return NODE_COLORS.broken;
  if (c.capped_by) return NODE_COLORS.capped;
  if (c.knowledge === "stale") return NODE_COLORS.stale;
  return NODE_COLORS.healthy;
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
  const hasLayout = technical.components.some((c) => c.layout);

  if (!hasLayout) return null;

  const { positions, width: svgW, height: svgH } = compactLayout(technical.components);
  const posOf = (id: string) => positions[id];

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      preserveAspectRatio="xMidYMid meet"
      style={fitToBoxStyle(svgW, svgH)}
    >
      <style>{NODE_STATE_ANIM}</style>
      <NodeDefs prefix="dash" />
      <ScanlineDefs />

      {/* Connecting Edges */}
      {technical.edges.map((e) => {
        const from = posOf(e.from_id);
        const to = posOf(e.to_id);
        if (!from || !to) return null;
        const [ax, ay, bx, by] = edgeEnds(from.x, from.y, to.x, to.y);
        const x1b = ax, y1b = ay, x2b = bx, y2b = by;
        const known = e.knowledge !== "unknown";
        // Flow is an automation question only; governance never changes what gets through.
        const lvl = e.automation;
        const color = known ? (lvl === 0 ? "#dc3545" : lvl && lvl >= 3 ? "#16a34a" : "#ea580c") : "#94a3b8";
        const isAutomated = known && lvl !== undefined && lvl !== null && lvl >= 3;
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
              strokeWidth={edgeStrokeWidth(known ? lvl : undefined)}
              className={
                !known ? undefined
                  : lvl === 0 ? "pipe-dead"
                  : lvl != null && lvl >= 3 ? "pipe-flow"
                  : "pipe-flow-slow"
              }
              strokeDasharray={e.knowledge === "unknown" ? "4 3" : undefined}
              markerEnd={`url(#arr-${e.id})`}
            />
            {isAutomated && <FlowParticle x1={x1b} y1={y1b} x2={x2b} y2={y2b} color={color} />}
            {known && e.trigger && e.trigger !== "none" && (
              <TriggerChip
                x={(x1b + x2b) / 2}
                y={(y1b + y2b) / 2 - 4}
                label={TRIGGER_ICONS[e.trigger] ?? "?"}
                title={`Automation: ${formatAxisLevel("automation", lvl)} · Governance: ${formatAxisLevel("governance", e.governance ?? 0)}`}
                color={color}
              />
            )}
          </g>
        );
      })}

      {/* Component Nodes */}
      {technical.components.map((c) => {
        const pos = posOf(c.id);
        if (!pos) return null;
        const { x, y } = pos;
        const isSelected = selectedComponentId === c.id;
        const isUnknown = c.knowledge === "unknown";
        const rail = railColor(c);
        const isBroken = !isUnknown && (c.nominal_automation ?? 1) === 0;
        // Runs at nothing, but is not itself broken: something upstream is down. Saying
        // BROKEN here would blame the victim of a break for the break.
        const isStarved = !isUnknown && !isBroken && (c.effective_automation ?? 1) === 0;
        const rawName = c.name || c.id.split(".").pop()?.replace(/_/g, " ") || c.id;
        const lines = wrapLabel(rawName, 17);

        return (
          <g
            key={c.id}
            className="stage-node"
            transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2})`}
            onClick={() => onSelectComponent(isSelected ? null : c.id)}
            opacity={c.knowledge === "stale" ? 0.9 : 1}
          >
            <g className={isBroken ? "node-broken" : undefined}>
            {/* Card face, with the status rail hugging its left edge */}
            <rect
              width={BOX_W}
              height={BOX_H}
              rx={NODE_RX}
              fill={nodeFace("dash", { selected: isSelected, unknown: isUnknown, broken: isBroken })}
              stroke={isSelected ? NODE_COLORS.selected : isUnknown ? "#cbd5e1" : "#dde5ee"}
              strokeWidth={1}
              strokeDasharray={isUnknown ? "5 3" : undefined}
              filter={`url(#dash-${isBroken ? "broken-face" : isSelected ? "shadow-lifted" : "shadow"})`}
            />
            <clipPath id={`dash-clip-${c.id.replace(/\./g, "_")}`}>
              <rect width={BOX_W} height={BOX_H} rx={NODE_RX} />
            </clipPath>
            <rect
              width={RAIL_W}
              height={BOX_H}
              fill={rail}
              opacity={isUnknown ? 0.5 : 1}
              clipPath={`url(#dash-clip-${c.id.replace(/\./g, "_")})`}
            />
            {c.knowledge === "stale" && <StaleScanline clipPathId={`dash-clip-${c.id.replace(/\./g, "_")}`} />}
            {!isUnknown && !isBroken && c.capped_by && <CappedChainGlyph color={rail} />}

            {/* Icon, sharing the title's row */}
            {c.icon && <NodeIcon icon={c.icon} color={isUnknown ? "#7c8ba1" : rail} />}

            {/* Component Title, with its colour-split ghosts underneath when broken */}
            {isBroken && (
              <NodeTitleAberration
                lines={lines}
                x={(i) => NODE_PAD_X + (c.icon && i === 0 ? NODE_ICON_OFFSET : 0)}
                fontWeight={isSelected ? 700 : 600}
              />
            )}
            {lines.map((line, i) => (
              <text
                key={i}
                x={NODE_PAD_X + (c.icon && i === 0 ? NODE_ICON_OFFSET : 0)}
                y={NODE_TITLE_Y + i * NODE_TITLE_LH}
                fill={isUnknown ? "#7c8ba1" : isSelected ? "var(--primary-bg, #266682)" : "#15243b"}
                fontSize={11}
                fontWeight={isSelected ? 700 : 600}
                letterSpacing="0.1"
              >
                {line}
              </text>
            ))}

            {isUnknown ? (
              <text x={NODE_PAD_X} y={NODE_CAPTION_Y} fill="#94a3b8" fontSize={8.5} fontStyle="italic">
                not looked at yet
              </text>
            ) : (
              <>
                {c.nominal_automation !== undefined && (
                  <LevelMeter
                    automation={c.nominal_automation}
                    effectiveAutomation={c.effective_automation}
                    governance={c.nominal_governance}
                    maxAutomation={axisCeiling(c.allowed_automation)}
                    maxGovernance={axisCeiling(c.allowed_governance)}
                    y={NODE_METER_Y}
                  />
                )}
                <LevelCaption
                  level={c.effective_automation ?? c.nominal_automation ?? 0}
                  governance={c.nominal_governance}
                  y={NODE_CAPTION_Y}
                  // Starved is about upstream, not about a rung, so it keeps the rail's colour.
                  text={isStarved ? "starved" : undefined}
                  color={isStarved ? rail : undefined}
                />
              </>
            )}

            {/* Inspect affordance, quiet until the node is hovered or selected */}
            <circle
              className={isSelected ? undefined : "node-peek"}
              cx={BOX_W - 13}
              cy={13}
              r={8}
              fill={isSelected ? NODE_COLORS.selected : "#eef2f7"}
              stroke={isSelected ? NODE_COLORS.selected : "#dde5ee"}
              strokeWidth={1}
            />
            <text
              className={isSelected ? undefined : "node-peek"}
              x={BOX_W - 13}
              y={16.5}
              fontSize={9}
              textAnchor="middle"
              fill={isSelected ? "#ffffff" : "#64748b"}
            >
              ⌕
            </text>

            {/* Stale Marker */}
            {c.knowledge === "stale" && c.seen_at !== undefined && (
              <text x={BOX_W - 10} y={BOX_H - 8} fill={NODE_COLORS.stale} fontSize={8} textAnchor="end" fontWeight="700">
                #{c.seen_at}
              </text>
            )}

            </g>

            {isSelected && <SelectionReticle />}
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
.stage-node { cursor: pointer; }
.stage-node rect, .stage-node circle, .stage-node text { transition: opacity .12s ease, fill .12s ease; }
.stage-node .node-peek { opacity: 0; }
.stage-node:hover .node-peek { opacity: 1; }
`;

/** A stage's neighbour, drawn as a thin rail beside the canvas: the architecture view is a
 *  slice of a pipeline, and this is the reminder that the slice has edges. */
function NeighbourRail({
  side,
  info,
  onSelect,
}: {
  side: "in" | "out";
  info: StageNeighbour;
  onSelect: (stageId: string) => void;
}) {
  const isLink = Boolean(info.stageId);
  return (
    <button
      type="button"
      className={`${styles.neighbourRail} ${side === "in" ? styles.neighbourIn : styles.neighbourOut} ${isLink ? "" : styles.neighbourTerminal}`}
      style={info.color ? { color: info.color } : undefined}
      disabled={!isLink}
      title={info.title}
      onClick={() => info.stageId && onSelect(info.stageId)}
    >
      <Icon icon={info.icon} className={styles.neighbourIcon} />
      <span className={styles.neighbourLabel}>{info.label}</span>
    </button>
  );
}

// ── Main PerformanceDashboard Component ──────────────────────────────────────

export default function PerformanceDashboard({
  isOpen,
  isVisible,
  onClose,
  onToggle,
  currentPhase = 0,
  dossierData,
  onOpenStakeholder,
}: PerformanceDashboardProps) {
  const isDashboardOpen = isOpen ?? isVisible ?? false;
  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else if (onToggle) onToggle();
  }, [onClose, onToggle]);

  const { emit, subscribe } = useGameWebSocket();
  // Same roster the dossier renders from, so an owner chip on the board shows the same face
  // as that stakeholder's own page instead of a generic stand-in.
  const { stakeholders } = useContext(StakeholderContext);
  const [graphState, setGraphState] = useState<GraphStatePayload | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedComp, setSelectedComp] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<LinkedNote | null>(null);

  /** Dossier notes that are about a given graph target, flattened across stakeholder pages. */
  const notesByTarget = useMemo(() => {
    const byTarget: Record<string, LinkedNote[]> = {};
    (dossierData ?? []).forEach((entry) => {
      (entry.intel_items ?? []).forEach((item) => {
        const target = item.target || item.debug?.target;
        if (!target) return;
        (byTarget[target] ||= []).push({ item, stakeholderName: entry.name });
      });
    });
    return byTarget;
  }, [dossierData]);

  const linkedNotes = selectedComp ? notesByTarget[selectedComp] ?? [] : [];

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
      if (openNote) setOpenNote(null);
      else if (selectedComp) setSelectedComp(null);
      else handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDashboardOpen, selectedComp, openNote, handleClose]);

  // Changing what is selected drops an open artifact: it belonged to the old selection.
  useEffect(() => {
    setOpenNote(null);
  }, [selectedComp, selectedStage]);

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

  /** The owner's dossier page, when the player has one for them. */
  const ownerEntry = selComponentData?.owner_id
    ? (dossierData ?? []).find((d) => d.stakeholder_id === selComponentData.owner_id)
    : undefined;

  const stageName = useCallback(
    (id: string) => pipelineStages.find((s) => s.id === id)?.name ?? id,
    [pipelineStages],
  );

  /**
   * What lies upstream and downstream of the stage on screen. A pipeline neighbour is a link;
   * a stage with none gets a terminal marker instead - the lifecycle has to start and end
   * somewhere, and saying so is better than leaving the edge blank.
   */
  const neighbours = useMemo(() => {
    if (!activeStage || !graphState) return { inbound: null, outbound: null };

    /** Every distinct stage on one side of this one. A stage can have more than one: the
     *  modelling stage is fed by both requirements and data, and monitoring loops back into
     *  both modelling and deployment. Naming only the first would misreport the pipeline. */
    const peers = (flows: FlowData[], side: "from" | "to") => {
      const other = side === "from" ? "to" : "from";
      const ids: string[] = [];
      flows.forEach((f) => {
        if (f[other] !== activeStage.id) return;
        if (f[side] === activeStage.id || ids.includes(f[side])) return;
        ids.push(f[side]);
      });
      return ids;
    };

    const listNames = (ids: string[]) =>
      ids.length <= 2
        ? ids.map(stageName).join(" and ")
        : `${stageName(ids[0])} +${ids.length - 1}`;

    const pipelineInto = peers(graphState.flows, "from");
    const pipelineOut = peers(graphState.flows, "to");
    const feedbackInto = peers(graphState.feedback_flows ?? [], "from");
    const feedbackOut = peers(graphState.feedback_flows ?? [], "to");

    const inbound: StageNeighbour = pipelineInto.length
      ? {
          icon: "ph:arrow-right-bold",
          label: `from ${listNames(pipelineInto)}`,
          title: `Fed by ${pipelineInto.map(stageName).join(", ")} - click to inspect ${stageName(pipelineInto[0])}`,
          stageId: pipelineInto[0],
        }
      : feedbackInto.length
        ? {
            icon: "ph:arrow-u-down-left-bold",
            label: `loops back from ${listNames(feedbackInto)}`,
            title: `Looped back into by ${feedbackInto.map(stageName).join(", ")} - click to inspect ${stageName(feedbackInto[0])}`,
            stageId: feedbackInto[0],
          }
        : {
            icon: "ph:arrows-clockwise-bold",
            label: "each cycle starts here",
            title: "Nothing upstream: every iteration of the project starts from this stage, at whatever maturity it has already reached.",
          };

    const outbound: StageNeighbour = pipelineOut.length
      ? {
          icon: "ph:arrow-right-bold",
          label: `to ${listNames(pipelineOut)}`,
          title: `Feeds ${pipelineOut.map(stageName).join(", ")} - click to inspect ${stageName(pipelineOut[0])}`,
          stageId: pipelineOut[0],
        }
      : feedbackOut.length
        ? {
            // Runtime automation, not a step back through the lifecycle: the deployed system
            // retrains and rolls itself back. The lifecycle carries on into the next cycle.
            icon: "ph:arrows-clockwise-bold",
            label: `runtime loops to ${listNames(feedbackOut)}`,
            title:
              `The running system drives ${feedbackOut.map(stageName).join(" and ")} on its own - retraining and rollback. ` +
              `That is automation inside this cycle, not a step back through it: the lifecycle carries on into the next iteration, ` +
              `which reopens ${stageName(pipelineStages[0]?.id ?? "")} with everything you have already built. ` +
              `Click to inspect ${stageName(feedbackOut[0])}.`,
            stageId: feedbackOut[0],
          }
        : {
            icon: "ph:arrows-clockwise-bold",
            label: "the cycle closes here",
            title: `Nothing downstream: this cycle ends here, and the next iteration reopens ${stageName(pipelineStages[0]?.id ?? "")} with everything you have already built.`,
          };

    return { inbound, outbound };
  }, [activeStage, graphState, stageName, pipelineStages]);

  const selectStage = useCallback((stageId: string) => {
    setSelectedStage(stageId);
    setSelectedComp(null);
  }, []);

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
        {/* Header matching PrePhaseDialog modal system. The phase rail lives here: it is
            orientation, not content, and hovering a phase reveals its description. */}
        <div className={styles.header}>
          <h4 className={styles.headerTitle}>
            <Icon
              icon="material-symbols:dashboard-rounded"
              style={{ fontSize: "1.45em", color: "#ffffff" }}
            />
            <span>Performance Dashboard</span>
          </h4>
          <div className={styles.headerPhases}>
            <PhaseOverview isTourAnchor />
          </div>
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
          {/* Metrics rail: one row of gauges, descriptions on hover */}
          <MetricTab current_phase={currentPhase} />

          {/* Project graph. Left column: stage strip over the stage architecture.
              Right column: the inspector, running the full height of both. */}
          <div className={styles.graphSection}>
            {graphState ? (
              <div className={styles.graphGrid}>
                <div className={styles.graphColumn}>
                  <div className={styles.sectionHeadRow}>
                    <span className={styles.sectionLabel}>
                      <Icon icon="ph:target-bold" style={{ fontSize: "1.05rem" }} /> MLOps Project Graph
                    </span>
                    {graphState.system_health !== undefined && (
                      <span
                        className={styles.systemHealth}
                        style={{
                          color: statusColor(
                            healthBucket(graphState.system_health) === "healthy" ? "healthy"
                              : healthBucket(graphState.system_health) === "strained" ? "degraded"
                              : "broken"
                          ),
                        }}
                      >
                        The system as a whole: {HEALTH_BUCKET_WORD[healthBucket(graphState.system_health)]}
                      </span>
                    )}
                  </div>

                  <div className={styles.stageStrip}>
                    <div style={{ width: "max-content", minWidth: "100%", padding: "2px 2px" }}>
                      <CrossStageArcs
                        pipelineStages={pipelineStages}
                        flows={graphState.feedback_flows ?? []}
                        centres={centres.centres}
                        width={centres.width}
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
                                <StageConnector flow={flow} toId={stage.id} />
                              )}
                              <button
                                type="button"
                                onClick={() => selectStage(stage.id)}
                                className={`${styles.stageButton} ${isStageActive ? styles.stageButtonActive : ""} ${stage.locked ? styles.stageButtonUpcoming : ""} ${!stage.locked && stage.status === "broken" ? "pipe-stage-failing" : ""}`}
                                title={stage.locked ? `${stage.name} is ahead of you - preview what it will contain` : `Click to inspect ${stage.name}`}
                              >
                                <div className="fw-bold" style={{ color: stage.locked ? "#64748b" : "var(--text-primary, #1e293b)" }}>
                                  {stage.name}
                                </div>
                                <div
                                  style={{
                                    fontSize: "0.72rem",
                                    fontWeight: 600,
                                    color: stage.locked ? "#94a3b8" : statusColor(stage.status),
                                  }}
                                >
                                  {healthText(stage)}
                                </div>

                                <div className={styles.stageClickHint}>
                                  <Icon icon="ph:cursor-click-bold" />
                                  <span>
                                    {isStageActive ? "Viewing" : stage.locked ? "Click to preview" : "Click to view"}
                                  </span>
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

                  {activeStage && activeTechnical && (
                    <>
                      {/* Subheader with Stage Info & Legend */}
                      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 pt-1">
                        <div className="d-flex align-items-center gap-2">
                          <h6 className="mb-0 fw-bold" style={{ color: "var(--text-primary, #1e293b)", fontSize: "0.92rem" }}>
                            {activeStage.name} Architecture
                          </h6>
                          <span
                            className="badge text-white"
                            style={{ background: activeStage.locked ? "#94a3b8" : statusColor(activeStage.status), fontSize: "0.72rem" }}
                          >
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

                      {/* SVG canvas, flanked by what comes before and after this stage */}
                      <div className={styles.canvasRow}>
                        {neighbours.inbound && (
                          <NeighbourRail side="in" info={neighbours.inbound} onSelect={selectStage} />
                        )}
                        <div className={styles.graphCanvasBox}>
                          <StageSvg
                            technical={activeTechnical}
                            selectedComponentId={selectedComp}
                            onSelectComponent={setSelectedComp}
                          />
                        </div>
                        {neighbours.outbound && (
                          <NeighbourRail side="out" info={neighbours.outbound} onSelect={selectStage} />
                        )}
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
                    </>
                  )}
                </div>

                {/* Right column: the inspector spans the strip and the architecture */}
                <div className={styles.detailsColumn}>
                  {openNote ? (
                    <div className={styles.detailsCard}>
                      <div className={styles.detailsCardHeader}>
                        <span className="d-flex align-items-center gap-2">
                          <Icon icon={noteSourceMeta(openNote.item).icon} />
                          <span>{selComponentData?.name ?? "Intel artifact"}</span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-link text-white text-decoration-none p-0"
                          onClick={() => setOpenNote(null)}
                          title="Back to the component"
                          style={{ fontSize: "0.78rem" }}
                        >
                          ✕ Close
                        </button>
                      </div>
                      <div className={styles.artifactBody}>
                        <IntelArtifactViewer
                          content={artifactContentOf(openNote.item) ?? ""}
                          artifactType={openNote.item.artifact?.artifact_type || openNote.item.artifact_type || "document"}
                          stakeholderName={openNote.item.artifact?.stakeholder_name || openNote.stakeholderName}
                          isPublicRecord={(openNote.item.source || "").toLowerCase() === "public_record"}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary m-2"
                        onClick={() => setOpenNote(null)}
                      >
                        ← Back to {selComponentData?.name ?? "component"}
                      </button>
                    </div>
                  ) : activeStage && activeTechnical ? (
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
                                  ownerEntry && onOpenStakeholder ? (
                                    <button
                                      type="button"
                                      className={styles.ownerLink}
                                      onClick={() => onOpenStakeholder(ownerEntry.stakeholder_id)}
                                      title={`Open ${ownerEntry.name}'s dossier page`}
                                    >
                                      <StakeholderAvatarComponent
                                        stakeholderId={ownerEntry.stakeholder_id}
                                        avatar={stakeholders[ownerEntry.stakeholder_id]?.avatar}
                                        stakeholderColor={stakeholders[ownerEntry.stakeholder_id]?.stakeholder_color}
                                        size={18}
                                        hoverToSuspicious={false}
                                        className={styles.ownerLinkAvatar}
                                      />
                                      <span>Owner: {ownerEntry.name}</span>
                                      <Icon icon="ph:arrow-square-out-bold" className={styles.ownerLinkGo} />
                                    </button>
                                  ) : (
                                    <span className="badge bg-light text-secondary border" style={{ fontSize: "0.68rem" }}>
                                      Owner: {selComponentData.owner_id.replace(/_/g, " ")}
                                    </span>
                                  )
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

                              {selComponentData.knowledge !== "unknown" && selComponentData.nominal_automation !== undefined ? (
                                <>
                                  <div className="p-2 rounded bg-light border">
                                    <div className="d-flex align-items-center justify-content-between mb-1">
                                      <span className="small text-muted fw-semibold">Automation:</span>
                                      <LevelPips nominal={selComponentData.nominal_automation} effective={selComponentData.effective_automation} />
                                    </div>
                                    <div className="small mb-2" style={{ color: "var(--text-primary, #1e293b)" }}>
                                      Runs <strong>{formatAxisLevel("automation", selComponentData.effective_automation ?? selComponentData.nominal_automation)}</strong>
                                      {selComponentData.capped_by && selComponentData.effective_automation !== undefined && selComponentData.effective_automation < selComponentData.nominal_automation && (
                                        <> (set up for <strong>{formatAxisLevel("automation", selComponentData.nominal_automation)}</strong>)</>
                                      )}
                                    </div>
                                    <div className="d-flex align-items-center justify-content-between mb-1">
                                      <span className="small text-muted fw-semibold">Governance:</span>
                                      <GovernancePips level={selComponentData.nominal_governance ?? 0} />
                                    </div>
                                    <div className="small" style={{ color: "var(--text-primary, #1e293b)" }}>
                                      Its output is <strong>{formatAxisLevel("governance", selComponentData.nominal_governance ?? 0)}</strong>
                                    </div>
                                  </div>

                                  {selComponentData.capped_by && selComponentData.effective_automation !== undefined && selComponentData.nominal_automation !== undefined && selComponentData.effective_automation < selComponentData.nominal_automation && (
                                    <div className="p-2 rounded" style={{ fontSize: "0.78rem", color: "#9a3412", background: "#fff7ed", border: "1px solid #ffedd5" }}>
                                      <strong>⛓ Held Back:</strong> Bottlenecked by <strong>{selComponentData.capped_by}</strong>. Raising this component changes nothing until that is addressed.
                                    </div>
                                  )}

                                  {selComponentData.debt && selComponentData.debt.length > 0 && (
                                    <div className="p-2 rounded" style={{ fontSize: "0.78rem", color: "#854d0e", background: "#fefce8", border: "1px solid #fef08a" }}>
                                      <strong>🧾 Technical Debt:</strong> {selComponentData.debt[0].axis === "governance" ? "Governance meant" : "Meant"} to be <strong>{formatAxisLevel(selComponentData.debt[0].axis ?? "automation", selComponentData.debt[0].intended)}</strong>, landed <strong>{formatAxisLevel(selComponentData.debt[0].axis ?? "automation", selComponentData.debt[0].applied)}</strong>
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
                                  {activeStage.locked
                                    ? "This component belongs to a stage you have not reached yet. Its name and wiring are part of the plan; its state becomes readable once the project gets there."
                                    : "You have not uncovered intel about this component yet. Verify stakeholder intel and resolve objections to unlock deeper insights."}
                                </p>
                              )}

                              {linkedNotes.length > 0 && (
                                <div>
                                  <span className="small text-muted fw-bold text-uppercase" style={{ fontSize: "0.68rem" }}>
                                    Intel on this component:
                                  </span>
                                  <div className={styles.noteLinkList}>
                                    {linkedNotes.map(({ item, stakeholderName }) => {
                                      const meta = noteSourceMeta(item);
                                      const openable = Boolean(artifactContentOf(item));
                                      return (
                                        <button
                                          key={item.id}
                                          type="button"
                                          className={`${styles.noteLink} ${openable ? "" : styles.noteLinkFlat}`}
                                          disabled={!openable}
                                          onClick={() => openable && setOpenNote({ item, stakeholderName })}
                                          title={openable ? `Open the ${meta.label.toLowerCase()}` : meta.label}
                                        >
                                          <Icon icon={meta.icon} className={styles.noteLinkIcon} />
                                          <span className={styles.noteLinkText}>
                                            {item.fact || item.description}
                                          </span>
                                          {openable && (
                                            <Icon icon="ph:arrow-square-out-bold" className={styles.noteLinkGo} />
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
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
                                <span>
                                  {activeStage.locked
                                    ? "This stage is ahead of you. You can see what it will contain, not how any of it is doing."
                                    : "Click any component in the diagram or list to view parameters."}
                                </span>
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
                                        {c.knowledge !== "unknown" && c.nominal_automation !== undefined && <AxisPips c={c} />}
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
                  ) : (
                    <div className={styles.detailsCard}>
                      <div className={styles.detailsCardHeader}>
                        <span className="d-flex align-items-center gap-2">
                          <Icon icon="ph:cards-bold" />
                          <span>Components</span>
                        </span>
                      </div>
                      <div className={styles.detailsCardBody}>
                        <p className="text-muted small mb-0">Pick a stage above to inspect its components.</p>
                      </div>
                    </div>
                  )}
                </div>
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
