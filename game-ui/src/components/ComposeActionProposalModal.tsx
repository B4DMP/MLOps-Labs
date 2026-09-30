import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { EMOJI_ICON } from "../utils/emojiIcons";
import styles from "./ComposeActionProposalModal.module.css";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import { useSpeech } from "./useSpeech";
import { startTour } from "../utils/tour";
import { TOUR_GUIDE_SEED } from "../utils/speech";
import type { Stakeholder } from "./StakeholderProvider";
import type { StakeholderDossierEntry, IntelEntry } from "./StakeholderDossier";
import { StakeholderAvatarComponent } from "./StakeholderAvatarComponent";
import { useGlossaryHighlighter } from "./glossary/GlossaryText";
import {
  CappedChainGlyph,
  CrossPhaseStub,
  EDGE_FLOW_ANIM,
  edgeStrokeWidth,
  FlowParticle,
  LevelMeter,
  NodeDefs,
  NodeIcon,
  NodeTitleAberration,
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
  NODE_TITLE_Y,
  NODE_RX,
  RAIL_W,
  nodeFace,
  compactLayout,
  crossPhaseExplanation,
  edgeEnds,
  fitToBoxStyle,
  formatAxisLevel,
  formatTrigger,
  AUTOMATION_META,
  AXIS_TITLES,
  GOVERNANCE_META,
  LEVEL_EMPTY,
  axisMeta,
  levelRungs,
  TRIGGER_ICONS,
  wrapLabel,
  type Axis,
} from "../utils/stageCanvas";
import type { AtomicChange, ItemPrediction } from "../types/ActionCard";
import {
  AXES,
  addOption,
  ceilingOn,
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
  type OptionStatus,
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
 *  can carry several genuinely different steps chained on the same axis ("Implement It" then
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
}

export interface ComposeActionProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhase: number;
  currentChallenge: number;
  initialAtomicChanges?: AtomicChange[];
  /** Opens the composer with this target already selected in the inspector - e.g. the player
   *  clicked a specific change row on the pitch deck's card rather than the card generally. */
  initialSelectedTargetId?: string;
  onConfirmProposal: (atomicChanges: AtomicChange[]) => void;
  allowedTargets?: string[];
  upstreamMap?: Record<string, string[]>;
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
}

const MAX_ATOMIC_CHANGES = 3;

/** One dossier note, carrying who it belongs to so clicking it can jump the dossier there. */
interface LinkedNote {
  item: IntelEntry;
  stakeholderName: string;
  stakeholderId?: string;
}

const NOTE_SOURCE_META: Record<string, { icon: string; label: string }> = {
  public_record: { icon: "ph:megaphone-duotone", label: "Said openly in the team channel" },
  interview: { icon: "ph:chats-circle-bold", label: "They told you this directly" },
  debate: { icon: "ph:microphone-stage-bold", label: "Came out during the pitch" },
  offline_artifact: { icon: "ph:file-text-bold", label: "You read this in a document" },
};

function noteSourceMeta(item: IntelEntry) {
  return NOTE_SOURCE_META[(item.source || "offline_artifact").toLowerCase()] ?? NOTE_SOURCE_META.offline_artifact;
}

/**
 * Canvas legend, shown on hover rather than permanently occupying a toolbar row. It reads the
 * node in the order the node is drawn: the rail down its left edge says how it is doing, the
 * meter along its bottom says how far it is built, and the corner marks say what you may do
 * with it here.
 */
const LEGEND_GROUPS: Array<{
  heading: string;
  items: Array<{ label: string; swatch?: CSSProperties; glyph?: string }>;
}> = [
  {
    heading: "Status rail",
    items: [
      { label: "Running as built", swatch: { background: NODE_COLORS.healthy } },
      { label: "Held back by a bottleneck", swatch: { background: NODE_COLORS.capped } },
      { label: "Broken", swatch: { background: NODE_COLORS.broken } },
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
      { label: "Not built", swatch: { background: LEVEL_EMPTY } },
    ],
  },
  {
    heading: "Governance track (meter, right)",
    items: [
      ...GOVERNANCE_META.slice(1).map((rung, i) => ({
        label: `${i + 1}. ${rung.label}`,
        swatch: { background: rung.color },
      })),
      { label: "Above this target's ceiling", swatch: { border: `1px dashed ${LEVEL_EMPTY}`, background: "transparent" } },
    ],
  },
  {
    heading: "Marks",
    items: [
      { label: "In your proposal", icon: EMOJI_ICON.power.icon, iconColor: EMOJI_ICON.power.color },
      { label: "Another phase - view only", icon: "noto:eye" },
      { label: "Dashed outline: undiscovered", swatch: { border: "1.5px dashed #94a3b8", background: "#f8fafc" } },
      { label: "Flat pale face: another phase", swatch: { border: "1.5px solid #cbd5e1", background: "#eef2f7" } },
      {
        label: "Handle on a line: the connection is editable",
        swatch: { border: "1.25px solid #64748b", background: "#ffffff", borderRadius: "9999px", height: "11px" },
      },
    ],
  },
];

/**
 * What each axis means depends on whether the target is a component or a hand-off between
 * two (00-plan.md §2.2), so the two sections of an inspector are introduced accordingly.
 */
const AXIS_HINTS: Record<"component" | "edge", Record<Axis, string>> = {
  component: {
    automation: "Who does the work: a person, or tooling.",
    governance: "How closely this component's own output is reviewed.",
  },
  edge: {
    automation: "Whether the hand-off fires by itself, or only when someone asks.",
    governance: "Whether this hand-off needs sign-off before it may happen.",
  },
};

