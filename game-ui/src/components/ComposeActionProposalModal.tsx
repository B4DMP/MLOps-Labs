import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";
import { Icon } from "@iconify/react";
import styles from "./ComposeActionProposalModal.module.css";
import sb from "./composeSidebar/ComposeSidebar.module.css";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { AnimatePresence } from "motion/react";
import HoverTooltip, { HoverTooltipTheme, useTooltipController } from "./HoverToolTip";
import ComposeTagDetail, { type TagLine } from "./composeSidebar/ComposeTagDetail";
import IntelNoteRows, { type LinkedNote, type NoteBoardMark } from "./composeSidebar/IntelNoteRows";
import OptionLadder from "./composeSidebar/OptionLadder";
import ProposalTickets, { type ProposalEntry } from "./composeSidebar/ProposalTickets";
import { AxisChip, Chip, ChipRow, DependencyChip, type DependencyState } from "./composeSidebar/StatusChips";
import { firstSentence } from "../utils/firstSentence";
import { litTargets } from "../utils/litTargets";
import CoachTip, { type CoachIconKey } from "./CoachTip";
import { useGuideNarration } from "./useGuideNarration";
import { useNarratorGate } from "./useNarratorGate";
import { isCoachTipOpen } from "../utils/introCoach";
import {
  COMPOSE_KEYS,
  completedKeys,
  type ComposeStepId,
  buildGuideWhy,
  onComposeGuideReset,
  plainAutomation,
  resolveMarkers,
  pickComposeStep,
  pickGuideTarget,
  chainStatus,
  wantedLevelFor,
  findCappedStep,
  readComposeSeen,
  writeComposeSeen,
} from "../utils/composeGuide";
import { sameAsLastPitch } from "../utils/sameCard";
import { describeHandoff } from "../utils/edgeSummary";
import { GRAPH_HINTS, GRAPH_HINT_OPTION, GRAPH_HINT_TARGET } from "../content/graphHelp";
import { COACH_TIPS, COMPOSE_GUIDE, PITCH_GUIDE } from "../content/helpCopy";
import type { Stakeholder } from "./StakeholderProvider";
import type { StakeholderDossierEntry } from "./StakeholderDossier";
import { StakeholderAvatarComponent } from "./StakeholderAvatarComponent";
import { useGlossaryHighlighter } from "./glossary/GlossaryText";
import {

  CrossPhaseStub,
  EDGE_FLOW_ANIM,
  edgeStrokeWidth,
  FlowParticle,
  LevelMeter,
  NodeDefs,
  NodeIcon,
  NodeTitleAberration,
  BrokenBorder,
  LevelCaption,
  NODE_STATE_ANIM,
  SelectionReticle,
  EdgeHandle,
} from "./graph/nodeChrome";
import {
  BOX_W,
  BOX_H,
  NODE_COLORS,
  NODE_ICON_OFFSET,
  NODE_CAPTION_Y,
  NODE_METER_Y,
  NODE_PAD_X,
  NODE_TITLE_LH,


  nodeFace,
  compactLayout,
  crossPhaseExplanation,
  edgeEnds,
  fitToBoxStyle,
  formatAxisLevel,
  formatTrigger,
  AUTOMATION_META,
  GOVERNANCE_META,
  levelRungs,
  TRIGGER_ICONS,
  wrapLabel,
  type Axis,
} from "../utils/stageCanvas";
import type { AtomicChange, ItemPrediction } from "../types/ActionCard";
import {
  AXES,
  addOption,
  describeAtomicChange,
  dropUnscopedChanges,
  isImplemented,
  nominalOn,
  optionDisplayName,
  optionStatus,
  optionsOn,
  projectedOn,
  removeChangeAt,
  type GraphOption,
  type OptionTarget,
} from "../utils/graphOptions";

// Level labels and formatters live in utils/stageCanvas and utils/graphOptions; import them
// from there. Only types are re-exported here, for the screens that already import them.
export type { AtomicChange, ItemPrediction } from "../types/ActionCard";
export type { GraphOption } from "../utils/graphOptions";

/**
 * Collapses multiple slots that ended up targeting the same graph element down to one. A saved
 * proposal can carry a stale duplicate - e.g. an older `raise_to 1` for `req.acceptance_criteria`
 * left in place alongside a newer `raise_to 4` for the same target - which otherwise burns one of
 * only `MAX_ATOMIC_CHANGES` slots on a second, misleading row for a target that already has one.
 *
 * `raise_to` is monotonic (the composer only ever lets a player raise a target, never lower it),
 * so for numeric values the higher one is the one the player actually meant - array position
 * alone doesn't say which came later. Non-numeric changes (trigger) fall back to keeping
 * whichever occurs last, since there's no ordering to compare them by.
 */
/** A change touching both axes of the same target is two legitimate slots, not a duplicate - so
 *  the dedup key carries the axis. */
/** Everything that makes two changes the same slot - deliberately including `value`: a target
 *  can carry several genuinely different steps chained on the same axis ("Implement It Manually" then
 *  "Automate It", one slot each), and those must never collapse into each other. Only a change
 *  indistinguishable in every field from another is the stale duplicate this guards against. */
function dedupeKey(c: AtomicChange): string {
  return `${c.target}::${c.kind ?? "raise_to"}::${c.axis ?? ""}::${c.value}::${c.trigger ?? ""}`;
}

