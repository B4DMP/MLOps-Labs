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

import { useEffect, useState, useContext, useRef, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { EmojiIcon } from "../utils/emojiIcons";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import ActionCardCardComponent from "./ActionCardCardComponent";
import PhaseOverview from "./PhaseOverview";
import GlossaryText from "./glossary/GlossaryText";
import SpokenText from "./SpokenText";
import OnceIcon from "./Results/OnceIcon";
import { useSpeech } from "./useSpeech";
import { startTour } from "../utils/tour";
import { useNarratorGate } from "./useNarratorGate";
import { useSettings } from "./SettingsProvider";
import { splitSentences, TOUR_GUIDE_SEED } from "../utils/speech";
import { MetricsContext } from "./MetricProvider";
import { StakeholderContext, type Stakeholder } from "./StakeholderProvider";
import type { ActionCard } from "../types/ActionCard";
import { useGameWebSocket, useWebSocketEvent } from "../services/websocket/useGameWebSocket";
import CheatSheetModal from "./CheatSheetModal";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import { healthBucket, healthBucketColor, HEALTH_BUCKET_WORD } from "../utils/systemHealth";
import styles from "./ac_simulation.module.css";
import { AXIS_TITLES, formatAxisLevel, type Axis } from "../utils/stageCanvas";
import FIREWORK_ICON from "./Results/icons/firework.json";
import SHOOTING_STARS_ICON from "./Results/icons/shooting-stars.json";
import CONFETTI_ICON from "./Results/icons/confetti.json";
import DISCO_BALL_ICON from "./Results/icons/disco-ball.json";
import WRENCH_ICON from "./Results/icons/wrench.json";
import WARNING_TRIANGLE_ICON from "./Results/icons/warning-triangle.json";
import ALARM_ICON from "./Results/icons/alarm.json";
import BALL_BOWLING_ICON from "./Results/icons/ball-bowling.json";
import NO_ENTRY_ICON from "./Results/icons/no-entry.json";
import STOP_ICON from "./Results/icons/stop.json";
import TRASH_BIN_ICON from "./Results/icons/trash-bin.json";
import ROAD_BARRIER_ICON from "./Results/icons/road-barrier.json";
import TRUCK_ICON from "./Results/icons/truck.json";
import PERSON_PROTESTING_ICON from "./Results/icons/person-protesting.json";

/** One hero Lordicon per rollout outcome, chosen at random each time this debrief is shown (see
 *  `heroIcon` below) - several icons per tone so a run of the same outcome doesn't always look
 *  identical. Kept to the outcome's tone only (celebratory for PASS, caution for SOFT_PASS,
 *  forceful/blocked for VETO_BROKEN and STALEMATE) - never mixed across tones. */
const OUTCOME_HERO_ICONS: Record<string, object[]> = {
  PASS: [FIREWORK_ICON, SHOOTING_STARS_ICON, CONFETTI_ICON, DISCO_BALL_ICON],
  SOFT_PASS: [WRENCH_ICON, WARNING_TRIANGLE_ICON, ALARM_ICON],
  VETO_BROKEN: [BALL_BOWLING_ICON, NO_ENTRY_ICON, STOP_ICON],
  STALEMATE: [TRASH_BIN_ICON, ROAD_BARRIER_ICON, TRUCK_ICON, PERSON_PROTESTING_ICON],
};

/** Pip colour per rung, one set per axis (00-plan.md §2.1) - the two never share a scale. */
const LEVEL_CLASS: Record<Axis, string[]> = {
  automation: [styles.levelBroken, styles.levelAbsent, styles.levelManual, styles.levelAutomated],
  governance: [styles.levelAbsent, styles.levelGovPartial, styles.levelGovPartial, styles.levelGovFull],
};
/** Same notch count as `MetricTab`'s header gauges - the two have to agree, since this card
 *  shows the same six metrics as the header, just before/after instead of only "now". */
const METRIC_SEGMENTS = 10;

/** Breathing room between the shared hover tag and the viewport edge - same value and same
 *  flip-down tag idiom as the dossier's HeaderIconButton/tab hover cards. */
const HOVER_TAG_EDGE_MARGIN = 6;

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

/** One axis of one target: a card touching both axes of a component reports it twice. */
interface TargetDelta {
  id: string;
  axis: Axis;
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
  /** Same Iconify icon the component's own graph node uses, from MlopsGraph.json. */
  icon?: string;
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
  debt_created: Array<{ target_id?: string; owner_id?: string; intended?: number; applied?: number; axis?: Axis }>;
  debt_cleared: Array<{ target_id?: string; owner_id?: string; axis?: Axis }>;
  world_events: Array<{ target: string; axis?: Axis; name?: string; before: number; after: number; reason?: string; icon?: string }>;
  /** Automation only: governance never caps, so it never propagates. */
  propagated: Array<{ target: string; name?: string; effective: LevelPair; via?: string | null; icon?: string }>;
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
  onSettingsToggle?: () => void;
  isSettingsOpen?: boolean;
  /** Opens the Performance Dashboard already focused on this component - a link from a row
   *  in the Component Implementation Log. Rows become clickable when this is given. */
  onOpenComponent?: (componentId: string) => void;
  /** The player's dossier, rendered as a floating window from this screen's own header button -
   *  same data PerformanceDashboard reads to link a component to notes about it. */
  dossierData?: StakeholderDossierEntry[];
  /** A stakeholder page followed from outside (e.g. an owner link in the Performance Dashboard).
   *  Re-jumps the dossier whenever this changes, same idiom as PitchDebate's focusStakeholderId. */
  activeStakeholderId?: string;
  /** Same, for an intel reference followed from the Performance Dashboard. */
  focusIntelId?: string;
  onDossierToggle?: () => void;
  isDossierOpen?: boolean;
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

function formatLevel(axis: Axis, level: number): string {
  return formatAxisLevel(axis, level);
}

/** "req.acceptance_criteria" -> "acceptance criteria". Same idiom used for component ids elsewhere. */
function formatComponentId(id: string): string {
  return id.split(".").pop()?.replace(/_/g, " ") || id;
}

/** Falls back to the raw id only when the stakeholder isn't in the roster (shouldn't normally happen). */
function stakeholderName(id: string, stakeholders: Record<string, Stakeholder>): string {
  return stakeholders[id]?.name || prettifyLabel(id);
}

/** Same priority order the Component Implementation Log's per-row callout uses below: a row
 *  that is both degraded and capped reads as degraded first, since owner pushback is the more
 *  serious story. Shared with the Round Highlights summary so the two never disagree about a
 *  given component's status. */
function classifyTarget(target: TargetDelta): "flawless" | "degraded" | "capped" | "delayed" {
  if (target.status === "degraded" || target.degraded_by) return "degraded";
  if (target.status === "capped" || (target.capped_by && target.nominal.after !== target.effective.after)) {
    return "capped";
  }
  if (target.status === "delayed") return "delayed";
  return "flawless";
}

/** Joins up to `max` names, folding the rest into a "+N more" tail - keeps a Highlights bullet
 *  readable when a rollout touches a dozen components instead of two or three. */
function joinNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

/** A graph target (component or edge) mentioned in prose - e.g. "X moved from broken to
 *  manual" in the Ripple Effects list. Carries the same icon as its row in the Component
 *  Implementation Log (rather than a raw id-derived label), and is the same jump-to-
 *  Performance-Dashboard link; falls back to plain bold text when no handler is wired. */
function TargetLink({
  targetId,
  name,
  icon,
  onOpenComponent,
}: {
  targetId: string;
  name: string;
  icon?: string;
  onOpenComponent?: (componentId: string) => void;
}) {
  const content = (
    <>
      {icon && <Icon icon={icon} className={styles.targetLinkIcon} aria-hidden="true" />}
      <span>{name}</span>
    </>
  );
  if (!onOpenComponent) {
    return <strong className={styles.targetLinkStatic}>{content}</strong>;
  }
  return (
    <button type="button" className={styles.targetLink} onClick={() => onOpenComponent(targetId)}>
      {content}
    </button>
  );
}

export default function AcSimulation({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  playedCard,
  onPerformanceToggle,
  isPerformanceOpen = false,
  onSettingsToggle,
  isSettingsOpen = false,
  onOpenComponent,
  dossierData,
  activeStakeholderId,
  focusIntelId,
  onDossierToggle,
  isDossierOpen = false,
}: AcSimulationProps) {
  const { emit, subscribe } = useGameWebSocket();
  const { metrics } = useContext(MetricsContext);
  const { stakeholders } = useContext(StakeholderContext);
  const { speak: speakTts } = useSpeech();
  const gate = useNarratorGate();
  const { settings } = useSettings();

  const [payload, setPayload] = useState<DeltaReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);

  // The dossier's own selected page/highlighted note - seeded from outside (a link followed from
  // the Performance Dashboard) but otherwise navigated freely within the dossier itself, same
  // "jump only on change" idiom as PitchDebate's selectedStakeholderId/highlightedIntelId.
  const [dossierStakeholderId, setDossierStakeholderId] = useState<string>("");
  const [highlightedIntelId, setHighlightedIntelId] = useState<string | null>(null);

  const prevActiveStakeholderRef = useRef<string | undefined>(activeStakeholderId);
  useEffect(() => {
    if (activeStakeholderId && activeStakeholderId !== prevActiveStakeholderRef.current) {
      setDossierStakeholderId(activeStakeholderId);
    }
    prevActiveStakeholderRef.current = activeStakeholderId;
  }, [activeStakeholderId]);

  const prevFocusIntelRef = useRef<string | undefined>(focusIntelId);
  useEffect(() => {
    if (focusIntelId && focusIntelId !== prevFocusIntelRef.current) {
      setHighlightedIntelId(focusIntelId);
      setTimeout(() => setHighlightedIntelId(null), 3000);
    }
    prevFocusIntelRef.current = focusIntelId;
  }, [focusIntelId]);

  useWebSocketEvent<DeltaReportPayload>("graph:delta_report", (data) => setPayload(data));

  // Badges the Performance button with the project graph's overall health, same as the
  // dossier header's Performance button.
  const [systemHealth, setSystemHealth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!onPerformanceToggle) return;
    emit("graph:state_request", { phase_id: currentPhase });
    const unsub = subscribe("graph:state", (data: { system_health?: number }) => {
      setSystemHealth(data?.system_health);
    });
    return unsub;
  }, [onPerformanceToggle, currentPhase, emit, subscribe]);
  const systemHealthBucket = healthBucket(systemHealth);

  // Shared flip-down hover/focus tag, same mechanism as the dossier's header buttons and tabs:
  // one portal instance rather than a native `title` (or one hook per anchor) on every button,
  // pill and chip that wants a hover explanation.
  const [infoTag, setInfoTag] = useState<{
    label: string;
    detail?: string;
    top: number;
    anchorX: number;
    left: number;
  } | null>(null);
  const infoTagRef = useRef<HTMLDivElement>(null);

  const showInfoTag = (e: React.SyntheticEvent, label: string, detail?: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    setInfoTag({ label, detail, top: rect.bottom + HOVER_TAG_EDGE_MARGIN, anchorX, left: anchorX });
  };
  const hideInfoTag = () => setInfoTag(null);

  const infoTagProps = (label: string, detail?: string) => ({
    onMouseEnter: (e: React.MouseEvent) => showInfoTag(e, label, detail),
    onMouseLeave: hideInfoTag,
    onFocus: (e: React.FocusEvent) => showInfoTag(e, label, detail),
    onBlur: hideInfoTag,
  });

  // Keep the tag inside the viewport horizontally, recomputed from the fixed anchorX so a
  // detail line changing the tag's width never drifts it off its anchor.
  useLayoutEffect(() => {
    if (!infoTag || !infoTagRef.current) return;
    const box = infoTagRef.current.getBoundingClientRect();
    const half = box.width / 2;
    const left = Math.min(
      Math.max(infoTag.anchorX, HOVER_TAG_EDGE_MARGIN + half),
      window.innerWidth - HOVER_TAG_EDGE_MARGIN - half
    );
    setInfoTag((prev) => (prev && prev.left !== left ? { ...prev, left } : prev));
  }, [infoTag?.anchorX, infoTag?.label, infoTag?.detail]);

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

  // Random pick from this outcome's icon pool, re-rolled each time a fresh delta report arrives
  // (a new `payload` reference - i.e. each visit to this debrief) rather than on every render.
  const heroIcon = useMemo(() => {
    const pool = report ? OUTCOME_HERO_ICONS[report.outcome] || OUTCOME_HERO_ICONS.PASS : null;
    if (!pool) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [payload]);

  // Narrates the executive headline + description the moment the debrief report arrives - same
  // "read it in one pass" idiom as PrePhaseDialog's briefing narration, with the headline and
  // description joined into one pass and split back out below (see headlineSentenceCount) so the
  // headline gets its own caret and the description gets full SpokenText treatment.
  const [isNarratingDirective, setIsNarratingDirective] = useState(false);
  const [directiveNarrationDone, setDirectiveNarrationDone] = useState(false);
  // Same introTourPending idiom as PrePhaseDialog: true only while phase 0's introSimulate tour
  // still has to run and hasn't finished yet, so the directive narration effect below can wait
  // for it - on every other phase this is false from the start, so narration there is never
  // held up by a tour that was never going to happen.
  const [introSimulateTourDone, setIntroSimulateTourDone] = useState(false);
  const introSimulatePending = currentPhase === 0 && !introSimulateTourDone;
  // Nudge towards "Proceed" once the debrief has loaded and its own auto-narration is done
  // talking over it - same gating idiom as PrePhaseDialog's shouldNudgeStart.
  const shouldNudgeProceed = Boolean(payload?.report) && !loading && directiveNarrationDone;
  const [directiveSentenceIndex, setDirectiveSentenceIndex] = useState<number | null>(null);
  const directiveCancelRef = useRef<() => void>(() => {});
  const directiveBannerRef = useRef<HTMLDivElement>(null);
  const headlineSentenceCount = splitSentences(outcomeInfo.headline)
    .map((s) => s.trim())
    .filter(Boolean).length;
  const isHeadlineActive =
    directiveSentenceIndex != null && directiveSentenceIndex >= 0 && directiveSentenceIndex < headlineSentenceCount;
  const descriptionActiveSentenceIndex =
    directiveSentenceIndex != null ? directiveSentenceIndex - headlineSentenceCount : null;

  const playDirectiveNarration = () => {
    directiveCancelRef.current();
    setIsNarratingDirective(true);
    setDirectiveSentenceIndex(null);
    // The introSimulate tour (when it runs first) can leave the page scrolled down at whichever
    // card its last step highlighted - bring the banner this narration is about to read back
    // into view instead of leaving the player reading nothing while it plays off-screen.
    directiveBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    directiveCancelRef.current = speakTts(`${outcomeInfo.headline}. ${outcomeInfo.description}`, {
      slot: "narrator",
      onSentence: ({ index }) => setDirectiveSentenceIndex(index),
      onEnd: () => {
        setIsNarratingDirective(false);
        setDirectiveSentenceIndex(null);
        setDirectiveNarrationDone(true);
      },
    });
  };

  const stopDirectiveNarration = () => {
    directiveCancelRef.current();
    setIsNarratingDirective(false);
    setDirectiveSentenceIndex(null);
    // A manual stop is still "done" as far as the tour is concerned - the player has moved on
    // from listening, so there's nothing left to race against.
    setDirectiveNarrationDone(true);
  };

  useEffect(() => {
    if (!report || introSimulatePending) return;
    setDirectiveNarrationDone(false);
    playDirectiveNarration();
    return () => {
      directiveCancelRef.current();
      setIsNarratingDirective(false);
      setDirectiveSentenceIndex(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, introSimulatePending]);

  // The introSimulate tour walks the debrief's chrome *before* any of it is narrated - it runs
  // first (as soon as the report arrives, not after the headline narration), then unblocks the
  // directive narration effect above via introSimulateTourDone. Both go through the same speech
  // arbiter, so running them at once would just have one cut the other off mid-sentence. Phases
  // other than 0 never set introSimulatePending in the first place, so narration there starts
  // immediately and is never held up waiting on a tour that was never going to run.
  const introSimulateTourStartedRef = useRef(false);
  useEffect(() => {
    if (!report) return;
    // Phase 0 has exactly one challenge, so checking the phase alone is sufficient -
    // `currentChallenge` is the challenge's *global* id (e.g. 113), not a phase-relative index.
    if (currentPhase !== 0) return;
    if (introSimulateTourStartedRef.current) return;
    introSimulateTourStartedRef.current = true;
    startTour("introSimulate", {
      beforeStart: () => gate.request(),
      narrate: (text) => speakTts(text, { slot: "narrator", seed: TOUR_GUIDE_SEED }),
      onFinish: () => setIntroSimulateTourDone(true),
    });
  }, [report, currentPhase]);

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

  // A synthesized "what mattered" scorecard, read right after the headline and before the
  // full per-component/per-stakeholder log below - the player gets the gist in one glance,
  // then can drill into the detailed sections for the why. Every line here points at data a
  // section further down already shows in full; this never introduces a new fact.
  const highlights = useMemo(() => {
    const wins: { icon: string; text: string }[] = [];
    const concerns: { icon: string; text: string; hint?: string }[] = [];
    if (!report) return { wins, concerns };

    const byStatus: Record<string, TargetDelta[]> = { flawless: [], degraded: [], capped: [], delayed: [] };
    for (const t of report.targets) byStatus[classifyTarget(t)].push(t);
    const targetNames = (arr: TargetDelta[]) => arr.map((t) => t.name || formatComponentId(t.id));

    if (byStatus.flawless.length > 0) {
      wins.push({ icon: "ph:check-circle-bold", text: `Flawless delivery: ${joinNames(targetNames(byStatus.flawless))}` });
    }
    if (byStatus.degraded.length > 0) {
      concerns.push({
        icon: "ph:hand-palm-bold",
        text: `Degraded by owner pushback: ${joinNames(targetNames(byStatus.degraded))}`,
        hint: "Bring the owner into the pitch next time. A proposal they help shape won't get quietly undercut in execution.",
      });
    }
    if (byStatus.capped.length > 0) {
      concerns.push({
        icon: "ph:lock-key-bold",
        text: `Capped by an upstream bottleneck: ${joinNames(targetNames(byStatus.capped))}`,
        hint: "This component can't outrun what feeds it. Raise the upstream dependency's own maturity first, or the cap just reappears next round.",
      });
    }
    if (byStatus.delayed.length > 0) {
      concerns.push({
        icon: "ph:clock-countdown-bold",
        text: `Delayed, shortcut left behind: ${joinNames(targetNames(byStatus.delayed))}`,
        hint: "A rushed handoff now is technical debt later. Budget the time this actually needs, or plan to come back and pay it down.",
      });
    }

    const improvedNames = changedMetrics.filter((m) => m.afterFilled > m.beforeFilled).map((m) => m.mObj.name || m.mId);
    const declinedNames = changedMetrics.filter((m) => m.afterFilled < m.beforeFilled).map((m) => m.mObj.name || m.mId);
    if (improvedNames.length > 0) wins.push({ icon: "ph:trend-up-bold", text: `Metrics up: ${joinNames(improvedNames)}` });
    if (declinedNames.length > 0) {
      concerns.push({
        icon: "ph:trend-down-bold",
        text: `Metrics down: ${joinNames(declinedNames)}`,
        hint: "Weigh what this rollout traded away against what it bought. A card that helps everywhere else isn't free if it quietly erodes this.",
      });
    }

    if (report.patterns.gained.length > 0) {
      wins.push({ icon: "ph:sparkle-bold", text: `New pattern adopted: ${joinNames(report.patterns.gained)}` });
    }
    if (report.patterns.anti_resolved.length > 0) {
      wins.push({ icon: "ph:wrench-bold", text: `Antipattern cleared: ${joinNames(report.patterns.anti_resolved)}` });
    }
    if (report.debt_cleared.length > 0) {
      wins.push({ icon: "ph:check-circle-bold", text: `${report.debt_cleared.length} technical shortcut(s) cleaned up` });
    }

    if (report.patterns.anti_created.length > 0) {
      concerns.push({
        icon: "ph:bug-beetle-bold",
        text: `New antipattern: ${joinNames(report.patterns.anti_created)}`,
        hint: "Antipatterns compound the longer they sit. Look for a card that directly targets this before building more on top of it.",
      });
    }
    if (report.patterns.lost.length > 0) {
      concerns.push({
        icon: "ph:warning-bold",
        text: `Pattern lost: ${joinNames(report.patterns.lost)}`,
        hint: "Whatever kept this pattern in place got traded away this round. Re-establish the governance or practice behind it before it's missed.",
      });
    }
    if (report.debt_created.length > 0) {
      concerns.push({
        icon: "ph:warning-octagon-bold",
        text: `${report.debt_created.length} technical shortcut(s) left behind`,
        hint: "Debt left unpaid tends to resurface as a cap or a delay somewhere downstream. Prioritize clearing it before it's forced on you.",
      });
    }

    const byStakeholderStatus = (status: string) =>
      (report.stakeholders || [])
        .filter((s) => s.status === status)
        .map((s) => s.name || stakeholderName(s.stakeholder_id, stakeholders));
    const committed = byStakeholderStatus("committed");
    const resistant = byStakeholderStatus("resistant");
    const overridden = byStakeholderStatus("overridden");
    if (committed.length > 0) wins.push({ icon: "ph:handshake-bold", text: `Fully on board: ${joinNames(committed)}` });
    if (resistant.length > 0) {
      concerns.push({
        icon: "ph:warning-circle-bold",
        text: `Pushed back: ${joinNames(resistant)}`,
        hint: "Resistance you don't address doesn't go away. Address their concern directly next pitch, or expect the same friction again.",
      });
    }
    if (overridden.length > 0) {
      concerns.push({
        icon: "ph:lightning-bold",
        text: `Overruled via escalation: ${joinNames(overridden)}`,
        hint: "Escalation gets the card through, but it spends this stakeholder's goodwill. Save it for proposals you can't afford to lose.",
      });
    }

    if (report.grudges.created.length > 0) {
      const grudgeNames = report.grudges.created.map((g) => stakeholderName(g.stakeholder_id, stakeholders));
      concerns.push({
        icon: "ph:bookmark-simple-bold",
        text: `New grudge(s) recorded: ${joinNames(grudgeNames)}`,
        hint: "A grudge makes this stakeholder warier of your next proposal. A clean, low-friction win with them is the fastest way to earn it back.",
      });
    }

    return { wins, concerns };
  }, [report, changedMetrics, stakeholders]);

  return (
    <div className={styles.pageWrapper}>
      {/* ── Top Header Strip ── */}
      <div className={styles.header}>
        <div
          className={styles.headerTitleBlock}
          data-intro-group="introSimulate"
          data-title="Rollout Debrief"
          data-intro="Welcome to the Rollout Debrief. Every round ends here: a full report on what your pitch actually did, the engineering outcome and the human cost both, read top to bottom before you move on."
          data-step="1"
        >
          <h1 className={styles.headerTitle}>
            <Icon icon="ph:rocket-launch-bold" className={styles.headerIcon} />
            <span>Rollout Debrief</span>
          </h1>
          <p className={styles.headerSubtitle}>Engineering Execution Log</p>
        </div>
        <div className={styles.headerPhases}>
          <PhaseOverview />
        </div>
        <div className={styles.headerIconGroup}>
          {onDossierToggle && (
            <button
              type="button"
              className={`${styles.headerIconBtn} ${isDossierOpen ? styles.headerIconBtnActive : ""}`}
              onClick={onDossierToggle}
              aria-label={isDossierOpen ? "Stakeholder dossier: close" : "Stakeholder dossier: open"}
              {...infoTagProps(isDossierOpen ? "Close stakeholder dossier" : "Open stakeholder dossier")}
            >
              <Icon icon="ph:address-book-tabs-bold" />
            </button>
          )}
          {onPerformanceToggle && (
            <button
              type="button"
              className={`${styles.headerIconBtn} ${isPerformanceOpen ? styles.headerIconBtnActive : ""}`}
              onClick={onPerformanceToggle}
              aria-label={isPerformanceOpen ? "Performance: close" : "Performance: open"}
              {...infoTagProps(
                isPerformanceOpen ? "Close performance dashboard" : "Open performance dashboard",
                systemHealth !== undefined ? `System health: ${HEALTH_BUCKET_WORD[systemHealthBucket]}` : undefined
              )}
            >
              <Icon icon="ph:gauge-bold" />
              {systemHealth !== undefined && (
                <span
                  className={styles.headerIconBadgeDot}
                  style={{ background: healthBucketColor(systemHealthBucket) }}
                />
              )}
            </button>
          )}
          {onSettingsToggle && (
            <button
              type="button"
              className={`${styles.headerIconBtn} ${isSettingsOpen ? styles.headerIconBtnActive : ""}`}
              onClick={onSettingsToggle}
              aria-label={isSettingsOpen ? "Settings: close" : "Settings: open"}
              {...infoTagProps(isSettingsOpen ? "Close settings" : "Open settings")}
            >
              <Icon icon="ph:gear-six-bold" />
            </button>
          )}
          <button
            type="button"
            className={`${styles.headerIconBtn} ${isCheatSheetOpen ? styles.headerIconBtnActive : ""}`}
            onClick={() => setIsCheatSheetOpen(true)}
            aria-label="Cheat Sheet"
            {...infoTagProps("Cheat Sheet", "Quick reference for every phase")}
          >
            <Icon icon="ph:question-bold" />
          </button>
        </div>
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
            <div
              ref={directiveBannerRef}
              className={`${styles.directiveBanner} ${isNarratingDirective ? styles.directiveBannerSpeaking : ""}`}
            >
              <div
                className={styles.directiveBannerRow}
                data-intro-group="introSimulate"
                data-title="Rollout Outcome"
                data-intro="This is the rollout outcome: how your pitched proposal actually landed, in one headline. Below it, a full breakdown of what happened and why - read it closely, it's the closest thing to feedback the simulation ever gives you."
                data-step="2"
              >
                {heroIcon && <OnceIcon icon={heroIcon} className={styles.directiveHeroIcon} />}
                <div className={styles.directiveBannerContent}>
                  <div className={styles.directiveBannerHeader}>
                    <div className={styles.directiveTitleArea}>
                      <span>
                        {outcomeInfo.headline}
                        {isHeadlineActive && <span className={styles.directiveTitleCaret} aria-hidden="true" />}
                      </span>
                    </div>
                    <div className={styles.directiveNarrationControls}>
                      {isNarratingDirective ? (
                        directiveSentenceIndex === null ? (
                          // Same slot the Stop button takes once audio actually starts - swapping
                          // in place instead of adding a sibling element keeps the badge to its
                          // right from jumping sideways when playback catches up.
                          <Icon
                            icon="ph:circle-notch-bold"
                            className={styles.directiveNarrationLoading}
                            aria-hidden="true"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              stopDirectiveNarration();
                              hideInfoTag();
                            }}
                            className={`${styles.directiveNarrationButton} ${styles.directiveNarrationButtonPulsing}`}
                            {...infoTagProps("Stop", "Stop reading this debrief aloud")}
                            aria-label="Stop reading this debrief aloud"
                          >
                            <Icon icon="ph:stop-circle-bold" />
                          </button>
                        )
                      ) : (
                        !settings.mute_tts && (
                          <button
                            type="button"
                            onClick={playDirectiveNarration}
                            className={styles.directiveNarrationButton}
                            {...infoTagProps("Listen Again", "Read this debrief aloud")}
                            aria-label="Listen to this debrief again"
                          >
                            <Icon icon="ph:arrow-clockwise-bold" />
                          </button>
                        )
                      )}
                    </div>
                    <span className={`${styles.outcomeBadge} ${outcomeInfo.badgeClass}`}>
                      <Icon icon={outcomeInfo.icon} />
                      {outcomeInfo.label}
                    </span>
                  </div>
                  <p className={styles.directiveText}>
                    <SpokenText
                      text={outcomeInfo.description}
                      activeSentenceIndex={descriptionActiveSentenceIndex}
                      renderSentence={(sentence) => <GlossaryText text={sentence} surface="intel_notes" />}
                    />
                  </p>
                </div>
              </div>
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

            {/* Round Highlights: the good/bad scorecard, read before the detailed log below */}
            {(highlights.wins.length > 0 || highlights.concerns.length > 0) && (
              <div
                className={styles.surfaceCard}
                data-intro-group="introSimulate"
                data-title="Round Highlights"
                data-intro="A quick good/bad scorecard for this round, distilled from everything below. Read this first, then drill into the sections underneath for the why."
                data-step="3"
              >
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>
                    <Icon icon="ph:list-magnifying-glass-bold" />
                    <span>Round Highlights</span>
                  </h3>
                  <span className="text-muted small">What went well vs. what went wrong</span>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.highlightsGrid}>
                    <div className={styles.highlightsCol}>
                      <span className={`${styles.highlightsColLabel} ${styles.highlightsColLabelGood}`}>
                        <Icon icon="ph:thumbs-up-bold" /> What went well
                      </span>
                      {highlights.wins.length === 0 ? (
                        <div className={styles.highlightsEmpty}>Nothing stood out as a clear win this round.</div>
                      ) : (
                        <ul className={styles.highlightsList}>
                          {highlights.wins.map((w, i) => (
                            <li key={i} className={styles.highlightsItemGood}>
                              <Icon icon={w.icon} />
                              <span>{w.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className={styles.highlightsCol}>
                      <span className={`${styles.highlightsColLabel} ${styles.highlightsColLabelBad}`}>
                        <Icon icon="ph:thumbs-down-bold" /> What went wrong
                      </span>
                      {highlights.concerns.length === 0 ? (
                        <div className={styles.highlightsEmpty}>No real concerns flagged this round.</div>
                      ) : (
                        <ul className={styles.highlightsList}>
                          {highlights.concerns.map((c, i) => (
                            <li key={i} className={styles.highlightsItemBad}>
                              <Icon icon={c.icon} />
                              <span className={styles.highlightsItemTextCol}>
                                <span>{c.text}</span>
                                {c.hint && (
                                  <span className={styles.highlightsHint}>
                                    <Icon icon="ph:lightbulb-bold" />
                                    <span>{c.hint}</span>
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Main Layout: narrative (what happened) reads before the abstract summary */}
            <div className={styles.mainGrid}>
              {/* Main Column: Component Implementation Log & Human Sentiments */}
              <div className={styles.mainCol}>
                {/* ── Component Implementation Log (Core Focus) ── */}
                <div
                  className={styles.surfaceCard}
                  data-intro-group="introSimulate"
                  data-title="What Actually Happened"
                  data-intro="A row per component your proposal touched: flawless, capped by an upstream bottleneck, degraded by stakeholder pushback, or delayed. This is where you learn what your pitch actually implemented."
                  data-step="4"
                >
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>
                      <Icon icon="ph:list-checks-bold" />
                      <span>Component Implementation Log</span>
                    </h3>
                    <span className="text-muted small">
                      {new Set(report.targets.map((t) => t.id)).size} Target
                      {new Set(report.targets.map((t) => t.id)).size === 1 ? "" : "s"} Changed
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
                          const ownerName = target.owner_name || (ownerId ? stakeholderName(ownerId, stakeholders) : "System Lead");

                          const targetStatus = classifyTarget(target);
                          const isDegraded = targetStatus === "degraded";
                          const isCapped = targetStatus === "capped";
                          const isDelayed = targetStatus === "delayed";
                          const isFlawless = targetStatus === "flawless";

                          let statusCalloutClass = styles.statusFlawless;
                          let statusIcon = "ph:check-circle-bold";
                          let statusTitle = "Flawless Implementation";
                          let statusDescription =
                            "Successfully delivered at target maturity with full stakeholder support and zero friction.";

                          if (isDegraded) {
                            statusCalloutClass = styles.statusDegraded;
                            statusIcon = "ph:hand-palm-bold";
                            const degradedByName = target.degraded_by
                              ? stakeholderName(target.degraded_by, stakeholders)
                              : ownerName;
                            statusTitle = `Degraded Rollout • Owner Pushback (${degradedByName})`;
                            statusDescription =
                              "The responsible stakeholder resisted execution, taking shortcuts or reducing effective operational quality.";
                          } else if (isCapped) {
                            statusCalloutClass = styles.statusCapped;
                            statusIcon = "ph:lock-key-bold";
                            const cappedByName = target.capped_by
                              ? formatComponentId(target.capped_by.id)
                              : "predecessor";
                            statusTitle = `Upstream Bottleneck Constraint (Capped by ${cappedByName})`;
                            statusDescription = `Component reached nominal ${formatLevel(
                              target.axis,
                              target.nominal.after
                            )}, but operates throttled at ${formatLevel(
                              target.axis,
                              target.effective.after
                            )} because upstream dependencies lag behind.`;
                          } else if (isDelayed) {
                            statusCalloutClass = styles.statusDelayed;
                            statusIcon = "ph:clock-countdown-bold";
                            statusTitle = "Partial Delivery / Technical Shortcut Left Behind";
                            statusDescription =
                              "Component landed, but missing metadata, partial scripts, or handoff delays created technical debt.";
                          }

                          // Same left-accent-by-status idiom as ActionCardCardComponent's change
                          // rows - a colour read at a glance, without opening the detail below.
                          const statusAccentColor = isDegraded
                            ? "#ea580c"
                            : isCapped
                            ? "#ca8a04"
                            : isDelayed
                            ? "#dc2626"
                            : "#16a34a";

                          const openThisComponent = onOpenComponent
                            ? () => onOpenComponent(target.id)
                            : undefined;

                          return (
                            <div
                              key={`${target.id}-${target.axis}`}
                              className={`${styles.rolloutItem} ${openThisComponent ? styles.rolloutItemClickable : ""}`}
                              style={{ ["--row-accent" as string]: statusAccentColor }}
                              onClick={openThisComponent}
                              role={openThisComponent ? "button" : undefined}
                              tabIndex={openThisComponent ? 0 : undefined}
                              onKeyDown={
                                openThisComponent
                                  ? (e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        openThisComponent();
                                      }
                                    }
                                  : undefined
                              }
                            >
                              {/* Header: component, phase and owner all on one line, level transition on the other side */}
                              <div className={styles.rolloutItemHeader}>
                                <div className={styles.componentMeta}>
                                  {/* Same icon the component's own graph node uses, as in PerformanceDashboard */}
                                  <Icon icon={target.icon || "ph:cube-bold"} className={styles.componentIcon} />
                                  <span className={styles.componentNameWrap}>
                                    <span className={styles.componentName}>
                                      {target.name || formatComponentId(target.id)}
                                    </span>
                                    {openThisComponent && (
                                      <Icon icon="ph:arrow-square-out-bold" className={styles.rolloutOpenIcon} aria-hidden="true" />
                                    )}
                                  </span>
                                  <span className={styles.stageTag}>{target.stage}</span>
                                  <span
                                    className={`${styles.stageTag} ${target.axis === "governance" ? styles.axisTagGovernance : ""}`}
                                  >
                                    {AXIS_TITLES[target.axis] ?? target.axis}
                                  </span>
                                  <span className={styles.ownerName}>
                                    <StakeholderAvatarComponent
                                      avatar={stCtx.avatar}
                                      stakeholderId={ownerId}
                                      stakeholderColor={stCtx.stakeholder_color}
                                      isFramed={false}
                                      size={16}
                                      hoverToSuspicious={false}
                                    />
                                    {ownerName}
                                  </span>
                                </div>

                                <div className={styles.levelTransition}>
                                  <span className={`${styles.levelPip} ${LEVEL_CLASS[target.axis]?.[target.nominal.before] || ""}`}>
                                    {formatLevel(target.axis, target.nominal.before)}
                                  </span>
                                  <Icon icon="ph:arrow-right-bold" className="text-muted" />
                                  <span className={`${styles.levelPip} ${LEVEL_CLASS[target.axis]?.[target.nominal.after] || ""}`}>
                                    {formatLevel(target.axis, target.nominal.after)}
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
                <div
                  className={styles.surfaceCard}
                  data-intro-group="introSimulate"
                  data-title="Stakeholder Realities"
                  data-intro="How the people in the room reacted: who stayed on board, who pushed back, who got overruled, and the emotional cost each paid in stress, trust, and grudges. Good execution on paper doesn't always mean a happy room."
                  data-step="5"
                >
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
                          const stName = st.name || stakeholderName(st.stakeholder_id, stakeholders);

                          const statusBadgeClass =
                            st.status === "committed"
                              ? styles.outcomePass
                              : st.status === "resistant"
                              ? styles.outcomeSoftPass
                              : styles.outcomeVetoBroken;

                          const statusLabel =
                            st.status === "committed" ? (
                              <><EmojiIcon name="dotGreen" /> Committed</>
                            ) : st.status === "resistant" ? (
                              <><EmojiIcon name="dotYellow" /> Resistant (Friction)</>
                            ) : (
                              <><EmojiIcon name="dotRed" /> Overruled (Escalation)</>
                            );

                          return (
                            <div key={st.stakeholder_id} className={styles.stakeholderCard}>
                              <div className="d-flex align-items-center gap-2">
                                <div style={{ width: 36, height: 36, flexShrink: 0 }}>
                                  <StakeholderAvatarComponent
                                    avatar={stCtx.avatar}
                                    stakeholderId={st.stakeholder_id}
                                    stakeholderColor={stCtx.stakeholder_color}
                                    isFramed={false}
                                    size="100%"
                                  />
                                </div>
                                <div className="d-flex flex-column min-width-0 flex-grow-1">
                                  <strong className="text-truncate" style={{ fontSize: "0.82rem" }}>
                                    {stName}
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
                                          tabIndex={0}
                                          className={`${styles.emotionPill} ${
                                            good ? styles.emotionPositive : styles.emotionNegative
                                          }`}
                                          {...infoTagProps(
                                            prettifyLabel(dim),
                                            `${risingRaw ? "Went up" : "Went down"} this rollout`
                                          )}
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
                                tabIndex={0}
                                className={`${styles.grudgeChip} ${isHighPower ? styles.grudgeChipSevere : styles.grudgeChipMinor}`}
                                {...infoTagProps(
                                  stakeholderName(g.stakeholder_id, stakeholders),
                                  "Will remember this compromise and bring heightened skepticism into future debates."
                                )}
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
                            .map(
                              (g) =>
                                `${stakeholderName(g.stakeholder_id, stakeholders)} (${
                                  g.detail || prettifyLabel(g.effect)
                                })`
                            )
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
                                <TargetLink
                                  targetId={e.target}
                                  name={e.name || formatComponentId(e.target)}
                                  icon={e.icon}
                                  onOpenComponent={onOpenComponent}
                                />
                                {e.axis === "governance" ? " governance" : ""} moved from{" "}
                                {formatLevel(e.axis ?? "automation", e.before)} to {formatLevel(e.axis ?? "automation", e.after)}
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
                                <TargetLink
                                  targetId={p.target}
                                  name={p.name || formatComponentId(p.target)}
                                  icon={p.icon}
                                  onOpenComponent={onOpenComponent}
                                />{" "}
                                adapted from {formatLevel("automation", p.effective.before)} to{" "}
                                {formatLevel("automation", p.effective.after)}
                                {p.via && (
                                  <>
                                    {" (via "}
                                    <TargetLink
                                      targetId={p.via}
                                      name={formatComponentId(p.via)}
                                      onOpenComponent={onOpenComponent}
                                    />
                                    {")"}
                                  </>
                                )}
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
            className={`${styles.actionButton} ${shouldNudgeProceed ? styles.actionButtonNudge : ""}`}
          >
            <span>{loading ? "Advancing..." : "Proceed to Next Milestone"}</span>
            <Icon icon="ph:arrow-right-bold" className={styles.actionButtonArrow} />
          </button>
        </div>
      </div>
      <CheatSheetModal
        isOpen={isCheatSheetOpen}
        onClose={() => setIsCheatSheetOpen(false)}
        activeSectionTitle="Simulate"
      />

      {onDossierToggle && (
        <StakeholderDossier
          isOpen={isDossierOpen}
          onClose={onDossierToggle}
          dossierData={dossierData ?? []}
          activeStakeholderId={dossierStakeholderId}
          onActiveStakeholderChange={(id) => setDossierStakeholderId(id ?? "")}
          highlightedIntelId={highlightedIntelId}
          currentPhase={currentPhase}
          currentChallenge={currentChallenge}
          onPerformanceToggle={onPerformanceToggle}
          isPerformanceOpen={isPerformanceOpen}
          onSettingsToggle={onSettingsToggle}
          isSettingsOpen={isSettingsOpen}
          cheatSheetActiveSection="Simulate"
        />
      )}

      {/* Shared flip-down hover/focus tag for every button, pill and chip on this page that
          used to carry a native `title` - see the note on the infoTag state above. */}
      {infoTag &&
        createPortal(
          <div
            ref={infoTagRef}
            className={styles.headerHoverTag}
            style={{ top: `${infoTag.top}px`, left: `${infoTag.left}px` }}
            aria-hidden="true"
          >
            <div className={styles.headerHoverTagFlip}>
              <div className={styles.headerHoverTagLabel}>{infoTag.label}</div>
              {infoTag.detail && <div className={styles.headerHoverTagDetail}>{infoTag.detail}</div>}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