const AXIS_ICONS: Record<Axis, string> = {
  automation: "ph:lightning-bold",
  governance: "ph:shield-check-bold",
};

/** A small row of pips for one axis, in that axis's own colours, for the inspector header. */
function AxisPipRow({ axis, level, projected, ceiling }: { axis: Axis; level: number; projected: number; ceiling: number }) {
  return (
    <span className={styles.axisPips} aria-hidden>
      {[1, 2, 3].map((r) => {
        const above = r > ceiling;
        const built = axis === "automation" && level === 0 ? r === 1 : r <= level;
        const planned = !built && r <= projected;
        return (
          <span
            key={r}
            className={`${styles.axisPip} ${above ? styles.axisPipAbove : ""} ${planned ? styles.axisPipPlanned : ""}`}
            style={built ? { background: axisMeta(axis, level === 0 ? 0 : r).color, borderColor: "transparent" } : undefined}
          />
        );
      })}
    </span>
  );
}

/**
 * One axis of one target, as the ladder of authored options that climbs it. Every option is a
 * single ready-made step: the player adds the next one by name, and sees the ones already in
 * place, the ones already in the proposal, and the ones that need a step below them first.
 * There is no level to type and no trigger to choose - an edge's automation option already
 * says what starts the hand-off.
 */
function OptionLadder({
  axis,
  target,
  kind,
  changes,
  slotsFull,
  onAdd,
  onRemove,
}: {
  axis: Axis;
  target: OptionTarget;
  kind: "component" | "edge";
  changes: AtomicChange[];
  slotsFull: boolean;
  onAdd: (option: GraphOption) => void;
  onRemove: (option: GraphOption) => void;
}) {
  const nominal = nominalOn(target, axis);
  const projected = projectedOn(target, axis, changes);
  const ceiling = ceilingOn(target, axis);
  const options = optionsOn(target, axis);
  const now = axisMeta(axis, nominal);
  // Nothing to review on a target nobody has implemented yet - there's no governance ladder to
  // climb until an automation step has landed it at manual or above.
  const governanceLocked = axis === "governance" && !isImplemented(target, changes);

  const statusLabel: Record<OptionStatus, string> = {
    done: "In place",
    slotted: "In proposal",
    next: "",
    later: "Needs the step above",
  };

  return (
    <div className={`${styles.axisSection} ${axis === "governance" ? styles.axisSectionGovernance : ""}`}>
      <div className={styles.axisHeader}>
        <span className={styles.formLabel}>
          <Icon icon={AXIS_ICONS[axis]} />
          <span>{AXIS_TITLES[axis]}</span>
        </span>
        <span
          className={styles.axisNow}
          style={{ ["--rung" as string]: now.color, ["--rung-ink" as string]: now.ink }}
          title={`${AXIS_TITLES[axis]} today: ${now.label}`}
        >
          <Icon icon={now.icon} aria-hidden />
          <span>{now.label}</span>
          <AxisPipRow axis={axis} level={nominal} projected={projected} ceiling={ceiling} />
        </span>
      </div>
      <span className={styles.axisHint}>
        {AXIS_HINTS[kind][axis]}
        {governanceLocked && " Nothing to review until it's implemented."}
      </span>

      {governanceLocked ? (
        <span className={styles.axisEmpty}>
          <Icon icon="ph:lock-simple-bold" /> Implement it on automation first - you can't govern something that
          doesn't exist yet.
        </span>
      ) : options.length === 0 ? (
        <span className={styles.axisEmpty}>
          {nominal >= ceiling
            ? `${formatAxisLevel(axis, ceiling)} is as far as this goes on ${AXIS_TITLES[axis].toLowerCase()}.`
            : `No ${AXIS_TITLES[axis].toLowerCase()} step is on offer here.`}
        </span>
      ) : (
        <div className={styles.optionList} role="list">
          {options.map((option) => {
            const status = optionStatus(target, axis, option, changes);
            const rung = axisMeta(axis, option.to_level);
            const showDescription = option.description && option.description.trim() !== option.name.trim();
            return (
              <div
                key={`${axis}-${option.to_level}`}
                role="listitem"
                className={`${styles.optionRow} ${
                  status === "next"
                    ? styles.optionRowNext
                    : status === "slotted"
                    ? styles.optionRowSlotted
                    : status === "done"
                    ? styles.optionRowDone
                    : styles.optionRowLater
                }`}
                style={{ ["--rung" as string]: rung.color, ["--rung-ink" as string]: rung.ink }}
              >
                <Icon icon={status === "done" ? "ph:check-circle-bold" : rung.icon} className={styles.optionIcon} aria-hidden />
                <div className={styles.optionText}>
                  <span className={styles.optionName}>{optionDisplayName(target, axis, option)}</span>
                  {showDescription && <span className={styles.optionDesc}>{option.description}</span>}
                  <span className={styles.optionMeta}>
                    <span className={styles.optionTag} title={`${AXIS_TITLES[axis]} rung this step lands on`}>
                      → {rung.label}
                    </span>
                    {option.trigger && (
                      <span className={styles.optionTag} title="What starts the hand-off once this is in place">
                        {TRIGGER_ICONS[option.trigger] ?? "?"} {formatTrigger(option.trigger)}
                      </span>
                    )}
                  </span>
                </div>
                <div className={styles.optionAction}>
                  {status === "next" ? (
                    <button
                      type="button"
                      className={styles.optionAddBtn}
                      disabled={slotsFull}
                      onClick={() => onAdd(option)}
                      title={slotsFull ? `All ${MAX_ATOMIC_CHANGES} slots are used` : "Add this step to the proposal - one slot"}
                    >
                      <Icon icon="ph:plus-bold" />
                      <span>{slotsFull ? "Slots full" : "Add"}</span>
                    </button>
                  ) : status === "slotted" ? (
                    <button
                      type="button"
                      className={styles.optionRemoveBtn}
                      onClick={() => onRemove(option)}
                      title="Take this step (and any step after it on this axis) back out"
                    >
                      <Icon icon="ph:x-bold" />
                      <span>{statusLabel.slotted}</span>
                    </button>
                  ) : (
                    <span className={styles.optionState}>
                      {status === "later" && <Icon icon="ph:lock-simple-bold" />}
                      {statusLabel[status]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ComposeActionProposalModal({
  isOpen,
  onClose,
  currentPhase,
  currentChallenge,
  initialAtomicChanges = [],
  initialSelectedTargetId,
  onConfirmProposal,
  allowedTargets = [],
  upstreamMap = {},
  predictions = [],
  boundaryWarnings: _boundaryWarnings = [],
  // Superseded by dossierData's own intel_total for the header's found/total count, which
  // reflects everything the player has actually found rather than just this challenge's set.
  intelItems: _intelItems = [],
  graphState: propGraphState = null,
  dossierData = [],
  stakeholders = {},
  onOpenStakeholder,
  onSelectIntel,
  intelTotal = 0,
  intelVerified = 0,
}: ComposeActionProposalModalProps) {
  const { emit, subscribe } = useGameWebSocket();
  const highlight = useGlossaryHighlighter("action_proposal");
  const { speak: speakTts } = useSpeech();

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

  // A cross-phase stub isn't a real target - selecting a real one always drops it, without
  // touching every place that already sets selectedCompId/selectedEdgeId. Deselecting a real
  // target (both go back to null) does not fire this, so a stub click - which also clears
  // the other two - is not immediately undone by this effect.
  useEffect(() => {
    if (selectedCompId || selectedEdgeId) setSelectedCrossStub(null);
  }, [selectedCompId, selectedEdgeId]);

  // Whether to leave the composer, or discard its slots, needs confirming first: null means
  // no confirmation is pending, otherwise which action is waiting on one.
  const [confirmingLeave, setConfirmingLeave] = useState<"close" | "discard" | null>(null);

  // Slotted changes only ever reach the parent (and the stakeholders) via Confirm - closing
  // the composer any other way, or discarding, throws away anything since the last confirm.
  const isDirty = useMemo(
    () => JSON.stringify(atomicChanges) !== JSON.stringify(initialAtomicChangesResolved),
    [atomicChanges, initialAtomicChangesResolved]
  );

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

  // Hover/focus info tag (ported from StakeholderDossier.tsx / pitch_debate.tsx's own
  // showInfoTag) - a flip-in tag anchored to whatever's hovered/focused, replacing plain
  // `title` tooltips throughout the composer's chrome and canvas. Flips above its anchor
  // when there isn't room below (the footer buttons sit right at the window's bottom edge),
  // the same pass StakeholderDossier's EmotionRevealBadge and HoverToolTip.tsx already do.
  const [infoTag, setInfoTag] = useState<{
    label: string;
    detail?: string;
    anchorTop: number;
    anchorBottom: number;
    anchorX: number;
    top: number;
    left: number;
    placement: "above" | "below";
  } | null>(null);
  const infoTagRef = useRef<HTMLDivElement>(null);

  const showInfoTag = (e: React.SyntheticEvent, label: string, detail?: string) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    setInfoTag({
      label,
      detail,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      anchorX,
      top: rect.bottom + 6,
      left: anchorX,
      placement: "below",
    });
  };
  const hideInfoTag = () => setInfoTag(null);

  /** Spread onto any element to give it the hover/focus tag in one line, same shape as the
   *  dossier's own stampTagProps. */
  const tagProps = (label: string, detail?: string) => ({
    onMouseEnter: (e: React.SyntheticEvent) => showInfoTag(e, label, detail),
    onMouseLeave: hideInfoTag,
    onFocus: (e: React.SyntheticEvent) => showInfoTag(e, label, detail),
    onBlur: hideInfoTag,
  });

  useLayoutEffect(() => {
    if (!infoTag || !infoTagRef.current) return;
    const box = infoTagRef.current.getBoundingClientRect();
    const half = box.width / 2;
    const left = Math.min(Math.max(infoTag.anchorX, 6 + half), window.innerWidth - 6 - half);

    let top = infoTag.anchorBottom + 6;
    let placement: "above" | "below" = "below";
    if (top + box.height > window.innerHeight - 6) {
      const above = infoTag.anchorTop - 6 - box.height;
      if (above >= 6) {
        top = above;
        placement = "above";
      } else {
        top = Math.max(6, window.innerHeight - 6 - box.height);
      }
    }

    setInfoTag((prev) =>
      prev && prev.left === left && prev.top === top && prev.placement === placement
        ? prev
        : prev && { ...prev, left, top, placement }
    );
  }, [infoTag?.anchorX, infoTag?.anchorTop, infoTag?.anchorBottom, infoTag?.label, infoTag?.detail]);

  useEffect(() => {
    if (!infoTag) return;
    const handleScroll = () => hideInfoTag();
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [infoTag]);

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
      setInfoTag(null);
      setConfirmingLeave(null);
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
  const introComposeTourStartedRef = useRef(false);
  useEffect(() => {
    // Phase 0 has exactly one challenge, so checking the phase alone is sufficient -
    // `currentChallenge` is the challenge's *global* id (e.g. 113), not a phase-relative index.
    if (!isOpen || currentPhase !== 0) return;
    if (introComposeTourStartedRef.current) return;
    introComposeTourStartedRef.current = true;
    startTour("introCompose", { narrate: (text) => speakTts(text, { slot: "narrator", seed: TOUR_GUIDE_SEED }) });
  }, [isOpen, currentPhase]);

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

  const slotsFull = atomicChanges.length >= MAX_ATOMIC_CHANGES;

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
  const handleRemoveSlot = (index: number) => {
    setAtomicChanges((prev) => removeChangeAt(prev, index));
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
            className={`${styles.slotsIndicator} ${
              atomicChanges.length === MAX_ATOMIC_CHANGES ? styles.slotsFull : ""
            }`}
            tabIndex={0}
            {...tagProps(
              "Proposal Slots",
              atomicChanges.length === MAX_ATOMIC_CHANGES
                ? "All 3 slots are used - remove one to add another"
                : "Up to 3 changes can go into one proposal"
            )}
          >
            <Icon icon="ph:cpu-bold" />
            <span>
              {atomicChanges.length} / {MAX_ATOMIC_CHANGES} Slots Configured
            </span>
          </div>

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
      <div
        className={styles.stageTabsBar}
        data-intro-group="introCompose"
        data-title="Pipeline Stages"
        data-intro="This is the pipeline stage switcher. Only the stage for your current phase is editable here (the dot marks it); the others are view-only, so you can check how a change here would ripple downstream before it's actually rippled anywhere."
        data-step="1"
      >
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
            </button>
          );
        })}
      </div>

      {/* ── Split Body ── */}
      <div className={styles.modalBody}>
        {/* Left: Graph Canvas Viewport */}
        <div
          className={styles.canvasArea}
          data-intro-group="introCompose"
          data-title="Pipeline Nodes"
          data-intro="These nodes are the pipeline's components. Click one to add a change to your proposal - up to 3 per pitch. Each change is a promise: raise this component's automation or governance to a specific level, a promise the simulation will absolutely check on."
          data-step="2"
        >
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
              <span className={styles.legendChip} tabIndex={0}>
                <Icon icon="ph:list-bullets-bold" />
                <span>Legend</span>
                <span className={styles.legendPanel} role="tooltip">
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
                  <NodeDefs prefix="compose" />
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
                      markerId = "arr-primary";
                    } else if (isOtherPhase) {
                      color = "#cbd5e1";
                      markerId = "arr-default";
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

                    const mx = (ax + bx) / 2;
                    const my = (ay + by) / 2;
                    const baseWidth = edgeStrokeWidth(e.automation);
                    const isAutomated =
                      e.automation !== undefined && e.automation !== null && e.automation >= 3;
                    const edgeSummary = `Automation: ${formatAxisLevel("automation", e.automation)}${
                      e.trigger && e.trigger !== "none" ? `, started by ${formatTrigger(e.trigger)}` : ""
                    }\nGovernance: ${formatAxisLevel("governance", e.governance ?? 0)}`;
                    const hasTrigger = Boolean(e.trigger && e.trigger !== "none");
                    // Every edge the player may act on gets a handle, triggered or not; the
                    // slotted and view-only badges already own the midpoint when they show.
                    const showHandle = !isSlotted && !isOtherPhase;
                    const edgeTagDetail =
                      `${edgeSummary}\n${isOtherPhase ? "View only in this challenge" : "Click to edit this connection"}`;

                    return (
                      <g key={e.id}>
                        {/* Visible edge line */}
                        <line
                          className={pipeClass}
                          x1={ax}
                          y1={ay}
                          x2={bx}
                          y2={by}
                          stroke={color}
                          strokeWidth={
                            isSelected ? 3.5
                              : isSlotted ? 3
                              : isHovered ? 2.5
                              : isPredecessorLine ? 2.5
                              : Math.max(baseWidth, 1.5)
                          }
                          strokeDasharray={isOtherPhase ? "4 3" : undefined}
                          markerEnd={`url(#${markerId})`}
                          style={{ cursor: showHandle ? "pointer" : undefined }}
                          opacity={isHovered ? 1 : 0.92}
                        />
                        {isAutomated && <FlowParticle x1={ax} y1={ay} x2={bx} y2={by} color={color} />}

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
                            showInfoTag(e2, `${from.name} → ${to.name}`, edgeTagDetail);
                          }}
                          onMouseLeave={() => {
                            setHoveredEdgeId(null);
                            hideInfoTag();
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
                    const isSelected = selectedCompId === c.id;
                    const isSlotted = atomicChanges.some((change) => change.target === c.id);
                    const isPredecessor = activeHighlightedPredecessors.has(c.id);
                    const compEdit = isTargetEditable(c.id, "component", c.stage_id || activeStageId);
                    const isOtherPhase = !compEdit.editable;
                    const upstreamCheck = isUpstreamUncertain(c.id);

                    const isBroken = (c.nominal_automation ?? 1) === 0;
                    // Runs at nothing, but is not itself broken: something upstream is down.
                    const isStarved = !isBroken && (c.effective_automation ?? 1) === 0;
                    const rail = isSlotted
                      ? NODE_COLORS.selected
                      : isBroken
                      ? NODE_COLORS.broken
                      : upstreamCheck.uncertain
                      ? "#b45309"
                      : c.capped_by
                      ? NODE_COLORS.capped
                      : NODE_COLORS.healthy;
                    const face = nodeFace("compose", {
                      selected: isSelected || isSlotted || isPredecessor,
                      broken: isBroken,
                    });
                    const stroke = isSlotted || isSelected
                      ? NODE_COLORS.selected
                      : isPredecessor
                      ? NODE_COLORS.selected
                      : "#dde5ee";

                    const lines = wrapLabel(c.name || c.id, 17);
                    const safeId = c.id.replace(/\./g, "_");
                    // Where each axis would sit once every slotted step lands, drawn ahead of
                    // what is built as translucent notches.
                    const previewAutomation = projectedOn(c, "automation", atomicChanges);
                    const previewGovernance = projectedOn(c, "governance", atomicChanges);
                    // A target can carry several chained steps on the same axis (one slot each,
                    // "Implement It" then "Automate It") - the settled rung each would land on is
                    // `previewAutomation`/`previewGovernance` above, never any single change's own
                    // value, which might just be one link in that chain.
                    const automationQueued = previewAutomation !== nominalOn(c, "automation");
                    const governanceQueued = previewGovernance !== nominalOn(c, "governance");
                    const nodeTagStatus = isOtherPhase
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
                    const nodeTagProposed = [
                      automationQueued
                        ? `\nProposed automation: ${formatAxisLevel("automation", c.nominal_automation ?? 1)} → ${formatAxisLevel(
                            "automation",
                            previewAutomation
                          )}`
                        : "",
                      governanceQueued
                        ? `\nProposed governance: ${formatAxisLevel("governance", c.nominal_governance ?? 0)} → ${formatAxisLevel(
                            "governance",
                            previewGovernance
                          )}`
                        : "",
                    ].join("");
                    const nodeTagDetail = `${nodeTagStatus}${nodeTagProposed}\nClick to inspect`;

                    return (
                      <g
                        key={c.id}
                        className={styles.stageNode}
                        transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2})`}
                        onClick={() => {
                          setSelectedCompId(isSelected ? null : c.id);
                          setSelectedEdgeId(null);
                        }}
                        onMouseEnter={(e) => {
                          setHoveredCompId(c.id);
                          showInfoTag(e, c.name || c.id, nodeTagDetail);
                        }}
                        onMouseLeave={() => {
                          setHoveredCompId(null);
                          hideInfoTag();
                        }}
                      >
                        <g className={isBroken ? "node-broken" : undefined}>
                        {/* Card face */}
                        <rect
                          width={BOX_W}
                          height={BOX_H}
                          rx={NODE_RX}
                          fill={face}
                          stroke={stroke}
                          strokeWidth={1}
                          filter={`url(#compose-${
                            isBroken ? "broken-face" : isSelected || isSlotted ? "shadow-lifted" : "shadow"
                          })`}
                        />
                        <clipPath id={`compose-clip-${safeId}`}>
                          <rect width={BOX_W} height={BOX_H} rx={NODE_RX} />
                        </clipPath>
                        <rect
                          width={RAIL_W}
                          height={BOX_H}
                          fill={rail}
                          clipPath={`url(#compose-clip-${safeId})`}
                        />
                        {!isBroken && c.capped_by && (
                          <CappedChainGlyph color={rail} />
                        )}

                        {/* Slotted marker */}
                        {isSlotted && (
                          <g transform={`translate(${BOX_W - 26}, 5)`}>
                            <circle cx="9" cy="9" r="9" fill={NODE_COLORS.selected} />
                            <text x="9" y="12.5" fontSize="9" textAnchor="middle" fill="#ffffff" fontWeight="bold">
                              ⚡
                            </text>
                          </g>
                        )}

                        {/* Another phase: readable here, editable elsewhere */}
                        {isOtherPhase && !isSlotted && (
                          <g transform={`translate(${BOX_W - 24}, 5)`}>
                            <circle cx="8" cy="8" r="8" fill="#eef2f7" stroke="#dde5ee" />
                            <text x="8" y="11" fontSize="8" textAnchor="middle">
                              👁
                            </text>
                          </g>
                        )}

                        {/* Icon, sharing the title's row */}
                        {c.icon && <NodeIcon icon={c.icon} color={rail} />}

                        {/* Node Title, with its colour-split ghosts underneath when broken */}
                        {isBroken && (
                          <NodeTitleAberration
                            lines={lines}
                            x={(i) => NODE_PAD_X + (c.icon && i === 0 ? NODE_ICON_OFFSET : 0)}
                            fontWeight={isSelected || isSlotted ? 700 : 600}
                          />
                        )}
                        {lines.map((line, i) => (
                          <text
                            key={i}
                            x={NODE_PAD_X + (c.icon && i === 0 ? NODE_ICON_OFFSET : 0)}
                            y={NODE_TITLE_Y + i * NODE_TITLE_LH}
                            fill={isSelected || isSlotted ? "var(--primary-bg)" : "#15243b"}
                            fontSize="11"
                            fontWeight={isSelected || isSlotted ? "700" : "600"}
                          >
                            {line}
                          </text>
                        ))}

                        {/* One caption, plus the maturity meter when there is one to show */}
                            <LevelCaption
                              level={c.effective_automation ?? c.nominal_automation ?? 1}
                              governance={c.nominal_governance}
                              y={NODE_CAPTION_Y}
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
                            />

                        </g>

                        {(isSelected || isSlotted) && <SelectionReticle />}
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

        {/* Right: Inspector & Slots Panel */}
        <div
          className={styles.sidebarArea}
          data-intro-group="introCompose"
          data-title="Proposal Slot"
          data-intro="Once you select a node, its details show up here: what level to raise it to, and why. Add it to a slot, and it becomes part of the proposal you'll pitch to the room - and shortly after, part of what the room remembers you promising."
          data-step="3"
        >
          <div className={styles.sidebarContent}>
            {selectedCrossStub ? (
              /* ── Cross-Phase Dependency: purely informational, nothing to build here ── */
              <div className={styles.inspectorCard}>
                <div className={styles.inspectorHeader}>
                  <div className={styles.inspectorHeading}>
                    <Icon icon="ph:link-break-bold" className={styles.inspectorIcon} />
                    <div className={styles.inspectorHeadingText}>
                      <span className={styles.inspectorTitle}>Cross-Phase Dependency</span>
                      <span className={styles.inspectorSubtitle}>{selectedCrossStub.otherStageName}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.inspectorClose}
                    onClick={() => setSelectedCrossStub(null)}
                    {...tagProps("Close inspector")}
                  >
                    <Icon icon="ph:x-bold" />
                  </button>
                </div>
                <div className={styles.inspectorBody}>
                  <div className={styles.lockedPhaseBanner}>
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
              <div className={styles.inspectorCard}>
                <div className={styles.inspectorHeader}>
                  <div className={styles.inspectorHeading}>
                    <Icon icon="ph:flow-arrow-bold" className={styles.inspectorIcon} />
                    <div className={styles.inspectorHeadingText}>
                      <span className={styles.inspectorTitle}>
                        <button
                          type="button"
                          className={styles.inlineJumpLink}
                          onClick={() => jumpToComponent(selectedEdgeData.from_id)}
                          {...tagProps("Jump to it", allComponentsMap.get(selectedEdgeData.from_id)?.name || selectedEdgeData.from_id)}
                        >
                          {allComponentsMap.get(selectedEdgeData.from_id)?.name || selectedEdgeData.from_id}
                        </button>{" "}
                        →{" "}
                        <button
                          type="button"
                          className={styles.inlineJumpLink}
                          onClick={() => jumpToComponent(selectedEdgeData.to_id)}
                          {...tagProps("Jump to it", allComponentsMap.get(selectedEdgeData.to_id)?.name || selectedEdgeData.to_id)}
                        >
                          {allComponentsMap.get(selectedEdgeData.to_id)?.name || selectedEdgeData.to_id}
                        </button>
                      </span>
                      <span className={styles.inspectorSubtitle}>
                        workflow · {selectedEdgeData.kind} ·{" "}
                        {selectedEdgeData.slack === 1 ? "soft dependency" : "hard dependency"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.inspectorClose}
                    onClick={() => setSelectedEdgeId(null)}
                    {...tagProps("Close inspector")}
                  >
                    <Icon icon="ph:x-bold" />
                  </button>
                </div>

                <div className={styles.inspectorBody}>

                  {!selectedEdgeEditable.editable ? (
                    /* Other Phase Locked Guard */
                    <div className={styles.lockedPhaseBanner}>
                      <Icon icon="ph:eye-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                      <div>
                        <strong>View only:</strong> {highlight(selectedEdgeEditable.reason ?? "")}
                      </div>
                    </div>
                  ) : (
                    /* Editable Edge Controls */
                    <>
                      <div className={styles.statusStrip}>
                        <span className={styles.statusLabel}>Hand-off</span>
                        <span className={styles.statusValue}>
                          {formatAxisLevel("automation", nominalOn(selectedEdgeData, "automation"))}
                        </span>
                        <span className={styles.statusSep}>·</span>
                        <span className={styles.statusLabel}>started by</span>
                        <span className={styles.statusValue}>{formatTrigger(selectedEdgeData.trigger || "none")}</span>
                        <span className={styles.statusSep}>·</span>
                        <span className={styles.statusValue}>
                          {formatAxisLevel("governance", nominalOn(selectedEdgeData, "governance"))}
                        </span>
                      </div>

                      {/* Intel notes filed against this connection - shown before the picker
                          so the evidence informs the decision. */}
                      {(notesByTarget[selectedEdgeData.id]?.length ?? 0) > 0 && (
                        <div className={styles.notesSection}>
                          <span className={styles.notesSectionLabel}>
                            <Icon icon="ph:notebook-bold" /> Intel on this connection ({intelCountLabel(notesByTarget[selectedEdgeData.id])})
                          </span>
                          <div className={styles.noteLinkList}>
                            {notesByTarget[selectedEdgeData.id].map((note) => {
                              const meta = noteSourceMeta(note.item);
                              return (
                                <button
                                  key={note.item.id}
                                  type="button"
                                  className={`${styles.noteLink} ${onSelectIntel ? "" : styles.noteLinkFlat}`}
                                  disabled={!onSelectIntel}
                                  onClick={() => onSelectIntel?.(note.item.id, note.stakeholderId)}
                                  {...tagProps(meta.label, onSelectIntel ? "Click to jump to it in your dossier" : undefined)}
                                >
                                  <Icon icon={meta.icon} className={styles.noteLinkIcon} />
                                  <span className={styles.noteLinkText}>
                                    {note.item.fact || note.item.description}
                                    <em className={styles.noteLinkWho}> - {note.stakeholderName}</em>
                                  </span>
                                  {onSelectIntel && <Icon icon="ph:arrow-bend-up-left-bold" className={styles.noteLinkGo} />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* One ladder per axis. The automation options already carry the
                          trigger they switch the hand-off to, so there is no trigger picker. */}
                      <div className={styles.formStack}>
                        {AXES.map((axis) => (
                          <OptionLadder
                            key={axis}
                            axis={axis}
                            target={selectedEdgeData}
                            kind="edge"
                            changes={atomicChanges}
                            slotsFull={slotsFull}
                            onAdd={(option) => handleAddOption(selectedEdgeData, axis, option)}
                            onRemove={(option) => handleRemoveOption(selectedEdgeData, axis, option)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : selectedCompData ? (
              /* ── Selected COMPONENT Inspector ── */
              <div className={styles.inspectorCard}>
                <div className={styles.inspectorHeader}>
                  <div className={styles.inspectorHeading}>
                    <Icon icon={selectedCompData.icon || "ph:cube-bold"} className={styles.inspectorIcon} />
                    <div className={styles.inspectorHeadingText}>
                      <div className={styles.inspectorTitleRow}>
                        <span className={styles.inspectorTitle}>{highlight(selectedCompData.name)}</span>
                        {selectedCompData.owner_id && (
                          onOpenStakeholder ? (
                            <button
                              type="button"
                              className={styles.ownerLink}
                              onClick={() => onOpenStakeholder(selectedCompData.owner_id!)}
                              {...tagProps(
                                "Owner",
                                `Open ${stakeholders[selectedCompData.owner_id]?.name ?? selectedCompData.owner_id}'s dossier page`
                              )}
                            >
                              <StakeholderAvatarComponent
                                stakeholderId={selectedCompData.owner_id}
                                avatar={stakeholders[selectedCompData.owner_id]?.avatar}
                                stakeholderColor={stakeholders[selectedCompData.owner_id]?.stakeholder_color}
                                isFramed={false}
                                size={16}
                                hoverToSuspicious={false}
                                className={styles.ownerLinkAvatar}
                              />
                              <span>{stakeholders[selectedCompData.owner_id]?.name ?? selectedCompData.owner_id.replace(/_/g, " ")}</span>
                              <Icon icon="ph:arrow-square-out-bold" className={styles.ownerLinkGo} />
                            </button>
                          ) : (
                            <span className={styles.inspectorOwner}>
                              <StakeholderAvatarComponent
                                stakeholderId={selectedCompData.owner_id}
                                avatar={stakeholders[selectedCompData.owner_id]?.avatar}
                                stakeholderColor={stakeholders[selectedCompData.owner_id]?.stakeholder_color}
                                isFramed={false}
                                size={16}
                                hoverToSuspicious={false}
                              />
                              <span>{stakeholders[selectedCompData.owner_id]?.name ?? selectedCompData.owner_id.replace(/_/g, " ")}</span>
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.inspectorClose}
                    onClick={() => setSelectedCompId(null)}
                    {...tagProps("Close inspector")}
                  >
                    <Icon icon="ph:x-bold" />
                  </button>
                </div>

                <div className={styles.inspectorBody}>

                  {!selectedCompEditable.editable ? (
                    /* Other Phase Locked Guard */
                    <div className={styles.lockedPhaseBanner}>
                      <Icon icon="ph:eye-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                      <div>
                        <strong>View only:</strong> {highlight(selectedCompEditable.reason ?? "")}
                      </div>
                    </div>
                  ) : (
                    /* Editable Component Controls */
                    <>
                      <div className={styles.statusStrip}>
                        <span className={styles.statusLabel}>Runs</span>
                        <span className={styles.statusValue}>
                          {formatAxisLevel("automation", nominalOn(selectedCompData, "automation"))}
                        </span>
                        <span className={styles.statusSep}>·</span>
                        <span className={styles.statusLabel}>output</span>
                        <span className={styles.statusValue}>
                          {formatAxisLevel("governance", nominalOn(selectedCompData, "governance"))}
                        </span>
                      </div>

                      {/* Pipeline Dependency / Functional Level Analysis - automation only:
                          governance never caps (00-plan.md decision 1). */}
                      {selectedUpstreamStatus.uncertain ? (
                        <div className={styles.uncertainBanner}>
                          <Icon icon="ph:question-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Status uncertain:</strong>{" "}
                            {highlight("an upstream pipeline dependency is still undiscovered")} (
                            {selectedUpstreamStatus.unknownNodes.map((nodeId, i) => (
                              <em key={nodeId}>
                                {i > 0 && ", "}
                                <button
                                  type="button"
                                  className={styles.inlineJumpLink}
                                  onClick={() => jumpToComponent(nodeId)}
                                  {...tagProps("Jump to it", "Still undiscovered - its status is why this one is uncertain")}
                                >
                                  {allComponentsMap.get(nodeId)?.name ?? nodeId}
                                </button>
                              </em>
                            ))}
                            ).
                          </div>
                        </div>
                      ) : selectedCompData.capped_by &&
                        selectedCompData.effective_automation !== undefined &&
                        selectedCompData.nominal_automation !== undefined &&
                        selectedCompData.effective_automation < selectedCompData.nominal_automation ? (
                        <div className={styles.bottleneckBanner}>
                          <Icon icon="ph:link-break-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Held back:</strong> {highlight("this component is capped at")}{" "}
                            <strong>{formatAxisLevel("automation", selectedCompData.effective_automation)}</strong> by{" "}
                            <button
                              type="button"
                              className={styles.inlineJumpLink}
                              onClick={() => jumpToComponent(selectedCompData.capped_by!)}
                              {...tagProps("Jump to it", "The bottleneck holding this component back")}
                            >
                              {highlight(allComponentsMap.get(selectedCompData.capped_by)?.name ?? selectedCompData.capped_by)}
                            </button>
                            .{" "}
                            {highlight(
                              "Automating it further changes nothing until that bottleneck is dealt with. Governance steps are not affected."
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className={styles.satisfiedBanner}>
                          <Icon icon="ph:check-circle-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
                          <div>
                            <strong>Dependencies satisfied:</strong>{" "}
                            {highlight("nothing upstream is holding this back")} - it runs{" "}
                            <strong>
                              {formatAxisLevel(
                                "automation",
                                selectedCompData.effective_automation ?? nominalOn(selectedCompData, "automation")
                              )}
                            </strong>
                            .
                          </div>
                        </div>
                      )}

                      {/* Intel notes filed against this component - what backs the banner above,
                          shown before the picker so the evidence informs the decision. */}
                      {(notesByTarget[selectedCompData.id]?.length ?? 0) > 0 && (
                        <div className={styles.notesSection}>
                          <span className={styles.notesSectionLabel}>
                            <Icon icon="ph:notebook-bold" /> Intel on this component ({intelCountLabel(notesByTarget[selectedCompData.id])})
                          </span>
                          <div className={styles.noteLinkList}>
                            {notesByTarget[selectedCompData.id].map((note) => {
                              const meta = noteSourceMeta(note.item);
                              return (
                                <button
                                  key={note.item.id}
                                  type="button"
                                  className={`${styles.noteLink} ${onSelectIntel ? "" : styles.noteLinkFlat}`}
                                  disabled={!onSelectIntel}
                                  onClick={() => onSelectIntel?.(note.item.id, note.stakeholderId)}
                                  {...tagProps(meta.label, onSelectIntel ? "Click to jump to it in your dossier" : undefined)}
                                >
                                  <Icon icon={meta.icon} className={styles.noteLinkIcon} />
                                  <span className={styles.noteLinkText}>
                                    {note.item.fact || note.item.description}
                                    <em className={styles.noteLinkWho}> - {note.stakeholderName}</em>
                                  </span>
                                  {onSelectIntel && <Icon icon="ph:arrow-bend-up-left-bold" className={styles.noteLinkGo} />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className={styles.formStack}>
                        {AXES.map((axis) => (
                          <OptionLadder
                            key={axis}
                            axis={axis}
                            target={selectedCompData}
                            kind="component"
                            changes={atomicChanges}
                            slotsFull={slotsFull}
                            onAdd={(option) => handleAddOption(selectedCompData, axis, option)}
                            onRemove={(option) => handleRemoveOption(selectedCompData, axis, option)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* ── Empty Inspector State ── */
              <div className={styles.emptyInspector}>
                <Icon icon="ph:cursor-click-bold" className={styles.emptyIcon} />
                <span className={styles.emptyTitle}>Select a component or a connection</span>
                <p className={styles.emptyBody}>
                  Click a component, or the handle on the line between two of them. Each step
                  you add - automation, governance or technology - takes one of your three slots.
                </p>
              </div>
            )}

            {/* ── Proposal Slots (1 to 3) ── */}
            <div className={styles.slotsSection}>
              <div className={styles.slotsSectionHeader}>
                <h4 className={styles.slotsTitle}>
                  <Icon icon="ph:stack-bold" />
                  <span>Proposal</span>
                </h4>
                <span className={styles.slotsCount}>
                  {atomicChanges.length} of {MAX_ATOMIC_CHANGES} slots
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

                  const described = describeAtomicChange(change, isEdge ? edge : comp);

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
                      {...tagProps(displayName, "Click to open it in the inspector")}
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
                          {...tagProps("Remove change", "Frees this slot for a different change")}
                        >
                          <Icon icon="ph:x-bold" />
                          <span>Remove</span>
                        </button>
                      </div>
                      <div className={styles.slotChangeInfo}>
                        <Icon
                          icon={change.axis ? AXIS_ICONS[change.axis] : "ph:flow-arrow-bold"}
                          style={{ color: change.axis === "governance" ? GOVERNANCE_META[3].ink : "var(--primary-bg)", flexShrink: 0 }}
                        />
                        <span>
                          <strong>{described.title}</strong>
                          {described.title !== described.detail && (
                            <span className={styles.slotTrigger}>· {described.detail}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={idx} className={`${styles.slotCard} ${styles.slotCardEmpty}`}>
                    <Icon icon="ph:plus-dashed-bold" />
                    <span>Slot {idx + 1}</span>
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
              ? "Add at least one change before taking this to the stakeholders."
              : `${atomicChanges.length} change${atomicChanges.length > 1 ? "s" : ""} to be argued for.`}
          </span>
        </div>

        <div className={styles.footerRight}>
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
            disabled={atomicChanges.length === 0}
            onClick={handleConfirm}
            {...tagProps(
              "Confirm Proposal",
              "Sends this straight to the stakeholders for their reaction - a weak proposal can upset them. You can still revise it before the final decision."
            )}
          >
            <Icon icon="ph:check-bold" />
            <span>Confirm proposal ({atomicChanges.length})</span>
          </button>
        </div>
      </div>

      {infoTag &&
        createPortal(
          <div
            ref={infoTagRef}
            className={styles.headerHoverTag}
            style={{ top: `${infoTag.top}px`, left: `${infoTag.left}px` }}
            aria-hidden="true"
          >
            <div
              className={`${styles.headerHoverTagFlip} ${
                infoTag.placement === "above" ? styles.headerHoverTagAbove : ""
              }`}
            >
              <div className={styles.headerHoverTagLabel}>{infoTag.label}</div>
              {infoTag.detail && <div className={styles.headerHoverTagDetail}>{infoTag.detail}</div>}
            </div>
          </div>,
          document.body
        )}

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
  );
}