export function dedupeAtomicChanges(changes: AtomicChange[]): AtomicChange[] {
  const seen = new Set<string>();
  return changes.filter((c) => {
    const key = dedupeKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ComponentData {
  id: string;
  name: string;
  stage_id?: string;
  owner_id?: string;
  nominal_automation?: number;
  nominal_governance?: number;
  effective_automation?: number;
  effective_governance?: number;
  allowed_automation?: number[];
  allowed_governance?: number[];
  automation_options?: GraphOption[];
  governance_options?: GraphOption[];
  capped_by?: string;
  story?: string;
  icon?: string;
  help?: string;
  layout?: { x: number; y: number };
}

export interface EdgeData {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
  automation?: number;
  governance?: number;
  trigger?: string;
  allowed_automation?: number[];
  allowed_governance?: number[];
  allowed_triggers?: string[];
  automation_options?: GraphOption[];
  governance_options?: GraphOption[];
  slack?: number;
  capped_by?: string;
  story?: string;
}

export interface TechnicalStage {
  components: ComponentData[];
  edges: EdgeData[];
}

/** A dependency edge that runs between two different phases: components are grouped one
 *  diagram per phase, so the far side is never on this canvas - the stub only records enough
 *  about it to draw the dangling line and explain it on click. */
interface CrossPhaseStubInfo {
  edgeId: string;
  localCompId: string;
  direction: "out" | "in";
  /** Point right (toward later phases) or left (toward earlier ones, e.g. a feedback loop). */
  forward: boolean;
  otherName: string;
  otherStageName: string;
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
  active_stage_id?: string | null;
}

export interface ComposeActionProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhase: number;
  currentChallenge: number;
  initialAtomicChanges?: AtomicChange[];
  /** The card as last pitched; confirming is blocked until the proposal differs from it. */
  lastPitchedChanges?: AtomicChange[];
  /** Opens the composer with this target already selected in the inspector - e.g. the player
   *  clicked a specific change row on the pitch deck's card rather than the card generally. */
  initialSelectedTargetId?: string;
  onConfirmProposal: (atomicChanges: AtomicChange[]) => void;
  allowedTargets?: string[];
  upstreamMap?: Record<string, string[]>;
  /** Case board rifts the player confirmed that a Trade-off can settle: the notes behind each side. */
  compromisePairs?: Array<{ relation_id: string; a: string; b: string; target: string; item_ids: string[] }>;
  /** Case board chains the player confirmed: this target's change comes after another person's step. */
  afterNotes?: Array<{ relation_id: string; target: string; waits: string; after: string; after_name: string; via?: string | null }>;
  /** Case board shared steps the player confirmed: two people have a stance on this target. */
  sharedSteps?: Array<{ relation_id: string; target: string; a_name: string; b_name: string }>;
  /** Case board allies the player confirmed (pushing the same way): the notes behind each side. */
  allyPairs?: Array<{ relation_id: string; a: string; b: string; a_name: string; b_name: string; item_ids: string[] }>;
  /** Notes lit elsewhere (hovered on the case board); shown lit here. */
  litIntelIds?: ReadonlyMap<string, string>;
  /** Told which note the cursor is on here (null: none), so the case board can light it too. */
  onLitIntel?: (intelId: string | null) => void;
  /** One entry per (target, axis) slotted. */
  predictions?: ItemPrediction[];
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
  /** The player's dossier, so a fogged target can name the notes that point at it. */
  dossierData?: StakeholderDossierEntry[];
  stakeholders?: Record<string, Stakeholder>;
  getStakeholderColor?: (st: any) => string;
  /** Opens the stakeholder's dossier page. Owner chips become links when this is given. */
  onOpenStakeholder?: (stakeholderId: string) => void;
  /** Jumps the (already open, embedded) dossier to a specific intel item and pops it into
   *  view there. Intel references become links when this is given. */
  onSelectIntel?: (intelId: string, stakeholderId?: string) => void;
  /** The same intel-readiness figures the pitch deck's own "Intel" stat chip reads
   *  (pitchState.intel_total / intel_verified) - shown here identically so the two screens
   *  never disagree about how ready the player is to pitch. */
  intelTotal?: number;
  intelVerified?: number;
  /** Shows a "?" in the header that asks the host to open the cheat sheet on its MLOps Graph
   *  tab. The composer stays mounted underneath so the replayed walkthrough can find its markup. */
  onOpenCheatSheet?: () => void;
  /** Opens the dossier's Case board tab, which sits beside the composer. The hints about it show only when given. */
  onOpenBoard?: () => void;
  /** The host has something else on screen (cheat sheet, coach tip, tour, start gate); the guide waits. */
  guidePaused?: boolean;
  /** Hand the Pen (docs/plans/hand-over-the-pen.md): the currently sealed draft, if any. Never
   *  carries the drafted change itself - only the reservation, so nothing leaks before reveal. */
  pen?: { stakeholder_id: string; target: string; revealed: boolean } | null;
  /** Hands `target` over to `stakeholderId` to draft themselves. Irreversible once sent. */
  onDelegate?: (stakeholderId: string, target: string) => void;
}

const MAX_ATOMIC_CHANGES = 4;
const EMPTY_LIT: ReadonlyMap<string, string> = new Map();

/** Nodes are index cards pinned to the corkboard: warm ink for outline and text, a brown title bar
 *  when all is well, and a colour only when something needs attention. */
const CARD = {
  ink: "#2b2118",
  bar: "#3b2a1e",
  proposed: "#1d7f94",
  select: "#3b2412",
  predecessor: "#1d4ed8",
  empty: "#bfae8a",
  broken: "#9d1c2a",
  capped: "#9a3f0b",
  uncertain: "#76530b",
  viewOnly: "#6e5f4d",
  /** Hand the Pen: reserved for someone else to draft, sealed until the pitch reveals it. */
  sealed: "#6b21a8",
} as const;
/** Height of a node's title bar: two lines of title, centred. */
const BAR_H = 34;

/**
 * A node's title bar carries its state. Healthy is plain ink: only what needs attention takes a
 * colour, so a problem is the first thing the eye lands on. The inspector's header mirrors it.
 */
function nodeBar(s: { otherPhase: boolean; broken: boolean; uncertain: boolean; capped: boolean }): {
  fill: string;
  ink: string;
} {
  const fill = s.otherPhase
    ? CARD.viewOnly
    : s.broken
    ? CARD.broken
    : s.uncertain
    ? CARD.uncertain
    : s.capped
    ? CARD.capped
    : CARD.bar;
  return { fill, ink: "#ffffff" };
}

/** Strings on the board: the line colours, chosen to read on cork. Arrowheads use the same. */
const EDGE_ON_CORK: Record<string, string> = {
  "arr-default": "#efe3c8",
  "arr-viewonly": "#c4b595",
  "arr-primary": "#7fdcec",
  "arr-predecessor": "#9dbcff",
  "arr-success": "#55d38c",
  "arr-danger": "#ff6678",
  "arr-warning": "#ffa04a",
};
const LIT_GLOW = "rgba(255, 246, 205, 0.95)";

/** A card's tilt, fixed by its id: pinned cards are never quite square to the board. */
function cardTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return ((h % 5) - 2) * 0.3;
}

/**
 * Canvas legend, shown on hover rather than permanently occupying a toolbar row. It reads a card in the
 * order it is drawn: the title bar says how it is doing, the meter along its bottom says how far it is
 * built, the flag and outline say what you may do with it, and the strings between cards say how
 * automated the hand-off is.
 */
const LEGEND_BAR: CSSProperties = { width: "22px", height: "8px", borderRadius: "1px" };
const LEGEND_STRING: CSSProperties = { width: "22px", height: "3px", borderRadius: "2px", boxShadow: "0 0 0 1px rgba(40, 24, 8, 0.3)" };
const LEGEND_GROUPS: Array<{
  heading: string;
  items: Array<{ label: string; swatch?: CSSProperties; glyph?: string; icon?: string; iconColor?: string }>;
}> = [
  {
    heading: "Title bar (state)",
    items: [
      { label: "Running as built", swatch: { ...LEGEND_BAR, background: CARD.bar } },
      { label: "Held back by a bottleneck", swatch: { ...LEGEND_BAR, background: CARD.capped } },
      { label: "Upstream still unknown", swatch: { ...LEGEND_BAR, background: CARD.uncertain } },
      { label: "Broken: its border tears", swatch: { ...LEGEND_BAR, background: CARD.broken } },
      { label: "Another phase: view only", swatch: { ...LEGEND_BAR, background: CARD.viewOnly } },
    ],
  },
  {
    heading: "Automation track (meter, left)",
    items: [
      ...AUTOMATION_META.map((rung, i) => ({
        label: `${i}. ${rung.label}`,
        swatch: { background: rung.color },
      })),
      { label: "Built but not running", swatch: { background: AUTOMATION_META[3].color, opacity: 0.33 } },
      { label: "Planned in your proposal", swatch: { background: NODE_COLORS.selected, opacity: 0.45 } },
      { label: "Not built", swatch: { background: CARD.empty } },
    ],
  },
  {
    heading: "Governance track (meter, right)",
    items: [
      ...GOVERNANCE_META.slice(1).map((rung, i) => ({
        label: `${i + 1}. ${rung.label}`,
        swatch: { background: rung.color },
      })),
      { label: "Above this target's ceiling", swatch: { border: `1px dashed ${CARD.empty}`, background: "transparent" } },
    ],
  },
  {
    heading: "Strings (hand-offs)",
    items: [
      { label: "Automated", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-success"] } },
      { label: "Partly automated or manual", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-warning"] } },
      { label: "Stalled", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-danger"] } },
      { label: "Not yet rated", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-default"] } },
      { label: "In your proposal, or selected", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-primary"] } },
      { label: "Another phase: view only", swatch: { ...LEGEND_STRING, background: EDGE_ON_CORK["arr-viewonly"] } },
    ],
  },
  {
    heading: "Marks",
    items: [
      { label: "Flag: a step of yours is attached", icon: "ph:hammer-duotone", iconColor: CARD.proposed },
      { label: "Corner brackets: selected", icon: "ph:corners-out-bold", iconColor: CARD.select },
      { label: "Dashed outline: another phase, view only", swatch: { border: `1.5px dashed ${CARD.ink}`, background: "#fcf8ec" } },
      {
        label: "Lifted with a shadow: a note you are pointing at",
        swatch: { border: `1px solid ${CARD.ink}`, background: "#fcf8ec", boxShadow: "0 3px 3px rgba(40, 24, 8, 0.45)" },
      },
      {
        label: "Handle on a string: the connection is editable",
        swatch: { border: "1.25px solid #64748b", background: "#ffffff", borderRadius: "9999px", height: "11px" },
      },
    ],
  },
];

export default function ComposeActionProposalModal({
  isOpen,
  onClose,
  currentPhase,
  currentChallenge,
  initialAtomicChanges = [],
  lastPitchedChanges = [],
  initialSelectedTargetId,
  onConfirmProposal,
  allowedTargets = [],
  upstreamMap = {},
  compromisePairs = [],
  afterNotes = [],
  sharedSteps = [],
  allyPairs = [],
  litIntelIds = EMPTY_LIT,
  onLitIntel,
  predictions = [],
  boundaryWarnings: _boundaryWarnings = [],
  // Superseded by dossierData's own intel_total for the header's found/total count, which
  // reflects everything the player has actually found rather than just this challenge's set.
  intelItems: _intelItems = [],
  graphState: propGraphState = null,
  dossierData = [],
  stakeholders = {},
  getStakeholderColor,
  onOpenStakeholder,
  onSelectIntel,
  intelTotal = 0,
  intelVerified = 0,
  onOpenCheatSheet,
  onOpenBoard,
  guidePaused = false,
  pen = null,
  onDelegate,
}: ComposeActionProposalModalProps) {
  const { emit, subscribe, userId } = useGameWebSocket();
  const gate = useNarratorGate();
  const highlight = useGlossaryHighlighter("action_proposal");
  // The ally threads this note sits behind, named by the person on the other side.
  const allyOf = (note: LinkedNote) =>
    allyPairs
      .filter((p) => p.item_ids.includes(note.item.id))
      .map((p) => ({ relation_id: p.relation_id, other: note.stakeholderId === p.a ? p.b_name : p.a_name }));

  const [localGraphState, setLocalGraphState] = useState<GraphStatePayload | null>(propGraphState);
  // A saved proposal can carry a stale duplicate slot for the same (target, axis) (see
  // dedupeAtomicChanges), or a change against a target outside the current scope - both cleaned
  // up once here so neither burns a slot nor double-counts.
  const initialAtomicChangesResolved = useMemo(
    () => dropUnscopedChanges(dedupeAtomicChanges(initialAtomicChanges)),
    [initialAtomicChanges]
  );
  const [atomicChanges, setAtomicChanges] = useState<AtomicChange[]>(initialAtomicChangesResolved);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedCrossStub, setSelectedCrossStub] = useState<CrossPhaseStubInfo | null>(null);
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [activeStageId, setActiveStageId] = useState<string>("req");
  // Hand the Pen: the "who drafts this?" picker for the currently selected component.
  const [delegatePickerOpen, setDelegatePickerOpen] = useState(false);

  // A cross-phase stub isn't a real target - selecting a real one always drops it, without
  // touching every place that already sets selectedCompId/selectedEdgeId. Deselecting a real
  // target (both go back to null) does not fire this, so a stub click - which also clears
  // the other two - is not immediately undone by this effect.
  useEffect(() => {
    if (selectedCompId || selectedEdgeId) setSelectedCrossStub(null);
  }, [selectedCompId, selectedEdgeId]);

  // Switching targets drops any pending "Hand it over" confirmation for the previous one.
  useEffect(() => {
    setDelegatePickerOpen(false);
  }, [selectedCompId]);

  // Whether to leave the composer, or discard its slots, needs confirming first: null means
  // no confirmation is pending, otherwise which action is waiting on one.
  const [confirmingLeave, setConfirmingLeave] = useState<"close" | "discard" | null>(null);
  // The "PROPOSED" stamp lands for a beat before the composer closes.
  const [stamping, setStamping] = useState(false);

  // Slotted changes only ever reach the parent (and the stakeholders) via Confirm - closing
  // the composer any other way, or discarding, throws away anything since the last confirm.
  const isDirty = useMemo(
    () => JSON.stringify(atomicChanges) !== JSON.stringify(initialAtomicChangesResolved),
    [atomicChanges, initialAtomicChangesResolved]
  );

  const unchangedSinceLastPitch = useMemo(
    () => sameAsLastPitch(atomicChanges, lastPitchedChanges),
    [atomicChanges, lastPitchedChanges]
  );

  // Intro-only hint ladder; local state, reset when the challenge changes.
  const [hintLevel, setHintLevel] = useState(0);
  useEffect(() => setHintLevel(0), [currentChallenge]);

  const requestClose = useCallback(() => {
    if (isDirty) setConfirmingLeave("close");
    else onClose();
  }, [isDirty, onClose]);

  const requestDiscard = useCallback(() => {
    if (isDirty) setConfirmingLeave("discard");
    else setAtomicChanges([]);
  }, [isDirty]);

  const confirmLeave = () => {
    if (confirmingLeave === "close") onClose();
    else if (confirmingLeave === "discard") setAtomicChanges([]);
    setConfirmingLeave(null);
  };
  const cancelLeave = () => setConfirmingLeave(null);

  // Native "leave site?" prompt for a page refresh or tab close - the in-app confirmation
  // above only covers ways of leaving that this component can intercept.
  useEffect(() => {
    if (!isOpen || !isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isOpen, isDirty]);

  // One tooltip for the whole composer, drawn by the same box as HoverTooltip. `tagProps` binds it
  // to what a HoverTooltip wrapper would break: SVG nodes and edges, the stage chevrons, header chips.
  const tip = useTooltipController();
  const tagProps = (label: string, detail?: string | TagLine[]) =>
    tip.bind(
      <ComposeTagDetail label={label} lines={detail === undefined ? undefined : Array.isArray(detail) ? detail : [detail]} />
    );

  useEffect(() => {
    if (propGraphState) {
      setLocalGraphState(propGraphState);
    }
  }, [propGraphState]);

  const graphState = localGraphState || propGraphState;

  // Reset state on open - or, if the player clicked a specific change row rather than the
  // pitch deck's card generally, jump straight to that target's inspector instead of clearing
  // the selection. allEdgesMap/allComponentsMap are read here rather than listed as effect
  // deps: they're derived from graph state that ticks fairly often while the modal is open, and
  // re-running this on every tick would yank the player's own in-modal selection back to the
  // opening target.
  useEffect(() => {
    if (isOpen) {
      setAtomicChanges(initialAtomicChangesResolved);
      if (initialSelectedTargetId && allEdgesMap.has(initialSelectedTargetId)) {
        setSelectedEdgeId(initialSelectedTargetId);
        setSelectedCompId(null);
      } else if (initialSelectedTargetId && allComponentsMap.has(initialSelectedTargetId)) {
        setSelectedCompId(initialSelectedTargetId);
        setSelectedEdgeId(null);
      } else {
        setSelectedCompId(null);
        setSelectedEdgeId(null);
      }
      setHoveredCompId(null);
      setHoveredEdgeId(null);
      setConfirmingLeave(null);
      setStamping(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialAtomicChangesResolved, initialSelectedTargetId]);

  // Escape unwinds one layer at a time, as it does in the Performance Dashboard: first a
  // pending leave-confirmation, then the thing you have selected, then the composer itself
  // (routed through the same dirty check as the close button, not straight to onClose).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmingLeave) {
        cancelLeave();
      } else if (selectedCompId || selectedEdgeId || selectedCrossStub) {
        setSelectedCompId(null);
        setSelectedEdgeId(null);
        setSelectedCrossStub(null);
      } else {
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, selectedCompId, selectedEdgeId, selectedCrossStub, confirmingLeave, requestClose]);

  // Request graph state on open and listen to live updates
  useEffect(() => {
    if (!isOpen) return;
    emit("graph:state_request", { phase_id: currentPhase });
    const unsub = subscribe("graph:state", (data: GraphStatePayload) => {
      setLocalGraphState(data);
    });
    return unsub;
  }, [isOpen, currentPhase, emit, subscribe]);

  // The backend knows which stage a phase plays in (the demo phase is not the first one).
  const phaseStageId = useMemo(() => {
    if (!graphState?.stages) return "req";
    if (graphState.active_stage_id) return graphState.active_stage_id;
    const st = graphState.stages.find((s) => s.phase_id === Math.max(1, currentPhase));
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

  // Dependencies that cross a phase boundary (e.g. the feature store feeding CI/CD two phases
  // later) - the far endpoint is never part of this stage's own components, so
  // `currentStageTechnical` drops them entirely. `allEdgesMap`/`allComponentsMap` already carry
  // every stage's topology though (an edge is reported once, in its `from` component's stage),
  // which is enough to draw a stub on whichever end sits in the currently active stage.
  const crossPhaseStubs = useMemo(() => {
    const stubs: CrossPhaseStubInfo[] = [];
    if (!graphState?.stages) return stubs;
    const stagesById = new Map(graphState.stages.map((s) => [s.id, s]));
    const activePhase = stagesById.get(activeStageId)?.phase_id ?? 0;
    allEdgesMap.forEach((e) => {
      const fromComp = allComponentsMap.get(e.from_id);
      const toComp = allComponentsMap.get(e.to_id);
      if (!fromComp || !toComp || fromComp.stage_id === toComp.stage_id) return;
      if (fromComp.stage_id === activeStageId) {
        const otherPhase = stagesById.get(toComp.stage_id ?? "")?.phase_id ?? 0;
        stubs.push({
          edgeId: e.id,
          localCompId: e.from_id,
          direction: "out",
          forward: otherPhase > activePhase,
          otherName: toComp.name || e.to_id,
          otherStageName: stagesById.get(toComp.stage_id ?? "")?.name || toComp.stage_id || "",
        });
      }
      if (toComp.stage_id === activeStageId) {
        const otherPhase = stagesById.get(fromComp.stage_id ?? "")?.phase_id ?? 0;
        stubs.push({
          edgeId: e.id,
          localCompId: e.to_id,
          direction: "in",
          forward: otherPhase > activePhase,
          otherName: fromComp.name || e.from_id,
          otherStageName: stagesById.get(fromComp.stage_id ?? "")?.name || fromComp.stage_id || "",
        });
      }
    });
    return stubs;
  }, [graphState, allComponentsMap, allEdgesMap, activeStageId]);

  // Helper to determine if a node or edge can be edited in current phase/challenge
  const isTargetEditable = useCallback(
    (targetId: string, targetType: "component" | "edge", targetStageId?: string): { editable: boolean; reason?: string } => {
      const comp = allComponentsMap.get(targetId);
      const edge = allEdgesMap.get(targetId);

      // 1. Stage / Phase check
      const sId = targetStageId || comp?.stage_id || (edge ? allComponentsMap.get(edge.to_id)?.stage_id : undefined);
      if (sId && sId !== phaseStageId) {
        const stageObj = graphState?.stages?.find((s) => s.id === sId);
        const pNum = stageObj?.phase_id ?? "?";
        return {
          editable: false,
          reason: `This belongs to ${stageObj?.name || sId} (phase ${pNum}). This challenge can only change things in your current phase.`,
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
    [allComponentsMap, allEdgesMap, phaseStageId, graphState, allowedTargets]
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
      return { uncertain: false, unknownNodes: [] };
    },
    [predictionMap]
  );

  /**
   * Dossier notes that point at a given target. An opinion about a component ("Reuben insists
   * risk assessment must be documented") does not lift the fog on it - only a Fact the player
   * filed as a Fact does, or investigating the component directly. When the player holds the
   * former and not the latter, the composer should say so rather than refusing flatly.
   */
  const notesByTarget = useMemo(() => {
    const byTarget: Record<string, LinkedNote[]> = {};
    dossierData.forEach((entry) => {
      (entry.intel_items ?? []).forEach((item) => {
        const target = item.target || item.debug?.target;
        if (!target) return;
        (byTarget[target] ||= []).push({
          item,
          stakeholderName: entry.is_challenge_intel ? "the challenge intel" : entry.name,
          stakeholderId: entry.is_challenge_intel ? undefined : entry.stakeholder_id,
        });
      });
    });
    return byTarget;
  }, [dossierData]);

  // The nodes and lines behind notes lit elsewhere (hovered in the dossier or on the case board).
  // Only the stage on screen is drawn on; a lit target on another stage marks that stage's tab.
  const { litTargetIds, litStageIds } = useMemo(() => {
    const { targets, stages } = litTargets(
      litIntelIds,
      dossierData,
      (id) => (allComponentsMap.get(id) ?? allComponentsMap.get(allEdgesMap.get(id)?.from_id ?? ""))?.stage_id
    );
    return { litTargetIds: targets, litStageIds: stages };
  }, [litIntelIds, dossierData, allComponentsMap, allEdgesMap]);

  // Hand the Pen: a sealed-but-not-yet-revealed draft occupies a slot too, same as a real change.
  const penReservesSlot = pen != null && !pen.revealed;
  const usedSlots = atomicChanges.length + (penReservesSlot ? 1 : 0);
  const slotsFull = usedSlots >= MAX_ATOMIC_CHANGES;

  // "3 found" when the total isn't known, "3 of 5 found" once the backend can say how many
  // intel items exist for this target in total. `target_total` is the same on every note
  // sharing a target, so the first one carries it.
  const intelCountLabel = useCallback((notes: LinkedNote[]) => {
    const total = notes[0]?.item.target_total;
    return total && total > notes.length
      ? `${notes.length} of ${total} found`
      : `${notes.length} found`;
  }, []);

  // Selecting a component elsewhere in the canvas - via a "held back by" or "capped by"
  // reference - should jump the view there too, switching stage tabs if it lives in another.
  const jumpToComponent = useCallback(
    (targetId: string) => {
      const comp = allComponentsMap.get(targetId);
      if (comp?.stage_id && comp.stage_id !== activeStageId) {
        setActiveStageId(comp.stage_id);
      }
      setSelectedCompId(targetId);
      setSelectedEdgeId(null);
    },
    [allComponentsMap, activeStageId]
  );

  // Selected Edge state
  const selectedEdgeData = selectedEdgeId ? allEdgesMap.get(selectedEdgeId) : null;
  const selectedEdgeEditable = selectedEdgeId
    ? isTargetEditable(selectedEdgeId, "edge", activeStageId)
    : { editable: false };

  // Selected Component state
  const selectedCompData = selectedCompId ? allComponentsMap.get(selectedCompId) : null;
  const selectedCompEditable = selectedCompId
    ? isTargetEditable(selectedCompId, "component", selectedCompData?.stage_id || activeStageId)
    : { editable: false };
  const selectedUpstreamStatus = selectedCompId ? isUpstreamUncertain(selectedCompId) : { uncertain: false, unknownNodes: [] };

  // Slot handlers: one authored option = one step on one axis = one slot.
  const handleAddOption = (target: OptionTarget, axis: Axis, option: GraphOption) => {
    setAtomicChanges((prev) => addOption(prev, target, axis, option, MAX_ATOMIC_CHANGES));
  };

  const handleRemoveOption = (target: OptionTarget, axis: Axis, option: GraphOption) => {
    setAtomicChanges((prev) => {
      const idx = prev.findIndex(
        (c) => c.target === target.id && (c.kind ?? "raise_to") === "raise_to" && c.axis === axis && c.value === option.to_level
      );
      return idx >= 0 ? removeChangeAt(prev, idx) : prev;
    });
  };


  // Removing a step also removes the steps after it on the same axis - they relied on it.
  // A delegated slot (Hand the Pen, revealed) is locked: it can be opened but never removed.
  const handleRemoveSlot = (index: number) => {
    if (atomicChanges[index]?.delegated_to) return;
    setAtomicChanges((prev) => removeChangeAt(prev, index));
  };

  const hintTarget = allComponentsMap.get(GRAPH_HINT_TARGET);
  const hintOption = hintTarget ? optionsOn(hintTarget, "automation").find((o) => o.name === GRAPH_HINT_OPTION) : undefined;
  const hintCanSlot =
    !!hintTarget && !!hintOption && optionStatus(hintTarget, "automation", hintOption, atomicChanges) === "next" && !slotsFull;

  // ── Composer guide (intro only): hints that wait for the player's own moves ──
  const isIntro = currentPhase === 0;
  const [guideSeen, setGuideSeen] = useState<string[]>(() => readComposeSeen(userId));
  useEffect(() => {
    const reload = () => setGuideSeen(readComposeSeen(userId));
    reload();
    return onComposeGuideReset(reload);
  }, [userId]);
  const markGuide = useCallback(
    (...keys: string[]) => {
      const merged = Array.from(new Set([...readComposeSeen(userId), ...keys]));
      writeComposeSeen(userId, merged);
      setGuideSeen(merged);
    },
    [userId]
  );

  const guideTargetPick = useMemo(() => {
    if (!isIntro) return null;
    const components = Array.from(allComponentsMap.values()).filter(
      (c) => isTargetEditable(c.id, "component", c.stage_id).editable
    );
    const driverTargets: string[] = [];
    const notedTargets: string[] = [];
    dossierData.forEach((entry) =>
      (entry.intel_items ?? []).forEach((item) => {
        const target = item.target || item.debug?.target;
        if (!target) return;
        notedTargets.push(target);
        if (item.categorized_type === "driver") driverTargets.push(target);
      })
    );
    return pickGuideTarget({
      components,
      allowed: allowedTargets,
      driverTargets,
      notedTargets,
      avoid: GRAPH_HINT_TARGET,
      changes: initialAtomicChangesResolved,
    });
  }, [isIntro, allComponentsMap, isTargetEditable, dossierData, allowedTargets, initialAtomicChangesResolved]);

  const initialChangeKeys = useMemo(() => new Set(initialAtomicChangesResolved.map(dedupeKey)), [initialAtomicChangesResolved]);
  const changeSlotted = atomicChanges.some((c) => !initialChangeKeys.has(dedupeKey(c)));
  const guideTarget = guideTargetPick?.target;
  const guideWhy = useMemo(() => {
    const nameOf = (id: string) => (stakeholders as Record<string, Stakeholder | undefined>)[id]?.name;
    const notes = (guideTarget ? notesByTarget[guideTarget.id] ?? [] : []).map((n) => ({
      text: resolveMarkers(n.item.fact || n.item.description || "", nameOf),
      driver: n.item.categorized_type === "driver",
      fromChallenge: !n.stakeholderId,
      who: n.stakeholderName,
      canStop: String((stakeholders as Record<string, Stakeholder | undefined>)[n.stakeholderId ?? ""]?.power || "").toLowerCase() === "high",
    }));
    return buildGuideWhy(notes);
  }, [guideTarget, notesByTarget, stakeholders]);
  const guideChain = useMemo(() => {
    if (!guideTarget) return null;
    const notes = dossierData.flatMap((e) => e.intel_items ?? []).map((i) => ({ ...i, target: i.target || i.debug?.target }));
    return chainStatus(guideTarget, wantedLevelFor(guideTarget.id, notes), atomicChanges);
  }, [guideTarget, dossierData, atomicChanges]);
  // A target the player has not touched has nothing further to raise.
  const wantedReached =
    !guideTarget || !guideChain || guideChain.reached || projectedOn(guideTarget, "automation", atomicChanges) <= nominalOn(guideTarget, "automation");
  const guideOnStage = !!guideTarget && (!guideTarget.stage_id || guideTarget.stage_id === activeStageId);
  const governanceOptionName =
    selectedCompData && selectedCompEditable.editable ? optionsOn(selectedCompData, "governance")[0]?.name : undefined;
  const guideReady = isIntro && isOpen && !confirmingLeave && !guidePaused && !gate.gateOpen && !isCoachTipOpen();

  const guideFlow = {
    seen: guideSeen,
    canvasPresent: !!graphState && currentStageTechnical.components.length > 0,
    hasTarget: guideOnStage,
    nodeSelected: !!guideTarget && selectedCompId === guideTarget.id,
    changeSlotted,
    wantedReached,
    governanceVisible: !!governanceOptionName,
  };
  const guideStepId = pickComposeStep({ ...guideFlow, ready: guideReady });

  // An action the player already did must not come back if they undo it.
  useEffect(() => {
    if (!isIntro || !isOpen) return;
    const keys = completedKeys(guideFlow);
    if (keys.length) markGuide(...keys);
  });

  const guideStepRef = useRef(guideStepId);
  if (isOpen) guideStepRef.current = guideStepId;
  // Closing the composer from the last hint ends the guide.
  useEffect(() => {
    if (!isOpen) return;
    return () => {
      if (guideStepRef.current === "slots") markGuide(COMPOSE_KEYS.slots);
    };
  }, [isOpen, markGuide]);

  let guide: {
    id: ComposeStepId;
    title: string;
    body: string;
    anchor: string;
    icon: CoachIconKey;
    key: string;
    action: boolean;
  } | null = null;
  switch (guideStepId) {
    case "canvas":
      guide = { id: guideStepId, ...COMPOSE_GUIDE.canvas, anchor: '[data-coach="compose-canvas"]', icon: "canvas", key: COMPOSE_KEYS.canvas, action: false };
      break;
    case "dials":
      guide = { id: guideStepId, ...COMPOSE_GUIDE.dials, anchor: '[data-coach="compose-legend"]', icon: "dials", key: COMPOSE_KEYS.dials, action: false };
      break;
    case "pickNode":
      if (guideTarget) {
        guide = {
          id: guideStepId,
          ...COMPOSE_GUIDE.pickNode(guideTarget.name, guideWhy),
          anchor: `[data-coach-node="${guideTarget.id}"]`,
          icon: "pickNode",
          key: COMPOSE_KEYS.node,
          action: true,
        };
      }
      break;
    case "pickOption":
      if (guideTarget && guideTargetPick) {
        guide = {
          id: guideStepId,
          ...COMPOSE_GUIDE.pickOption(
            optionDisplayName(guideTarget, "automation", guideTargetPick.option),
            guideTarget.name,
            plainAutomation(guideTargetPick.option.to_level, guideTargetPick.option.description, guideTargetPick.option.name),
            guideWhy.driver?.who
          ),
          anchor: `[data-coach-option="automation-${guideTargetPick.option.to_level}"]`,
          icon: "pickOption",
          key: COMPOSE_KEYS.option,
          action: true,
        };
      }
      break;
    case "raiseMore":
      if (guideTarget && guideChain?.next && guideChain.steps.length > 1) {
        const { next, steps, broken } = guideChain;
        guide = {
          id: guideStepId,
          ...COMPOSE_GUIDE.raiseMore(
            guideTarget.name,
            optionDisplayName(guideTarget, "automation", steps[0]),
            optionDisplayName(guideTarget, "automation", next),
            broken,
            plainAutomation(next.to_level, next.description, next.name),
            guideWhy.driver?.who
          ),
          anchor: `[data-coach-option="automation-${next.to_level}"]`,
          icon: "pickOption",
          key: COMPOSE_KEYS.more,
          action: true,
        };
      }
      break;
    case "governance":
      if (selectedCompData) {
        guide = {
          id: guideStepId,
          ...COMPOSE_GUIDE.governance(selectedCompData.name, governanceOptionName, !isImplemented(selectedCompData, atomicChanges)),
          anchor: '[data-coach="compose-governance"]',
          icon: "governance",
          key: COMPOSE_KEYS.governance,
          action: false,
        };
      }
      break;
    case "feeds":
      guide = {
        id: guideStepId,
        ...COMPOSE_GUIDE.feeds,
        anchor: document.querySelector('[data-coach="dossier"]') ? '[data-coach="dossier"]' : '[data-coach="compose-canvas"]',
        icon: "feeds",
        key: COMPOSE_KEYS.feeds,
        action: false,
      };
      break;
    case "slots":
      guide = { id: guideStepId, ...COMPOSE_GUIDE.slots, anchor: '[data-coach="compose-slots"]', icon: "slots", key: COMPOSE_KEYS.slots, action: false };
      break;
  }

  // Mistake tip: a slotted step the upstream will hold back. Silent, once per player.
  const cappedStep = isIntro && isOpen ? findCappedStep(predictions, atomicChanges, (by) => {
    const from = allEdgesMap.get(by)?.from_id ?? by;
    return allComponentsMap.get(from)?.name;
  }) : null;
  const cappedSeen = guideSeen.includes(COMPOSE_KEYS.cappedTip);
  const cappedCopy =
    cappedStep && !cappedSeen && guideReady
      ? COACH_TIPS.cappedStep(allComponentsMap.get(cappedStep.target)?.name ?? "That step", cappedStep.upstream)
      : null;
  if (cappedCopy) guide = null;

  // Guide hints are spoken in the narrator voice, like the pitch screen's.
  useGuideNarration(guide ? `compose-${guide.id}` : null, guide?.body ?? "");

  const handleConfirm = () => {
    if (stamping) return;
    // Confirming ends the guide: the player has seen how it works.
    if (isIntro) markGuide(...Object.values(COMPOSE_KEYS).filter((k) => k !== COMPOSE_KEYS.off && k !== COMPOSE_KEYS.cappedTip));
    const send = () => {
      onConfirmProposal(atomicChanges);
      onClose();
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      send();
      return;
    }
    setStamping(true);
    window.setTimeout(send, 380);
  };

  if (!isOpen) return null;

  // ── Sidebar values ──
  const BOARD_ALLY_DETAIL =
    "You tied these two together on the case board: both want this step moved the same way, though not necessarily to the same level. When one of them backs your card, the other warms to it.";
  const boardMarksFor = (note: LinkedNote): NoteBoardMark[] => [
    ...allyOf(note).map((n) => ({
      key: n.relation_id,
      icon: "ph:handshake-duotone",
      label: `Pushing the same way as ${n.other}`,
      detail: BOARD_ALLY_DETAIL,
    })),
    ...(compromisePairs.some((p) => p.item_ids.includes(note.item.id))
      ? [
          {
            key: `compromise-${note.item.id}`,
            icon: "ph:scales-duotone",
            label: "Compromise pair",
            detail: "You tied these two notes together on the case board: a Trade-off can settle it.",
          },
        ]
      : []),
  ];

  const stepLabel = (id: string) => allComponentsMap.get(id)?.name || id;
  const proposalEntries: ProposalEntry[] = atomicChanges.map((change) => {
    const isEdge = change.target.startsWith("e.") || allEdgesMap.has(change.target);
    const edge = allEdgesMap.get(change.target);
    const comp = allComponentsMap.get(change.target);
    const described = describeAtomicChange(change, isEdge ? edge : comp);
    return {
      displayName: isEdge ? `${stepLabel(edge?.from_id || "Source")} → ${stepLabel(edge?.to_id || "Target")}` : comp?.name || change.target,
      title: described.title,
      detail: described.detail,
      axis: change.axis,
      isEdge,
      delegatedToName: change.delegated_to ? stakeholders[change.delegated_to]?.name || change.delegated_to : null,
      marks: [
        ...sharedSteps
          .filter((n) => n.target === change.target)
          .map((n) => ({
            key: n.relation_id,
            icon: "ph:stack-duotone",
            label: `Shared by ${n.a_name} and ${n.b_name}`,
            detail: "You tied these two together on the case board: both have a stance on this step.",
          })),
        ...afterNotes
          .filter((n) => n.target === change.target)
          .map((n) => ({
            key: n.relation_id,
            icon: "ph:link-simple-duotone",
            label: `After ${n.after_name}'s step`,
            detail: "You tied these two together on the case board: this change is capped until their step is done.",
          })),
      ],
    };
  });

  const openProposalEntry = (idx: number) => {
    const target = atomicChanges[idx]?.target;
    if (!target) return;
    if (proposalEntries[idx].isEdge) {
      setSelectedEdgeId(target);
      setSelectedCompId(null);
    } else {
      setSelectedCompId(target);
      setSelectedEdgeId(null);
    }
  };

  const dependencyState: DependencyState | null = !selectedCompData
    ? null
    : selectedUpstreamStatus.uncertain
    ? { kind: "uncertain", nodes: selectedUpstreamStatus.unknownNodes.map((id) => ({ id, name: stepLabel(id) })) }
    : selectedCompData.capped_by &&
      selectedCompData.effective_automation !== undefined &&
      selectedCompData.nominal_automation !== undefined &&
      selectedCompData.effective_automation < selectedCompData.nominal_automation
    ? {
        kind: "held",
        byId: selectedCompData.capped_by,
        byName: stepLabel(selectedCompData.capped_by),
        capLabel: formatAxisLevel("automation", selectedCompData.effective_automation),
      }
    : {
        kind: "ok",
        levelLabel: formatAxisLevel(
          "automation",
          selectedCompData.effective_automation ?? nominalOn(selectedCompData, "automation")
        ),
      };

  const ownerName = (id: string) => stakeholders[id]?.name ?? id.replace(/_/g, " ");

  /** The owner as a face: a link into their dossier when the host can show one. */
  const renderOwner = (ownerId?: string) => {
    if (!ownerId) return null;
    const avatar = (
      <StakeholderAvatarComponent
        stakeholderId={ownerId}
        avatar={stakeholders[ownerId]?.avatar}
        stakeholderColor={stakeholders[ownerId]?.stakeholder_color}
        isFramed={false}
        size="100%"
        flip
        thumb
        hoverToSuspicious={false}
      />
    );
    return (
      <HoverTooltip
        description={
          <ComposeTagDetail
            label={`Owner: ${ownerName(ownerId)}`}
            lines={onOpenStakeholder ? ["Open their dossier page"] : undefined}
          />
        }
        ariaText={`Owner: ${ownerName(ownerId)}`}
      >
        {onOpenStakeholder ? (
          <button type="button" className={sb.owner} onClick={() => onOpenStakeholder(ownerId)} aria-label={`Owner: ${ownerName(ownerId)}. Open their dossier page.`}>
            {avatar}
          </button>
        ) : (
          <span className={`${sb.owner} ${sb.ownerStatic}`}>{avatar}</span>
        )}
      </HoverTooltip>
    );
  };

  const closeInspectorButton = (onClick: () => void) => (
    <HoverTooltip description="Close inspector" labelsChild>
      <button type="button" className={sb.bandClose} onClick={onClick}>
        <Icon icon="ph:x-bold" />
      </button>
    </HoverTooltip>
  );

  /** Notes filed against a target, laid out as the case board's ledger: evidence before the picker. */
  const renderNotes = (targetId: string, what: "component" | "connection") => {
    const notes = notesByTarget[targetId] ?? [];
    if (notes.length === 0) return null;
    // Threads you confirmed on the case board that touch this target or its notes.
    const noteIds = new Set(notes.map((n) => n.item.id));
    const boardThreads =
      compromisePairs.filter((p) => p.target === targetId).length +
      afterNotes.filter((n) => n.target === targetId).length +
      sharedSteps.filter((n) => n.target === targetId).length +
      allyPairs.filter((p) => p.item_ids.some((id) => noteIds.has(id))).length;
    return (
      <div className={sb.section}>
        <div className={sb.sectionHead}>
          <Icon icon="ph:notebook-bold" />
          <span>Notes on this {what}</span>
          <span className={sb.sectionRight}>
            {onOpenBoard && (
              <HoverTooltip
                description={
                  <ComposeTagDetail
                    label="Case board"
                    lines={[
                      boardThreads > 0
                        ? `${boardThreads} thread${boardThreads === 1 ? "" : "s"} you tied on the board touch this ${what}. Open it to see them.`
                        : `Nothing you tied on the board touches this ${what} yet. Open it to look for who is connected to whom.`,
                    ]}
                  />
                }
              >
                <button type="button" className={sb.boardChip} onClick={onOpenBoard}>
                  <Icon icon="ph:push-pin-duotone" />
                  <span>{boardThreads > 0 ? `${boardThreads} on the board` : "Board"}</span>
                </button>
              </HoverTooltip>
            )}
            {intelCountLabel(notes)}
          </span>
        </div>
        <IntelNoteRows
          notes={notes}
          stakeholders={stakeholders as Record<string, Stakeholder>}
          getStakeholderColor={getStakeholderColor}
          litIntelIds={litIntelIds}
          onLitIntel={onLitIntel}
          onSelectIntel={onSelectIntel}
          boardMarksFor={boardMarksFor}
        />
      </div>
    );
  };

  const renderLadders = (target: OptionTarget, kind: "component" | "edge") =>
    AXES.map((axis) => (
      <OptionLadder
        key={axis}
        axis={axis}
        target={target}
        kind={kind}
        changes={atomicChanges}
        slotsFull={slotsFull}
        maxSlots={MAX_ATOMIC_CHANGES}
        onAdd={(option) => handleAddOption(target, axis, option)}
        onRemove={(option) => handleRemoveOption(target, axis, option)}
        bindTip={tip.bind}
      />
    ));

  const viewOnly = (reason: string) => (
    <div className={sb.viewOnly}>
      <Icon icon="ph:eye-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
      <div>
        <strong>View only:</strong> {highlight(reason)}
      </div>
    </div>
  );

  // The header band takes the selected node's title-bar colours, so the inspector reads as that node's.
  const inspectorBar = selectedCompData
    ? nodeBar({
        otherPhase: !selectedCompEditable.editable,
        broken: (selectedCompData.nominal_automation ?? 1) === 0,
        uncertain: selectedUpstreamStatus.uncertain,
        capped: Boolean(selectedCompData.capped_by),
      })
    : selectedCrossStub
    ? nodeBar({ otherPhase: true, broken: false, uncertain: false, capped: false })
    : nodeBar({ otherPhase: false, broken: false, uncertain: false, capped: false });
  const bandStyle = { ["--bar" as string]: inspectorBar.fill, ["--bar-ink" as string]: inspectorBar.ink };

  const edgeFrom = selectedEdgeData ?allComponentsMap.get(selectedEdgeData.from_id)?.name || selectedEdgeData.from_id : "";
  const edgeTo = selectedEdgeData ? allComponentsMap.get(selectedEdgeData.to_id)?.name || selectedEdgeData.to_id : "";

  return (
    <HoverTooltipTheme variant="paper">
    <div className={styles.proposalContainer}>
      {/* ── Header ── */}
      <div className={styles.modalHeader}>
        <div className={styles.headerTitleGroup}>
          <Icon icon="ph:git-merge-bold" style={{ fontSize: "1.4rem" }} />
          <div>
            <h3 className={styles.headerTitle}>Compose Action Proposal</h3>
            <p className={styles.headerSubtitle}>
              Pick automation, governance and technology steps, then take the proposal to the stakeholders
            </p>
          </div>
        </div>

        <div className="d-flex align-items-center gap-2">
          {intelTotal > 0 && (
            <div
              className={styles.intelIndicator}
              tabIndex={0}
              {...tagProps(
                "Intel Readiness",
                "How much of the intel relevant to this challenge you've verified so far"
              )}
            >
              <Icon icon="ph:notebook-bold" />
              <span>
                {intelVerified} / {intelTotal} Intel Verified
              </span>
            </div>
          )}

          <div
            className={`${styles.slotsIndicator} ${slotsFull ? styles.slotsFull : ""}`}
            tabIndex={0}
            {...tagProps(
              "Proposal Slots",
              slotsFull
                ? "All 4 slots are used - remove one to add another"
                : "Up to 4 changes can go into one proposal"
            )}
          >
            <Icon icon="ph:stack-duotone" />
            <span className={styles.slotPips} aria-hidden>
              {Array.from({ length: MAX_ATOMIC_CHANGES }, (_, i) => (
                <span key={i} className={`${styles.slotPip} ${i < usedSlots ? styles.slotPipOn : ""}`} />
              ))}
            </span>
            <span>
              {usedSlots} / {MAX_ATOMIC_CHANGES} slots
            </span>
          </div>

          {onOpenCheatSheet && (
            <button
              type="button"
              className={styles.helpBtn}
              onClick={onOpenCheatSheet}
              aria-label="Graph help"
              {...tagProps("Graph help", "What the boxes, lines and dials mean, with a worked example")}
            >
              <Icon icon="ph:question-bold" />
            </button>
          )}

          <button
            type="button"
            className={styles.closeBtn}
            onClick={requestClose}
            aria-label="Back to boardroom"
            {...tagProps("Back to Boardroom", "Leave the composer without proposing anything (Esc)")}
          >
            <Icon icon="ph:arrow-u-up-left-bold" />
            <span>Back to Boardroom</span>
          </button>
        </div>
      </div>

      {/* ── Stage Tabs Bar ── */}
      <div className={styles.stageTabsBar}>
        {(graphState?.stages || []).map((stage) => {
          const isActivePhase = stage.id === phaseStageId;
          const isSelected = activeStageId === stage.id;
          const isOtherPhase = !isActivePhase;

          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => {
                setActiveStageId(stage.id);
                setSelectedCompId(null);
                setSelectedEdgeId(null);
                setSelectedCrossStub(null);
              }}
              className={`${styles.stageTab} ${isSelected ? styles.stageTabActive : ""} ${
                isOtherPhase ? styles.stageTabViewOnly : ""
              }`}
              {...tagProps(
                stage.name,
                isOtherPhase ? `Phase ${stage.phase_id} - view only in this challenge` : "The phase you are in"
              )}
            >
              <Icon
                className={styles.stageTabIcon}
                icon={isOtherPhase ? "ph:eye-bold" : "ph:cube-bold"}
              />
              <span className={styles.stageTabName}>{stage.name}</span>
              {isActivePhase && (
                <span className={styles.stageTabDot} aria-label="editable in this challenge" />
              )}
              {litStageIds.has(stage.id) && !isSelected && (
                <span className={styles.stageTabEcho} aria-label="a note you are pointing at is on this stage" />
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
            <span className={styles.canvasStageName}>
              {graphState?.stages?.find((st) => st.id === activeStageId)?.name ?? "Stage"} architecture
            </span>

            <div className={styles.toolbarRight}>
              <span className={styles.canvasCount}>
                {currentStageTechnical.components.length} components ·{" "}
                {currentStageTechnical.edges.length}{" "}
                {currentStageTechnical.edges.length === 1 ? "edge" : "edges"}
              </span>

              {/* Legend on demand: it is reference material, not something to read every time */}
              <span
                className={`${styles.legendChip} ${guideStepId === "dials" ? styles.legendChipOpen : ""}`}
                tabIndex={0}
              >
                <Icon icon="ph:list-bullets-bold" />
                <span>Legend</span>
                <span className={styles.legendPanel} role="tooltip" data-coach="compose-legend">
                  {LEGEND_GROUPS.map((group) => (
                    <span key={group.heading} className={styles.legendGroup}>
                      <span className={styles.legendHeading}>{group.heading}</span>
                      {group.items.map((item) => (
                        <span key={item.label} className={styles.legendItem}>
                          {item.icon ? (
                            <Icon icon={item.icon} className={styles.legendGlyph} style={{ color: item.iconColor }} />
                          ) : (
                            <span className={styles.legendSwatch} style={item.swatch} />
                          )}
                          <span>{item.label}</span>
                        </span>
                      ))}
                    </span>
                  ))}
                </span>
              </span>
            </div>
          </div>

          {/* SVG Topology Canvas */}
          <div className={styles.canvasBox} data-coach="compose-canvas">
            {(() => {
              if (!graphState) {
                return (
                  <div className={styles.canvasNote}>
                    <div
                      className="spinner-border"
                      role="status"
                      style={{ width: "2.5rem", height: "2.5rem", color: "#3b2a1e" }}
                    >
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <div>Loading MLOps architecture...</div>
                  </div>
                );
              }

              const comps = currentStageTechnical.components;
              const edges = currentStageTechnical.edges;
              if (comps.length === 0) {
                return (
                  <div className={styles.canvasNote}>
                    <Icon icon="ph:info-bold" style={{ fontSize: "2rem" }} />
                    <div>No components in this stage.</div>
                  </div>
                );
              }

              // Authored coordinates are sparse and uneven; snap them to a tight grid and let
              // the diagram scale to the canvas instead of floating at natural size inside it.
              const { positions, width: svgW, height: svgH } = compactLayout(comps);
              const posOf = (id: string) => positions[id];

              // Cross-phase stubs point off the canvas's own edge into the margin - widen the
              // viewBox to give them room, but only for stages that actually have one.
              const stubMargin = crossPhaseStubs.length > 0 ? 40 : 0;
              const viewW = svgW + stubMargin * 2;

              return (
                <svg
                  viewBox={`${-stubMargin} 0 ${viewW} ${svgH}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={fitToBoxStyle(viewW, svgH)}
                  className={styles.stageSvg}
                  // Clicking blank canvas - anywhere that isn't a node or edge, which each stop
                  // this from seeing their own clicks by not being the event's target - clears
                  // whatever's selected, same as clicking a node a second time does. Without
                  // this, a player who dismisses the inspector the way they would on a map or
                  // diagram elsewhere (click away from what they picked) finds the reticle and
                  // inspector panel just sitting there with no visible way to close them.
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    setSelectedCompId(null);
                    setSelectedEdgeId(null);
                    setSelectedCrossStub(null);
                  }}
                >
                  <style>{NODE_STATE_ANIM}</style>
                  <style>{EDGE_FLOW_ANIM}</style>
                  <NodeDefs prefix="compose" theme="cork" />
                  <defs>
                    {/* Arrowheads in the line colours, which are chosen for the blueprint ground */}
                    {Object.entries(EDGE_ON_CORK).map(([id, fill]) => (
                      <marker key={id} id={id} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                        <path d="M0,0 L0,7 L7,3.5 z" fill={fill} stroke="rgba(24, 12, 4, 0.55)" strokeWidth={0.7} strokeLinejoin="round" />
                      </marker>
                    ))}
                  </defs>

                  {/* SVG Pipeline Edges */}
                  {edges.map((e, edgeIndex) => {
                    const from = allComponentsMap.get(e.from_id);
                    const to = allComponentsMap.get(e.to_id);
                    const fromPos = posOf(e.from_id);
                    const toPos = posOf(e.to_id);
                    if (!from || !to || !fromPos || !toPos) return null;

                    const [ax, ay, bx, by] = edgeEnds(fromPos.x, fromPos.y, toPos.x, toPos.y);
                    const isSelected = selectedEdgeId === e.id;
                    const isHovered = hoveredEdgeId === e.id;
                    const isSlotted = atomicChanges.some((c) => c.target === e.id);
                    const edgeEdit = isTargetEditable(e.id, "edge", activeStageId);
                    const isOtherPhase = !edgeEdit.editable;
                    const isPredecessorLine =
                      activeHighlightedPredecessors.has(e.from_id) &&
                      (selectedCompId === e.to_id || hoveredCompId === e.to_id);

                    let color = "#94a3b8";
                    let markerId = "arr-default";
                    // The travelling-dash look this drives (matches the Performance Dashboard's
                    // edges): only in the plain, unhighlighted state, so it never fights the
                    // selection/predecessor/view-only overrides above.
                    let pipeClass: string | undefined;

                    if (isSelected || isSlotted) {
                      color = "var(--primary-bg)";
                      markerId = "arr-primary";
                    } else if (isPredecessorLine) {
                      color = "var(--primary-bg)";
                      markerId = "arr-predecessor";
                    } else if (isOtherPhase) {
                      color = "#cbd5e1";
                      markerId = "arr-viewonly";
                    } else {
                      // Colour follows automation only: governance never changes what flows.
                      if (e.automation === 0) {
                        color = "#dc3545";
                        markerId = "arr-danger";
                        pipeClass = "pipe-dead";
                      } else if (e.automation && e.automation >= 3) {
                        color = "#16a34a";
                        markerId = "arr-success";
                        pipeClass = "pipe-flow";
                      } else {
                        color = "#ea580c";
                        markerId = "arr-warning";
                        pipeClass = "pipe-flow-slow";
                      }
                    }

                    // `color` is for the white handle chip; the line itself sits on the blueprint ground.
                    const lineColor = EDGE_ON_CORK[markerId] ?? EDGE_ON_CORK["arr-default"];
                    const isLit = litTargetIds.has(e.id);
                    const mx = (ax + bx) / 2;
                    const my = (ay + by) / 2;
                    const baseWidth = edgeStrokeWidth(e.automation);
                    const lineW =
                      (isSelected ? 4.5 : isSlotted ? 4 : isHovered || isPredecessorLine ? 3.5 : Math.max(baseWidth, 1.5) + 1) +
                      (isLit ? 1 : 0);
                    const isAutomated =
                      e.automation !== undefined && e.automation !== null && e.automation >= 3;
                    const edgeSummary = describeHandoff(from.name, to.name, e);
                    const hasTrigger = Boolean(e.trigger && e.trigger !== "none");
                    // Every edge the player may act on gets a handle, triggered or not; the
                    // slotted and view-only badges already own the midpoint when they show.
                    const showHandle = !isSlotted && !isOtherPhase;
                    const edgeTip = tagProps(`${from.name} → ${to.name}`, [
                      edgeSummary,
                      isOtherPhase ? "View only in this challenge" : "Click to edit this connection",
                    ]);

                    return (
                      <g key={e.id}>
                        {/* The string's shadow on the board: yarn sits on the cork, it does not glow */}
                        <line
                          x1={ax}
                          y1={ay}
                          x2={bx}
                          y2={by}
                          stroke="rgba(24, 12, 4, 0.42)"
                          strokeWidth={Math.max(baseWidth, 1.5) + 1.5}
                          strokeLinecap="round"
                          transform="translate(1.6 3)"
                          style={{ filter: "blur(1.1px)" }}
                          pointerEvents="none"
                        />
                        {/* The yarn: a solid strand under the (flowing) line, wound with alternating dark and light bands */}
                        <line x1={ax} y1={ay} x2={bx} y2={by} stroke={lineColor} strokeWidth={lineW} strokeLinecap="round" opacity={0.6} pointerEvents="none" />
                        {!isOtherPhase && (
                          <>
                            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="rgba(30, 14, 4, 0.4)" strokeWidth={lineW * 0.92} strokeDasharray="1.3 3.1" pointerEvents="none" />
                            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="rgba(255, 246, 220, 0.38)" strokeWidth={lineW * 0.92} strokeDasharray="1.3 3.1" strokeDashoffset={2.2} pointerEvents="none" />
                          </>
                        )}
                        {/* The line itself: carries the flow state (dashes that run, or stall) */}
                        <line
                          className={pipeClass}
                          x1={ax}
                          y1={ay}
                          x2={bx}
                          y2={by}
                          stroke={lineColor}
                          strokeWidth={lineW}
                          strokeDasharray={isOtherPhase ? "4 3" : undefined}
                          markerEnd={`url(#${markerId})`}
                          style={{
                            cursor: showHandle ? "pointer" : undefined,
                            filter: isLit ? `drop-shadow(0 0 3px ${LIT_GLOW})` : undefined,
                            transition: "filter 0.16s ease",
                          }}
                          opacity={isHovered || isLit ? 1 : 0.92}
                        />
                        {isAutomated && <FlowParticle x1={ax} y1={ay} x2={bx} y2={by} color={lineColor} />}
                        {/* Midpoint badge: a hammer when a step is slotted, or an eye when view only */}
                        {isSlotted && (
                          <g transform={`translate(${mx - 10}, ${my - 10})`} style={{ pointerEvents: "none" }}>
                            <circle cx="10" cy="10" r="10" fill={CARD.proposed} stroke="#0b3a45" strokeWidth={1.5} />
                            <Icon icon="ph:hammer-duotone" x={4} y={4} width={12} height={12} color="#ffffff" />
                          </g>
                        )}
                        {isOtherPhase && !isSlotted && (
                          <g transform={`translate(${mx - 8}, ${my - 8})`} style={{ pointerEvents: "none" }}>
                            <circle cx="8" cy="8" r="8" fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1} />
                            <text x="8" y="11" fontSize="9" textAnchor="middle">
                              👁
                            </text>
                          </g>
                        )}
                        {/* The handle: what makes the edge look like something to press. It
                            carries the trigger glyph when there is one, a neutral dot when
                            there is not, and it is the click target. */}
                        {showHandle && (
                          <EdgeHandle
                            key={`${activeStageId}-${e.id}`}
                            className="edge-handle-reveal"
                            revealDelay={edgeIndex * 90}
                            x={mx}
                            y={my}
                            glyph={hasTrigger ? TRIGGER_ICONS[e.trigger!] ?? "?" : undefined}
                            color={color}
                            active={isSelected || isSlotted}
                            onClick={() => {
                              setSelectedEdgeId(isSelected ? null : e.id);
                              setSelectedCompId(null);
                            }}
                            onMouseEnter={() => setHoveredEdgeId(e.id)}
                            onMouseLeave={() => setHoveredEdgeId(null)}
                          />
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
                          onMouseEnter={(e2) => {
                            setHoveredEdgeId(e.id);
                            edgeTip.onMouseEnter(e2);
                          }}
                          onMouseLeave={() => {
                            setHoveredEdgeId(null);
                            edgeTip.onMouseLeave();
                          }}
                        />
                      </g>
                    );
                  })}

                  {/* SVG Component Nodes */}
                  {comps.map((c) => {
                    const pos = posOf(c.id);
                    if (!pos) return null;
                    const { x, y } = pos;
                    const isSealed = pen != null && pen.target === c.id;
                    const isSelected = selectedCompId === c.id;
                    const isSlotted = atomicChanges.some((change) => change.target === c.id) || isSealed;
                    const isPredecessor = activeHighlightedPredecessors.has(c.id);
                    const compEdit = isTargetEditable(c.id, "component", c.stage_id || activeStageId);
                    const isOtherPhase = !compEdit.editable;
                    const upstreamCheck = isUpstreamUncertain(c.id);

                    const isBroken = (c.nominal_automation ?? 1) === 0;
                    // Runs at nothing, but is not itself broken: something upstream is down.
                    const isStarved = !isBroken && (c.effective_automation ?? 1) === 0;
                    // The title bar carries the node's state. Healthy is plain ink: only what needs
                    // attention takes a colour, so a problem is the first thing the eye lands on.
                    // Sealed (Hand the Pen) overrides every other state: nobody can touch it anyway.
                    const { fill: rail, ink: barInk } = isSealed
                      ? { fill: CARD.sealed, ink: "#ffffff" }
                      : nodeBar({
                          otherPhase: isOtherPhase,
                          broken: isBroken,
                          uncertain: upstreamCheck.uncertain,
                          capped: Boolean(c.capped_by),
                        });
                    const barInset = (isSelected ? 2 : 1.25) / 2;
                    const face = nodeFace("compose", {
                      selected: isSelected || isPredecessor,
                      broken: isBroken,
                    });
                    const stroke = isSelected
                      ? CARD.select
                      : isPredecessor
                      ? CARD.predecessor
                      : isBroken
                      ? CARD.broken
                      : CARD.ink;

                    // 12px bold in a 104px column: 14 characters a line. A name that needs more than two lines
                    // ends in an ellipsis, and its tooltip carries the whole name.
                    const fullName = c.name || c.id;
                    const lines = wrapLabel(fullName, 14);
                    if (lines.join(" ").length < fullName.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/.?$/, "…");
                    // Title centred in the bar, every line clear of the icon beside it.
                    const titleX = NODE_PAD_X + (c.icon ? NODE_ICON_OFFSET : 0);
                    const titleY = (i: number) => BAR_H / 2 + 4 - (lines.length - 1) * (NODE_TITLE_LH / 2) + i * NODE_TITLE_LH;
                    // Where each axis would sit once every slotted step lands, drawn ahead of
                    // what is built as translucent notches.
                    const previewAutomation = projectedOn(c, "automation", atomicChanges);
                    const previewGovernance = projectedOn(c, "governance", atomicChanges);
                    // Broken until the proposal fixes it: a slotted step that lifts it off level 0 stops the glitching.
                    const glitching = isBroken && previewAutomation === 0;
                    // A target can carry several chained steps on the same axis (one slot each,
                    // "Implement It Manually" then "Automate It") - the settled rung each would land on is
                    // `previewAutomation`/`previewGovernance` above, never any single change's own
                    // value, which might just be one link in that chain.
                    const automationQueued = previewAutomation !== nominalOn(c, "automation");
                    const governanceQueued = previewGovernance !== nominalOn(c, "governance");
                    const nodeTagStatus = isSealed
                      ? `${stakeholders[pen!.stakeholder_id]?.name || pen!.stakeholder_id} drafts this one. Sealed until you pitch.`
                      : isOtherPhase
                      ? "View only - belongs to another phase"
                      : isBroken
                      ? "Current status: Broken"
                      : upstreamCheck.uncertain
                      ? `Current status: Uncertain - held up by ${upstreamCheck.unknownNodes
                          .map((id) => allComponentsMap.get(id)?.name ?? id)
                          .join(", ")}`
                      : isStarved
                      ? "Current status: Starved - something upstream is broken, so nothing reaches it"
                      : c.capped_by
                      ? `Current status: Held back by ${allComponentsMap.get(c.capped_by)?.name ?? c.capped_by}`
                      : `Current status: ${formatAxisLevel("automation", c.effective_automation ?? c.nominal_automation ?? 1)} · ${formatAxisLevel(
                          "governance",
                          c.nominal_governance ?? 0
                        )}`;
                    const nodeTip = tagProps(c.name || c.id, [
                      nodeTagStatus,
                      automationQueued
                        ? `Proposed automation: ${formatAxisLevel("automation", c.nominal_automation ?? 1)} → ${formatAxisLevel(
                            "automation",
                            previewAutomation
                          )}`
                        : undefined,
                      governanceQueued
                        ? `Proposed governance: ${formatAxisLevel("governance", c.nominal_governance ?? 0)} → ${formatAxisLevel(
                            "governance",
                            previewGovernance
                          )}`
                        : undefined,
                      "Click to inspect",
                    ] as TagLine[]);
                    const isLit = litTargetIds.has(c.id);

                    return (
                      <g
                        key={c.id}
                        className={`${styles.stageNode} ${isSlotted ? styles.nodeSlotted : ""}`}
                        data-coach-node={c.id}
                        transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2}) rotate(${cardTilt(c.id)} ${BOX_W / 2} ${BOX_H / 2})`}
                        onClick={() => {
                          setSelectedCompId(isSelected ? null : c.id);
                          setSelectedEdgeId(null);
                        }}
                        onMouseEnter={(e) => {
                          setHoveredCompId(c.id);
                          nodeTip.onMouseEnter(e);
                        }}
                        onMouseLeave={() => {
                          setHoveredCompId(null);
                          nodeTip.onMouseLeave();
                        }}
                      >
                        {/* The lit echo grows and shadows this wrapper, which sits between the placed
                            group above (its transform attribute must stay untouched) and the broken
                            glitch group below, so a broken node keeps glitching while it is lit. */}
                        <g className={styles.nodeHover}>
                        <g className={`${styles.nodeEcho} ${isLit ? styles.nodeEchoOn : ""}`}>
                        <g className={glitching ? "node-broken" : undefined}>
                        {/* Card face */}
                        <rect
                          width={BOX_W}
                          height={BOX_H}
                          fill={face}
                          stroke={stroke}
                          strokeWidth={isSelected ? 2 : 1.25}
                          strokeDasharray={isOtherPhase ? "4 3" : undefined}
                          filter={`url(#compose-${
                            glitching ? "broken-face" : isSelected ? "shadow-lifted" : "shadow"
                          })`}
                        />
                        {/* Title bar: a solid block in the node's state colour, inside the outline */}
                        <rect x={barInset} y={barInset} width={BOX_W - barInset * 2} height={BAR_H - barInset} fill={rail} />
                        {glitching && <BrokenBorder color={CARD.broken} />}
                        {!isBroken && c.capped_by && !isSlotted && !isOtherPhase && (
                          <Icon icon="ph:link-simple-bold" x={BOX_W - 22} y={BAR_H / 2 - 7} width={14} height={14} color={barInk} />
                        )}

                        {/* Another phase: readable here, editable elsewhere */}
                        {isOtherPhase && !isSlotted && (
                          <g transform={`translate(${BOX_W - 24}, ${BAR_H / 2 - 8})`}>
                            <circle cx="8" cy="8" r="8" fill="#dbe7f2" stroke="#9db6cc" />
                            <text x="8" y="11" fontSize="8" textAnchor="middle">
                              👁
                            </text>
                          </g>
                        )}

                        {/* Icon, centred in the bar */}
                        {c.icon && (
                          <g className={styles.nodeIcon}>
                          <g className={isSlotted ? styles.iconPulse : undefined}>
                            <NodeIcon icon={c.icon} color={barInk} cx={titleX / 2} cy={BAR_H / 2} discOpacity={0.22} />
                          </g>
                          </g>
                        )}
                        {/* A change of yours is attached: a teal flag folded over the top-right corner (the colour the sidebar
                            uses for "in your proposal"), carrying a hammer. It stays inside the card's border, so it never
                            covers the selection brackets. */}
                        {isSlotted && (
                          <g pointerEvents="none">
                            <path d={`M${BOX_W - 31} ${barInset} H${BOX_W - barInset} V31 Z`} fill={CARD.proposed} />
                            <path d={`M${BOX_W - 31} ${barInset} L${BOX_W - barInset} 31`} stroke="rgba(255,255,255,0.4)" strokeWidth={0.8} />
                            <Icon icon="ph:hammer-duotone" x={BOX_W - 17} y={3} width={13} height={13} color="#ffffff" />
                          </g>
                        )}

                        {/* Node title, centred in the bar, with its colour-split ghosts underneath when broken.
                            Every line clears the icon, since the icon sits beside the whole title. */}
                        {glitching && (
                          <NodeTitleAberration
                            lines={lines}
                            x={() => titleX}
                            y={(i) => titleY(i)}
                            fontWeight={700}
                            offset={1.8}
                            fontSize={12}
                          />
                        )}
                        {lines.map((line, i) => (
                          <text
                            key={i}
                            x={titleX}
                            y={titleY(i)}
                            fill={barInk}
                            fontSize="12"
                            fontWeight="700"
                            stroke={barInk === "#ffffff" ? "rgba(18, 8, 2, 0.5)" : "none"}
                            strokeWidth={2.4}
                            strokeLinejoin="round"
                            paintOrder="stroke"
                          >
                            {line}
                          </text>
                        ))}

                        {/* One caption, plus the maturity meter when there is one to show */}
                            <LevelCaption
                              level={c.effective_automation ?? c.nominal_automation ?? 1}
                              governance={c.nominal_governance}
                              y={NODE_CAPTION_Y}
                              size={9.5}
                              // Three cases are not about a rung at all, and keep the rail's
                              // colour along with their own word.
                              text={
                                isOtherPhase
                                  ? "view only"
                                  : upstreamCheck.uncertain
                                  ? "uncertain"
                                  : isStarved
                                  ? "starved"
                                  : undefined
                              }
                              color={
                                isOtherPhase || upstreamCheck.uncertain || isStarved ? rail : undefined
                              }
                            />
                            <LevelMeter
                              automation={c.nominal_automation ?? 1}
                              effectiveAutomation={c.effective_automation}
                              governance={c.nominal_governance}
                              automationRungs={levelRungs(c.allowed_automation)}
                              governanceRungs={levelRungs(c.allowed_governance)}
                              previewAutomation={previewAutomation}
                              previewGovernance={previewGovernance}
                              y={NODE_METER_Y}
                              emptyColor={CARD.empty}
                              thickness={5}
                            />

                        </g>

                        {/* The pin that holds it to the board. Outside the glitch group on purpose: a broken card
                            swings about the pin, and the pin itself never moves. */}
                        <g pointerEvents="none">
                          <ellipse cx={BOX_W / 2 + 1.4} cy={3.6} rx={4.4} ry={2.2} fill="#2a1a0c" fillOpacity={0.35} />
                          <circle cx={BOX_W / 2} cy={1.5} r={4.2} fill="#c9962b" stroke="#6b4f20" strokeWidth={0.8} />
                          <circle cx={BOX_W / 2 - 1.2} cy={0.2} r={1.3} fill="#fff4cf" fillOpacity={0.8} />
                        </g>
                        {isSelected && <SelectionReticle color={CARD.select} />}
                        </g>
                        </g>
                      </g>
                    );
                  })}

                  {/* Cross-phase dependency stubs: the far end is never on this canvas */}
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
                        y={pos.y}
                        forward={stub.forward}
                        lane={lane}
                        prefix="compose"
                        id={stub.edgeId}
                        idleColor="#0f6e7e"
                        activeColor={CARD.select}
                        active={selectedCrossStub?.edgeId === stub.edgeId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCrossStub((prev) => (prev?.edgeId === stub.edgeId ? null : stub));
                          setSelectedCompId(null);
                          setSelectedEdgeId(null);
                        }}
                      />
                    );
                  })}
                </svg>
              );
            })()}
          </div>
        </div>

        {/* Right: one sheet of paper - the inspector, then the proposal */}
        <div className={styles.sidebarArea}>
          <div className={styles.sidebarContent}>
            {selectedCrossStub ? (
              /* Cross-phase dependency: purely informational, nothing to build here */
              <div>
                <div className={sb.band} style={bandStyle}>
                  <Icon icon="ph:link-break-bold" className={sb.bandIcon} />
                  <h4 className={sb.bandTitle}>Cross-Phase Dependency</h4>
                  {closeInspectorButton(() => setSelectedCrossStub(null))}
                </div>
                <div className={sb.body}>
                  <p className={sb.caption}>{selectedCrossStub.otherStageName}</p>
                  <div className={sb.viewOnly}>
                    <Icon icon="ph:eye-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                    <div>
                      {highlight(
                        crossPhaseExplanation(
                          selectedCrossStub.direction,
                          selectedCrossStub.otherName,
                          selectedCrossStub.otherStageName
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedEdgeData ? (
              <div>
                <div className={sb.band} style={bandStyle}>
                  <Icon icon="ph:flow-arrow-bold" className={sb.bandIcon} />
                  <h4 className={sb.bandTitle}>
                    <button
                      type="button"
                      className={sb.jumpLink}
                      onClick={() => jumpToComponent(selectedEdgeData.from_id)}
                      {...tagProps("Jump to it", edgeFrom)}
                    >
                      {edgeFrom}
                    </button>{" "}
                    →{" "}
                    <button
                      type="button"
                      className={sb.jumpLink}
                      onClick={() => jumpToComponent(selectedEdgeData.to_id)}
                      {...tagProps("Jump to it", edgeTo)}
                    >
                      {edgeTo}
                    </button>
                  </h4>
                  {closeInspectorButton(() => setSelectedEdgeId(null))}
                </div>

                <div className={sb.body}>
                  {!selectedEdgeEditable.editable ? (
                    viewOnly(selectedEdgeEditable.reason ?? "")
                  ) : (
                    <>
                      <ChipRow>
                        <AxisChip axis="automation" kind="edge" target={selectedEdgeData} changes={atomicChanges} />
                        <AxisChip axis="governance" kind="edge" target={selectedEdgeData} changes={atomicChanges} />
                        <Chip
                          label={`Started by ${formatTrigger(selectedEdgeData.trigger || "none")}`}
                          lines={["What starts this hand-off once it is in place."]}
                        >
                          <span aria-hidden>{TRIGGER_ICONS[selectedEdgeData.trigger || "none"] ?? "•"}</span>
                          <span className={sb.chipLabel}>{formatTrigger(selectedEdgeData.trigger || "none")}</span>
                        </Chip>
                        <Chip
                          label={selectedEdgeData.slack === 1 ? "Soft dependency" : "Hard dependency"}
                          lines={[`Workflow link, kind: ${selectedEdgeData.kind}.`]}
                        >
                          <Icon icon="ph:link-simple-bold" aria-hidden />
                          <span className={sb.chipLabel}>{selectedEdgeData.slack === 1 ? "Soft" : "Hard"}</span>
                        </Chip>
                      </ChipRow>

                      {renderNotes(selectedEdgeData.id, "connection")}
                      {renderLadders(selectedEdgeData, "edge")}
                    </>
                  )}
                </div>
              </div>
            ) : selectedCompData ? (
              <div>
                <div className={sb.band} style={bandStyle}>
                  <Icon icon={selectedCompData.icon || "ph:cube-bold"} className={sb.bandIcon} />
                  <h4 className={sb.bandTitle} {...tagProps(selectedCompData.name)}>
                    {highlight(selectedCompData.name)}
                  </h4>
                  {renderOwner(selectedCompData.owner_id)}
                  {closeInspectorButton(() => setSelectedCompId(null))}
                </div>

                <div className={`${sb.body} ${selectedCompData.owner_id ? sb.bodyHang : ""}`}>
                  {!selectedCompEditable.editable ? (
                    viewOnly(selectedCompEditable.reason ?? "")
                  ) : (
                    <>
                      {selectedCompData.help && <p className={sb.caption}>{highlight(firstSentence(selectedCompData.help))}</p>}

                      <ChipRow>
                        <AxisChip axis="automation" kind="component" target={selectedCompData} changes={atomicChanges} />
                        <AxisChip axis="governance" kind="component" target={selectedCompData} changes={atomicChanges} />
                        {dependencyState && <DependencyChip state={dependencyState} onJump={jumpToComponent} />}
                      </ChipRow>
                      {dependencyState?.kind === "held" && (
                        <p className={sb.caveat}>Automating it further changes nothing until that is fixed.</p>
                      )}
                      {dependencyState?.kind === "uncertain" && (
                        <p className={sb.caveat}>
                          Still unknown:{" "}
                          {dependencyState.nodes.map((n, i) => (
                            <span key={n.id}>
                              {i > 0 && ", "}
                              <button type="button" className={sb.jumpLink} onClick={() => jumpToComponent(n.id)}>
                                {n.name}
                              </button>
                            </span>
                          ))}
                        </p>
                      )}

                      {pen && pen.target === selectedCompData.id ? (
                        <p className={sb.caveat}>
                          <Icon icon="ph:seal-bold" />{" "}
                          {stakeholders[pen.stakeholder_id]?.name || pen.stakeholder_id} drafts this one. Sealed
                          until you pitch.
                        </p>
                      ) : (
                        <>
                          {renderNotes(selectedCompData.id, "component")}
                          {renderLadders(selectedCompData, "component")}
                          {onDelegate && !pen && selectedCompData.owner_id && !slotsFull && (
                            <div data-coach="hand-over-the-pen">
                              {!delegatePickerOpen ? (
                                <button
                                  type="button"
                                  className={sb.heroBtn}
                                  onClick={() => setDelegatePickerOpen(true)}
                                >
                                  <Icon icon="ph:hand-arrow-up-bold" />
                                  <span>Hand it over</span>
                                </button>
                              ) : (
                                <div className={sb.handOverPanel}>
                                  <p>
                                    {stakeholders[selectedCompData.owner_id]?.name || selectedCompData.owner_id}{" "}
                                    drafts this one. It stays sealed until you pitch, and once handed over there
                                    is no taking it back.
                                  </p>
                                  <div className={sb.handOverActions}>
                                    <button
                                      type="button"
                                      className={sb.heroBtn}
                                      onClick={() => setDelegatePickerOpen(false)}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className={sb.heroBtn}
                                      onClick={() => {
                                        onDelegate(selectedCompData.owner_id!, selectedCompData.id);
                                        setDelegatePickerOpen(false);
                                      }}
                                    >
                                      <Icon icon="ph:hand-arrow-up-bold" />
                                      <span>Confirm</span>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className={sb.hero}>
                <div className={sb.heroDisc}>
                  <Icon icon="ph:cursor-click-duotone" />
                </div>
                <h4 className={sb.heroTitle}>Pick something to change</h4>
                <p className={sb.heroBody}>
                  Click a component on the board, or the handle on the line between two of them. Each step you add takes
                  one of your four slots.
                </p>
                {onOpenBoard && (
                  <div className={sb.heroHint}>
                    <span>Tied people together on the case board? Their threads show up here as marks.</span>
                    <button type="button" className={sb.heroBtn} onClick={onOpenBoard}>
                      <Icon icon="ph:push-pin-duotone" />
                      <span>Open the case board</span>
                    </button>
                  </div>
                )}
                <div className={sb.heroSlots} aria-label={`${usedSlots} of ${MAX_ATOMIC_CHANGES} slots used`}>
                  {Array.from({ length: MAX_ATOMIC_CHANGES }, (_, i) => (
                    <span key={i} className={`${sb.heroSlot} ${i < usedSlots ? sb.heroSlotOn : ""}`} />
                  ))}
                </div>
              </div>
            )}

            {/* Proposal: one line per slot */}
            <div className={sb.dock} data-coach="compose-slots">
              <div className={sb.sectionHead}>
                <Icon icon="ph:stack-duotone" />
                <span>Proposal</span>
                <span className={sb.sectionRight}>
                  {usedSlots} of {MAX_ATOMIC_CHANGES} slots
                </span>
              </div>
              <ProposalTickets
                entries={proposalEntries}
                max={MAX_ATOMIC_CHANGES}
                reserved={
                  penReservesSlot
                    ? {
                        displayName:
                          allComponentsMap.get(pen!.target)?.name ||
                          allEdgesMap.get(pen!.target)?.id ||
                          pen!.target,
                        holderName: stakeholders[pen!.stakeholder_id]?.name || pen!.stakeholder_id,
                      }
                    : null
                }
                onOpen={openProposalEntry}
                onRemove={handleRemoveSlot}
                bindTip={tip.bind}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal Footer ── */}
      <div className={styles.modalFooter}>
        <div className={styles.footerLeft}>
          <Icon icon="ph:info-bold" />
          <span>
            {unchangedSinceLastPitch
              ? "Nothing changed since your last pitch, so nobody has anything new to react to."
              : atomicChanges.length === 0
              ? "Add at least one change before taking this to the stakeholders."
              : `${atomicChanges.length} change${atomicChanges.length > 1 ? "s" : ""} to be argued for.`}
          </span>
        </div>

        <div className={styles.footerRight}>
          {currentPhase === 0 && (
            <div className={styles.hintGroup}>
              {hintLevel > 0 && (
                <span className={styles.hintText} role="status">
                  <Icon icon="ph:lightbulb-bold" /> {GRAPH_HINTS[hintLevel - 1]}
                </span>
              )}
              {hintLevel === GRAPH_HINTS.length && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={!hintCanSlot}
                  onClick={() => hintTarget && hintOption && handleAddOption(hintTarget, "automation", hintOption)}
                >
                  <Icon icon="ph:plus-bold" />
                  <span>Add it for me</span>
                </button>
              )}
              {hintLevel < GRAPH_HINTS.length && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setHintLevel((l) => Math.min(l + 1, GRAPH_HINTS.length))}
                >
                  <Icon icon="ph:lightbulb-bold" />
                  <span>{hintLevel === 0 ? "Hint" : "Another hint"}</span>
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={requestClose}
            {...tagProps("Back to Boardroom", "Leave the composer without proposing anything (Esc)")}
          >
            <Icon icon="ph:arrow-u-up-left-bold" />
            <span>Back to Boardroom</span>
          </button>

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={requestDiscard}
            disabled={atomicChanges.length === 0}
            {...tagProps("Discard changes", "Empty every slot and start the proposal again")}
          >
            Discard changes
          </button>

          <button
            type="button"
            className={`${styles.actionButton} ${styles.footerConfirm}`}
            disabled={atomicChanges.length === 0 || unchangedSinceLastPitch || stamping}
            onClick={handleConfirm}
            {...tagProps(
              "Confirm Proposal",
              unchangedSinceLastPitch
                ? "This is the card you already pitched - change at least one thing to pitch again."
                : "Sends this straight to the stakeholders for their reaction - a weak proposal can upset them. You can still revise it before the final decision."
            )}
          >
            <Icon icon="ph:check-bold" />
            <span>Confirm proposal ({atomicChanges.length})</span>
          </button>
        </div>
      </div>

      {stamping && (
        <div className={styles.stampOverlay} aria-hidden="true">
          <span className={styles.stampWord}>PROPOSED</span>
        </div>
      )}

      {tip.bubble}

      <AnimatePresence>
        {cappedCopy && (
          <CoachTip
            key="compose-capped"
            tone="mistake"
            title={cappedCopy.title}
            body={cappedCopy.body}
            anchor={`[data-coach-node="${cappedStep?.target}"]`}
            spotlight
            dismissLabel={PITCH_GUIDE.dismiss}
            onDismiss={() => markGuide(COMPOSE_KEYS.cappedTip)}
          />
        )}
        {guide && (
          <CoachTip
            key={"compose-" + guide.id}
            tone="guide"
            icon={guide.icon}
            title={guide.title}
            body={guide.body}
            anchor={guide.anchor}
            spotlight
            dismissLabel={guide.action ? PITCH_GUIDE.skipStep : PITCH_GUIDE.dismiss}
            onDismiss={() => markGuide(guide.key)}
            secondaryLabel={PITCH_GUIDE.skip}
            onSecondary={() => markGuide(COMPOSE_KEYS.off)}
          />
        )}
      </AnimatePresence>

      {confirmingLeave && (
        <div
          className={styles.leaveConfirmOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelLeave();
          }}
        >
          <div className={styles.leaveConfirmCard} role="alertdialog" aria-modal="true">
            <div className={styles.leaveConfirmTitle}>
              <Icon icon="ph:warning-bold" style={{ fontSize: "1.3rem" }} />
              <span>{confirmingLeave === "close" ? "Leave without proposing?" : "Discard these changes?"}</span>
            </div>
            <p className={styles.leaveConfirmBody}>
              {confirmingLeave === "close"
                ? "Your slot changes have not been sent to the stakeholders. Leaving now loses them."
                : "This empties every slot you've configured. It can't be undone."}
            </p>
            <div className={styles.leaveConfirmActions}>
              <button type="button" className={styles.secondaryBtn} onClick={cancelLeave} autoFocus>
                Keep editing
              </button>
              <button type="button" className={`${styles.actionButton} ${styles.dangerButton}`} onClick={confirmLeave}>
                {confirmingLeave === "close" ? "Leave anyway" : "Discard"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </HoverTooltipTheme>
  );
}
