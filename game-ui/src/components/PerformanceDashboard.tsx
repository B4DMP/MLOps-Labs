import { useState, useEffect, useCallback, useContext, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { Icon } from "@iconify/react";
import HoverTooltip, { HoverTooltipTheme, useTooltipController } from "./HoverToolTip";
import PhaseOverview from "./PhaseOverview";
import DashboardInspector from "./DashboardInspector";
import MetricTab from "./MetricTab";
import type { StakeholderDossierEntry } from "./StakeholderDossier";
import type { LinkedNote } from "./composeSidebar/IntelNoteRows";
import { StakeholderContext } from "./StakeholderProvider";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { healthBucket, HEALTH_BUCKET_WORD } from "../utils/systemHealth";
import {
  CrossPhaseStub,
  EDGE_FLOW_ANIM,
  edgeStrokeWidth,
  FlowParticle,
  NodeDefs,
  NODE_STATE_ANIM,
  TriggerChip,
} from "./graph/nodeChrome";
import StageNode from "./graph/StageNode";
import GraphLegend, { type LegendGroup } from "./graph/GraphLegend";
import YarnLine, { YarnMarkers } from "./graph/YarnLine";
import { CARD, EDGE_ON_CORK, edgeMarkerForLevel } from "./graph/cardPalette";
import ComposeTagDetail from "./composeSidebar/ComposeTagDetail";
import {
  formatAxisLevel,
  AUTOMATION_META,
  GOVERNANCE_META,
  TRIGGER_ICONS,
  compactLayout,
  edgeEnds,
  fitToBoxStyle,
  stubSideOccupied,
  STUB_DROP,
} from "../utils/stageCanvas";
import styles from "./PerformanceDashboard.module.css";

// ── Types ────────────────────────────────────────────────────────────────────

interface PatternRef {
  id: string;
  kind: "anti" | "design";
  name: string;
}

export interface StageData {
  id: string;
  name: string;
  locked: boolean;
  phase_id?: number;
  health?: number;
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

export interface ComponentData {
  id: string;
  name: string;
  stage_id: string;
  owner_id?: string;
  nominal_automation?: number;
  nominal_governance?: number;
  effective_automation?: number;
  effective_governance?: number;
  allowed_automation?: number[];
  allowed_governance?: number[];
  capped_by?: string;
  story?: string;
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
  automation?: number;
  governance?: number;
  trigger?: string;
  story?: string;
  capped_by?: string;
}

export interface TechnicalStage {
  components: ComponentData[];
  edges: EdgeData[];
}

/** A dependency edge that runs between two different phases: components are grouped one
 *  diagram per phase, so the far side is never on this canvas - the stub only records enough
 *  about it to draw the dangling line and explain it on click. */
export interface CrossPhaseStubInfo {
  edgeId: string;
  localCompId: string;
  direction: "out" | "in";
  /** Point right (toward later phases) or left (toward earlier ones, e.g. a feedback loop). */
  forward: boolean;
  otherName: string;
  otherStageName: string;
}

interface GraphStatePayload {
  stages: StageData[];
  flows: FlowData[];
  feedback_flows: FlowData[];
  technical: Record<string, TechnicalStage>;
  system_health: number;
  active_stage_id?: string | null;
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
  /** Opens the dossier on a specific intel item and pops it into view there. Intel
   *  references become links when this is given. */
  onSelectIntel?: (intelId: string, stakeholderId?: string) => void;
  /** Jump straight to this component's stage and selection - e.g. a link from the simulation
   *  debrief's Component Implementation Log. Re-jumps whenever the id changes. */
  focusComponentId?: string;
}

/** What sits on one side of the stage being inspected. */
interface StageNeighbour {
  icon: string;
  label: string;
  title: string;
  stageId?: string;
  color?: string;
}

const EMPTY_STAGES: StageData[] = [];

function statusColor(status?: string): string {
  if (status === "healthy") return "#1f7a45";
  if (status === "degraded") return CARD.capped;
  if (status === "broken") return CARD.broken;
  return "#64748b";
}
/** The key to the board, for this screen: the title-bar states, the meters, the strings, the flags. */
const LEGEND_BAR: CSSProperties = { width: "22px", height: "8px", borderRadius: "1px" };
const LEGEND_STRING: CSSProperties = { width: "22px", height: "3px", borderRadius: "2px", boxShadow: "0 0 0 1px rgba(40, 24, 8, 0.3)" };
function buildDashboardLegend(hasFeedback: boolean): LegendGroup[] {
  return [
    {
      heading: "Title bar (state)",
      items: [
        { label: "Running as built", swatch: { ...LEGEND_BAR, background: CARD.bar } },
        { label: "Held back by a bottleneck", swatch: { ...LEGEND_BAR, background: CARD.capped } },
        { label: "Starved: something upstream is broken", swatch: { ...LEGEND_BAR, background: CARD.starved } },
        { label: "Broken: its border tears", swatch: { ...LEGEND_BAR, background: CARD.broken } },
        { label: "A stage ahead of you", swatch: { ...LEGEND_BAR, background: CARD.viewOnly } },
      ],
    },
    {
      heading: "Automation track (meter, left)",
      items: [
        ...AUTOMATION_META.map((rung, i) => ({ label: `${i}. ${rung.label}`, swatch: { background: rung.color } })),
        { label: "Built but not running", swatch: { background: AUTOMATION_META[3].color, opacity: 0.33 } },
        { label: "Not built", swatch: { background: CARD.empty } },
      ],
    },
    {
      heading: "Governance track (meter, right)",
      items: GOVERNANCE_META.slice(1).map((rung, i) => ({ label: `${i + 1}. ${rung.label}`, swatch: { background: rung.color } })),
    },
    {
      heading: "Strings (hand-offs)",
      items: [
        { label: "Automated", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-success"] } },
        { label: "Partly automated or manual", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-warning"] } },
        { label: "Stalled", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-danger"] } },
        { label: "A stage ahead of you", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-viewonly"] } },
      ],
    },
    {
      heading: "Marks",
      items: [
        { label: "Flag: the component carries technical debt", icon: "ph:receipt-duotone", iconColor: CARD.debt },
        { label: "Corner brackets: selected", icon: "ph:corners-out-bold", iconColor: CARD.select },
        { label: "Dashed outline: a stage ahead of you", swatch: { border: `1.5px dashed ${CARD.ink}`, background: "#fcf8ec" } },
      ],
    },
    ...(hasFeedback
      ? [{ heading: "Stage strip", items: [{ label: "Feedback loop (the arcs above the strip)", swatch: { ...LEGEND_STRING, background: "#1f7a45" } }] }]
      : []),
  ];
}


function healthText(stage: StageData): string {
  if (stage.locked) return "not there yet";
  return HEALTH_BUCKET_WORD[healthBucket(stage.health)];
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

/** One line on a node's tooltip: what state it is in, in words. */
function nodeStatusLine(c: ComponentData, locked: boolean, nameOf: (id: string) => string): string {
  if (locked) return "This stage is ahead of you: its state is not readable yet.";
  if ((c.nominal_automation ?? 1) === 0) return "Current status: Broken";
  if (c.nominal_automation === undefined) return "You have not uncovered this component yet.";
  if ((c.effective_automation ?? 1) === 0) return "Current status: Starved. Something upstream is broken, so nothing reaches it.";
  if (c.capped_by) return `Current status: Held back by ${nameOf(c.capped_by)}`;
  return `Current: ${formatAxisLevel("automation", c.effective_automation ?? c.nominal_automation)} · ${formatAxisLevel(
    "governance",
    c.nominal_governance ?? 0
  )}`;
}

function StageSvg({
  technical,
  selectedComponentId,
  onSelectComponent,
  crossPhaseStubs = [],
  selectedCrossStubId,
  onSelectCrossStub,
  stageLocked,
  nameOf,
}: {
  technical: TechnicalStage;
  selectedComponentId: string | null;
  onSelectComponent: (id: string | null) => void;
  crossPhaseStubs?: CrossPhaseStubInfo[];
  selectedCrossStubId?: string | null;
  onSelectCrossStub?: (stub: CrossPhaseStubInfo) => void;
  /** The stage is ahead of the project: its cards are shown, not readable. */
  stageLocked: boolean;
  nameOf: (id: string) => string;
}) {
  const tip = useTooltipController();
  const hasLayout = technical.components.some((c) => c.layout);

  if (!hasLayout) return null;

  const { positions, width: svgW, height: svgH } = compactLayout(technical.components);
  const posOf = (id: string) => positions[id];

  // Cross-phase stubs point off the canvas's own edge into the margin - widen the viewBox to
  // give them room, but only for stages that actually have one, so every other stage keeps
  // drawing at its normal size.
  const stubMargin = crossPhaseStubs.length > 0 ? 40 : 0;
  const viewW = svgW + stubMargin * 2;

  return (
    <>
      <svg
        viewBox={`${-stubMargin} 0 ${viewW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        style={fitToBoxStyle(viewW, svgH)}
      >
        <style>{NODE_STATE_ANIM}</style>
        <style>{EDGE_FLOW_ANIM}</style>
        <NodeDefs prefix="dash" theme="cork" />
        <defs>
          <YarnMarkers />
        </defs>

        {/* Connecting edges: yarn pinned across the board, in the colour of how automated the hand-off is */}
        {technical.edges.map((e) => {
          const from = posOf(e.from_id);
          const to = posOf(e.to_id);
          if (!from || !to) return null;
          const [ax, ay, bx, by] = edgeEnds(from.x, from.y, to.x, to.y);
          // Flow is an automation question only; governance never changes what gets through.
          const lvl = e.automation;
          const marker = stageLocked ? "arr-viewonly" : edgeMarkerForLevel(lvl);
          const color = EDGE_ON_CORK[marker];
          const isAutomated = !stageLocked && lvl !== undefined && lvl !== null && lvl >= 3;
          return (
            <g key={e.id}>
              <YarnLine
                x1={ax}
                y1={ay}
                x2={bx}
                y2={by}
                marker={marker}
                width={Math.max(edgeStrokeWidth(lvl), 1.5) + 1}
                flowClass={
                  stageLocked ? undefined : lvl === 0 ? "pipe-dead" : lvl != null && lvl >= 3 ? "pipe-flow" : "pipe-flow-slow"
                }
                viewOnly={stageLocked}
              />
              {isAutomated && <FlowParticle x1={ax} y1={ay} x2={bx} y2={by} color={color} />}
              {e.trigger && e.trigger !== "none" && (
                <TriggerChip
                  x={(ax + bx) / 2}
                  y={(ay + by) / 2 - 4}
                  label={TRIGGER_ICONS[e.trigger] ?? "?"}
                  color={lvl === 0 ? "#b3202f" : lvl && lvl >= 3 ? "#1f7a45" : "#c2570c"}
                />
              )}
            </g>
          );
        })}

        {/* Component nodes: index cards pinned to the board */}
        {technical.components.map((c) => {
          const pos = posOf(c.id);
          if (!pos) return null;
          const isSelected = selectedComponentId === c.id;
          const isBroken = !stageLocked && (c.nominal_automation ?? 1) === 0;
          // Runs at nothing, but is not itself broken: something upstream is down. Saying BROKEN here
          // would blame the victim of a break for the break.
          const isStarved = !stageLocked && !isBroken && (c.effective_automation ?? 1) === 0;
          const rawName = c.name || c.id.split(".").pop()?.replace(/_/g, " ") || c.id;
          const nodeTip = tip.bind(
            <ComposeTagDetail
              label={rawName}
              lines={[
                nodeStatusLine(c, stageLocked, nameOf),
                c.debt && c.debt.length > 0 ? "Carries technical debt." : undefined,
                "Click to inspect",
              ]}
            />
          );
          return (
            <StageNode
              key={c.id}
              id={c.id}
              x={pos.x}
              y={pos.y}
              name={rawName}
              icon={c.icon}
              prefix="dash"
              state={{
                otherPhase: stageLocked,
                broken: isBroken,
                uncertain: false,
                // A held-back component keeps its own colour; broken wins over it, as before.
                capped: !stageLocked && Boolean(c.capped_by),
                starved: isStarved,
              }}
              automation={c.nominal_automation}
              effectiveAutomation={c.effective_automation}
              governance={c.nominal_governance}
              allowedAutomation={c.allowed_automation}
              allowedGovernance={c.allowed_governance}
              showMeter={c.nominal_automation !== undefined}
              titleSize={10.5}
              captionLevel={c.effective_automation ?? c.nominal_automation ?? 0}
              selected={isSelected}
              debt={Boolean(c.debt && c.debt.length > 0)}
              gProps={{
                onClick: () => onSelectComponent(isSelected ? null : c.id),
                ...nodeTip,
              }}
            />
          );
        })}

        {/* Cross-phase dependency stubs: the far end is never on this canvas, so they dangle */}
        {crossPhaseStubs.map((stub) => {
          const pos = posOf(stub.localCompId);
          if (!pos) return null;
          const laneSiblings = crossPhaseStubs.filter(
            (s) => s.localCompId === stub.localCompId && s.forward === stub.forward
          );
          const lane = laneSiblings.indexOf(stub) - (laneSiblings.length - 1) / 2;
          return (
            <CrossPhaseStub
              key={stub.edgeId}
              x={pos.x}
              y={pos.y + (stubSideOccupied(stub.localCompId, stub.forward, technical.edges, positions) ? STUB_DROP : 0)}
              forward={stub.forward}
              lane={lane}
              prefix="dash"
              id={stub.edgeId}
              idleColor="#0f6e7e"
              activeColor={CARD.select}
              active={selectedCrossStubId === stub.edgeId}
              onClick={() => onSelectCrossStub?.(stub)}
            />
          );
        })}
      </svg>
      {tip.bubble}
    </>
  );
}


// ── Animations ───────────────────────────────────────────────────────────────

const PIPELINE_ANIM = `
@keyframes pipeFailing {
  0%, 100% { border-color: #dc3545; }
  50% { border-color: rgba(220, 53, 69, 0.3); }
}
.pipe-stage-failing { animation: pipeFailing 1.8s ease-in-out infinite; }
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
    <HoverTooltip description={info.title}>
    <button
      type="button"
      className={`${styles.neighbourRail} ${side === "in" ? styles.neighbourIn : styles.neighbourOut} ${isLink ? "" : styles.neighbourTerminal}`}
      style={info.color ? { color: info.color } : undefined}
      disabled={!isLink}
      onClick={() => info.stageId && onSelect(info.stageId)}
    >
      <Icon icon={info.icon} className={styles.neighbourIcon} />
      <span className={styles.neighbourLabel}>{info.label}</span>
    </button>
    </HoverTooltip>
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
  onSelectIntel,
  focusComponentId,
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
  const [selectedCrossStub, setSelectedCrossStub] = useState<CrossPhaseStubInfo | null>(null);

  const selectComponent = useCallback((id: string | null) => {
    setSelectedComp(id);
    setSelectedCrossStub(null);
  }, []);

  const selectCrossStub = useCallback((stub: CrossPhaseStubInfo) => {
    setSelectedCrossStub((prev) => (prev?.edgeId === stub.edgeId ? null : stub));
    setSelectedComp(null);
  }, []);

  // Every component, across every stage the payload ships, keyed by id - cross-phase edges
  // need to know the far endpoint's name and stage even though it never appears on this canvas.
  const allComponentsById = useMemo(() => {
    const map = new Map<string, ComponentData>();
    if (!graphState?.technical) return map;
    Object.values(graphState.technical).forEach((tech) => {
      tech.components.forEach((c) => map.set(c.id, c));
    });
    return map;
  }, [graphState]);

  // Cross-phase edges, grouped by which stage each end belongs to. An edge is only ever
  // reported once (in its `from` component's stage list), so both ends are derived here.
  const crossPhaseStubsByStage = useMemo(() => {
    const byStage: Record<string, CrossPhaseStubInfo[]> = {};
    if (!graphState?.technical) return byStage;
    const stagesById = new Map((graphState.stages ?? []).map((s) => [s.id, s]));
    const seen = new Set<string>();
    Object.values(graphState.technical).forEach((tech) => {
      tech.edges.forEach((e) => {
        if (seen.has(e.id)) return;
        const fromComp = allComponentsById.get(e.from_id);
        const toComp = allComponentsById.get(e.to_id);
        if (!fromComp || !toComp || fromComp.stage_id === toComp.stage_id) return;
        seen.add(e.id);
        const fromPhase = stagesById.get(fromComp.stage_id)?.phase_id ?? 0;
        const toPhase = stagesById.get(toComp.stage_id)?.phase_id ?? 0;
        (byStage[fromComp.stage_id] ||= []).push({
          edgeId: e.id,
          localCompId: e.from_id,
          direction: "out",
          forward: toPhase > fromPhase,
          otherName: toComp.name || e.to_id,
          otherStageName: stagesById.get(toComp.stage_id)?.name || toComp.stage_id,
        });
        (byStage[toComp.stage_id] ||= []).push({
          edgeId: e.id,
          localCompId: e.to_id,
          direction: "in",
          forward: fromPhase > toPhase,
          otherName: fromComp.name || e.from_id,
          otherStageName: stagesById.get(fromComp.stage_id)?.name || fromComp.stage_id,
        });
      });
    });
    return byStage;
  }, [graphState, allComponentsById]);

  /** Dossier notes that are about a given graph target, flattened across stakeholder pages. */
  const notesByTarget = useMemo(() => {
    const byTarget: Record<string, LinkedNote[]> = {};
    (dossierData ?? []).forEach((entry) => {
      (entry.intel_items ?? []).forEach((item) => {
        const target = item.target || item.debug?.target;
        if (!target) return;
        (byTarget[target] ||= []).push({
          item,
          stakeholderName: entry.name,
          stakeholderId: entry.is_challenge_intel ? undefined : entry.stakeholder_id,
        });
      });
    });
    return byTarget;
  }, [dossierData]);

  const linkedNotes = selectedComp ? notesByTarget[selectedComp] ?? [] : [];

  // "3 found" when the total isn't known, "3 of 5 found" once the backend can say how many
  // intel items exist for this component in total. `target_total` is the same on every note
  // sharing a target, so the first one carries it.
  const linkedNotesTotal = linkedNotes[0]?.item.target_total;
  const linkedNotesLabel =
    linkedNotesTotal && linkedNotesTotal > linkedNotes.length
      ? `${linkedNotes.length} of ${linkedNotesTotal} found`
      : `${linkedNotes.length} found`;

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
      if (selectedComp || selectedCrossStub) {
        setSelectedComp(null);
        setSelectedCrossStub(null);
      } else handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDashboardOpen, selectedComp, selectedCrossStub, handleClose]);

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
      const targetStage =
        pipelineStages.find((s) => s.id === graphState?.active_stage_id && !s.locked) ||
        pipelineStages.find((s) => s.phase_id === Math.max(1, currentPhase) && !s.locked) ||
        unlockedStages[0] ||
        pipelineStages[0];
      if (targetStage) {
        setSelectedStage(targetStage.id);
      }
    }
  }, [selectedStage, pipelineStages, currentPhase, graphState?.active_stage_id]);

  // A link elsewhere (e.g. the simulation debrief's Component Implementation Log) jumps the
  // dashboard straight to a component - re-jumps whenever the id changes, same "changed since
  // last render" idiom as the dossier's focusIntelId. Waits on graphState since that's what
  // actually knows which stage the component lives in.
  const prevFocusComponentRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusComponentId || !graphState) return;
    if (focusComponentId === prevFocusComponentRef.current) return;
    prevFocusComponentRef.current = focusComponentId;
    const stage = pipelineStages.find((s) =>
      graphState.technical[s.id]?.components.some((c) => c.id === focusComponentId)
    );
    if (stage) {
      setSelectedStage(stage.id);
      selectComponent(focusComponentId);
    }
  }, [focusComponentId, graphState, pipelineStages, selectComponent]);

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

  /** Jump to a component that may sit on another stage (a held-back component names its bottleneck). */
  const jumpToComponent = useCallback(
    (id: string) => {
      const stage = (graphState?.stages ?? []).find((s) => graphState?.technical[s.id]?.components.some((c) => c.id === id));
      if (stage) setSelectedStage(stage.id);
      selectComponent(id);
    },
    [graphState, selectComponent]
  );

  const selectStage = useCallback((stageId: string) => {
    setSelectedStage(stageId);
    selectComponent(null);
  }, [selectComponent]);

  return (
    <HoverTooltipTheme variant="paper">
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
            <PhaseOverview />
          </div>
          <HoverTooltip description="Close Performance Dashboard (Esc)">
            <button
              type="button"
              className="btn-close btn-close-white"
              onClick={handleClose}
              aria-label="Close Performance Dashboard"
              style={{ cursor: "pointer" }}
            />
          </HoverTooltip>
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
                    <div style={{ width: "100%", minWidth: "100%", padding: "2px 2px" }}>
                      <CrossStageArcs
                        pipelineStages={pipelineStages}
                        flows={graphState.feedback_flows ?? []}
                        centres={centres.centres}
                        width={centres.width}
                      />
                      <div
                        ref={buttonsRowRef}
                        className="d-flex align-items-center gap-2 w-100"
                        style={{ position: "relative", zIndex: 5, marginTop: 4 }}
                      >
                        {pipelineStages.map((stage, i) => {
                          const flow = graphState.flows.find((f) => f.from === pipelineStages[i - 1]?.id && f.to === stage.id);
                          const isStageActive = selectedStage === stage.id;

                          return (
                            <div
                              key={stage.id}
                              className={`d-flex align-items-center gap-2 ${styles.stageSlot}`}
                              style={{ flex: "1 1 0", minWidth: 0 }}
                              ref={(el) => { stageRefs.current[stage.id] = el; }}
                            >
                              {i > 0 && (
                                <StageConnector flow={flow} toId={stage.id} />
                              )}
                              <HoverTooltip description={stage.locked ? `${stage.name} is ahead of you - preview what it will contain` : `Click to inspect ${stage.name}`}>
                              <button
                                type="button"
                                onClick={() => selectStage(stage.id)}
                                className={`${styles.stageButton} ${isStageActive ? styles.stageButtonActive : ""} ${stage.locked ? styles.stageButtonUpcoming : ""} ${!stage.locked && stage.status === "broken" ? "pipe-stage-failing" : ""}`}
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
                                      <HoverTooltip key={p.id} description={p.name}>
                                        <span
                                          style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: "50%",
                                            background: p.kind === "anti" ? "#dc3545" : "#16a34a",
                                            display: "inline-block",
                                          }}
                                        />
                                      </HoverTooltip>
                                    ))}
                                  </div>
                                )}
                              </button>
                              </HoverTooltip>
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

                        {/* Legend: the key to the board, on demand */}
                        <GraphLegend groups={buildDashboardLegend((graphState.feedback_flows?.length ?? 0) > 0)} tone="light" />
                      </div>

                      {/* Active Patterns */}
                      {activeStage.patterns && activeStage.patterns.length > 0 && (
                        <div className="d-flex gap-1 flex-wrap">
                          {activeStage.patterns.map((p) => (
                            <HoverTooltip key={p.id} description={p.id}>
                              <span
                                className="badge"
                                style={{ background: p.kind === "anti" ? "#dc3545" : "#16a34a", fontSize: "0.7rem" }}
                              >
                                {p.name}
                              </span>
                            </HoverTooltip>
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
                            onSelectComponent={selectComponent}
                            crossPhaseStubs={activeStage ? crossPhaseStubsByStage[activeStage.id] ?? [] : []}
                            selectedCrossStubId={selectedCrossStub?.edgeId ?? null}
                            onSelectCrossStub={selectCrossStub}
                            stageLocked={activeStage.locked}
                            nameOf={(id) => allComponentsById.get(id)?.name ?? id}
                          />
                        </div>
                        {neighbours.outbound && (
                          <NeighbourRail side="out" info={neighbours.outbound} onSelect={selectStage} />
                        )}
                      </div>

                      {/* Non-pipeline edges summary */}
                      {activeTechnical.edges.filter((e) => e.kind !== "pipeline").length > 0 && (
                        <div className={styles.connectionsNote}>
                          <span className="fw-bold text-secondary text-uppercase" style={{ fontSize: "0.68rem" }}>Cross-Stage Connections: </span>
                          {activeTechnical.edges.filter((e) => e.kind !== "pipeline").map((e, idx) => (
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
                  {activeStage && activeTechnical ? (
                    <DashboardInspector
                      stage={activeStage}
                      technical={activeTechnical}
                      selectedComponent={selComponentData ?? null}
                      selectedCrossStub={selectedCrossStub}
                      linkedNotes={linkedNotes}
                      linkedNotesLabel={linkedNotesLabel}
                      stakeholders={stakeholders}
                      ownerEntry={ownerEntry}
                      onOpenStakeholder={onOpenStakeholder}
                      onSelectIntel={onSelectIntel}
                      onSelectComponent={selectComponent}
                      onClearSelection={() => {
                        setSelectedComp(null);
                        setSelectedCrossStub(null);
                      }}
                      onJumpToComponent={jumpToComponent}
                      nameOf={(id) => allComponentsById.get(id)?.name ?? id}
                    />
                  ) : (
                    <div className={styles.detailsEmpty}>Pick a stage above to inspect its components.</div>
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
    </HoverTooltipTheme>
  );
}
