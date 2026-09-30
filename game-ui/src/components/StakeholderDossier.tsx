import React, { useState, useRef, useEffect, useLayoutEffect, useContext } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { EmojiIcon } from "../utils/emojiIcons";
import styles from "./StakeholderDossier.module.css";
import { StakeholderContext, type EmotionGatingInfo, type EmotionGatingDimension } from "./StakeholderProvider";

import { MetricsContext } from "./MetricProvider";
import { PhasesContext, isFirstPlayablePhase, type PhaseData } from "./PhaseProvider";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import GlossaryText from "./glossary/GlossaryText";
import { CHALLENGE_INTEL_META, INTEL_TAGS, intelTagMeta } from "../types/IntelTag";
import { faceForEmotionState, iconForEmotionState } from "../utils/emotionFace";
import { healthBucket, healthBucketColor, HEALTH_BUCKET_WORD } from "../utils/systemHealth";
import CheatSheetModal from "./CheatSheetModal";
import HoverTooltip from "./HoverToolTip";

/** Answer key for one authored item. Only sent when the API runs with ENABLE_DOSSIER_DEBUG. */
export interface IntelDebugInfo {
  id: string;
  correct_tag: string;
  description: string;
  target?: string | null;
  level?: number | null;
  stakeholder_id?: string | null;
  refines_id?: string | null;
  artifact?: {
    id: string;
    artifact_type: string;
    speaker_id?: string | null;
    is_known: boolean;
    content: string;
    /** Which comedic device content_gen's humor stage rewrote this artifact with, if any. */
    humor_archetype?: string | null;
    /** The humor stage's own adversarial reviewer's verdict: "strong"/"weak"/"reject". */
    humor_verdict?: string | null;
    /** That reviewer's reasoning for the verdict above. */
    humor_review_reason?: string | null;
  } | null;
}

/** Answer key for a dossier page. Only sent when the API runs with ENABLE_DOSSIER_DEBUG. */
export interface StakeholderDebugInfo {
  missing_intel: IntelDebugInfo[];
}

export interface IntelArtifactData {
  id: string;
  requirement_id: string;
  stakeholder_id?: string | null;
  stakeholder_name?: string;
  stakeholder_role?: string;
  artifact_type: string;
  content: string;
  is_known?: boolean;
}

export interface TradeOffBranch {
  name?: string;
  description: string;
  target?: string;
  level?: number;
  ops?: Array<{ kind: string; target: string; value: number }>;
}

export interface IntelEntry {
  id: string;
  debug?: IntelDebugInfo;
  requirement_id?: string;
  intel_type: string; // "unconfirmed" or "verified"
  categorized_type: string; // an IntelTag: "driver", "boundary", "trade_off" or "fact"
  description: string;
  /** Split wording: the part that holds still whatever the player tags it (bold). */
  fact?: string | null;
  /** Split wording: the part the tag is about; italic while the call is unconfirmed. */
  reading?: string | null;
  is_correct?: boolean;
  /** Where the item came from: "public_record", "offline_artifact", "interview" or "debate". */
  source?: string;
  /** For offline artifacts: which kind of document the player read it off. */
  artifact_type?: string;
  /** Resolved source artifact payload if this note was read off an artifact. */
  artifact?: IntelArtifactData | null;
  /** Refinement chain (plan 05): every link of one chain carries the same id. */
  chain_id?: string;
  chain_position?: number;
  chain_length?: number;
  refines_id?: string | null;
  /** Authored refinements past this link that the player has not found yet. A count only. */
  locked_links?: number;
  discovered_phase_id?: number | null;
  /** The graph target the note is about, and the stage that target sits in. */
  target?: string | null;
  /** How many intel items exist about this target in total, found or not - the per-target
   *  counterpart to `intel_total` on the stakeholder entry. Same for every note sharing a target. */
  target_total?: number | null;
  stage_id?: string | null;
  stage_name?: string | null;
  /** Read off the graph every time: "open", "addressed" or "stale". */
  status?: string;
  branch_x?: TradeOffBranch | null;
  branch_y?: TradeOffBranch | null;
}

export interface StakeholderDossierEntry {
  stakeholder_id: string;
  name: string;
  responsibilities: string;
  priorities: string;
  constraints?: string;
  role_description: string;
  metric_id?: string;
  power?: string;
  interest?: string;
  is_validated?: boolean;
  intel_items: IntelEntry[];
  /** How many notes this stakeholder has in the challenge, found or not. */
  intel_total?: number;
  /** The Challenge-Intel page: Facts about the system, not about anybody. */
  is_challenge_intel?: boolean;
  /** Stages this challenge is about, which the stage filter starts on. */
  focus_stage_ids?: string[];
  debug?: StakeholderDebugInfo;
}

export interface StakeholderBuyInInfo {
  threshold: number;
  actionCardScore: number;
  dialogueScore?: number;
  emotionScore: number;
  total: number;
  isPersuaded: boolean;
  // Below `threshold` (or boundary violated): high power vetoes, low power only objects.
  blocks?: boolean;
  currentEmotion?: string;
  boundaryViolated?: boolean;
  isRevealed?: boolean;
}

export interface StakeholderDossierProps {
  isOpen: boolean;
  onClose: () => void;
  dossierData: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  /** The stakeholder currently being narrated by TTS, if any - animates their polaroid avatar
   * (mouth-flap + head-sway) the same way a seated/chat avatar does while they're talking. */
  speakingStakeholderId?: string | null;
  /** Fires when the player navigates the dossier itself (tab click, prev/next arrow, System
   *  toggle) - not when `activeStakeholderId` drives the page from outside. Lets an embedding
   *  scene (e.g. the pitch deck table) keep its own "selected stakeholder" in sync with
   *  whichever page the dossier is showing, in both directions. Called with `null` when the
   *  player switches to the Challenge-Intel page, since no stakeholder is showing there. */
  onActiveStakeholderChange?: (stakeholderId: string | null) => void;
  highlightedIntelId?: string | null;
  currentPhase?: number;
  currentChallenge?: number;
  canClose?: boolean;
  isEmbedded?: boolean;
  emotionColors?: Record<string, string>;
  buyInInfoMap?: Record<string, StakeholderBuyInInfo>;
  /**
   * Carries the phase briefing's NEW / SHIFTED markers onto the stakeholder
   * tabs. Off by default: only the offline intel phase asks for them.
   */
  showPhaseChangeBadges?: boolean;
  /** Reopens the phase briefing. The button only appears when this is given. */
  onOpenPhaseBriefing?: () => void;
  /** Opens/closes the pipeline view. Button appears in the dossier header. */
  /** When set, notes can be dragged onto the card builder (plan 06). */
  draggableIntel?: boolean;
  onPerformanceToggle?: () => void;
  isPerformanceOpen?: boolean;
  /** Opens/closes the event log. Button appears in the dossier header, next to Performance. */
  onLogToggle?: () => void;
  isLogOpen?: boolean;
  /** Badges the Log button with how many events have been filed so far. */
  logCount?: number;
  /** Opens/closes the settings panel. Button appears in the dossier header, next to Log. */
  onSettingsToggle?: () => void;
  isSettingsOpen?: boolean;
  /** Opens the associated offline artifact for an intel item */
  onOpenArtifact?: (item: IntelEntry) => void;
  /** Which cheat sheet card matches the screen the dossier is embedded in right now. The cheat
   * sheet scrolls to it and gives it a one-time pop when opened. Omit where no screen maps
   * cleanly (e.g. the briefing itself never embeds the dossier). */
  cheatSheetActiveSection?: "Briefing" | "Digging for Intel" | "Pitch & Debate" | "Simulate";
}

/** One authored item's answer key: true tag, graph target and the artifact it is read off. */
const DebugRequirement: React.FC<{ info: IntelDebugInfo; playerTag?: string }> = ({ info, playerTag }) => (
  <>
    <div className={styles.debugRow}>
      <strong>True tag:</strong>{" "}
      <span className={playerTag === undefined || playerTag === info.correct_tag ? styles.debugRightText : styles.debugWrongText}>
        {info.correct_tag}
      </span>
      {playerTag !== undefined && playerTag !== info.correct_tag && <> (player tagged {playerTag})</>}
    </div>
    <div className={styles.debugRow}>
      <strong>Target:</strong> {info.target ?? "none"}
      {info.level != null && <> at level {info.level}</>}
    </div>
    <div className={styles.debugRow}>
      <strong>Id:</strong> {info.id}
      {info.refines_id && <> (refines {info.refines_id})</>}
    </div>
    <div className={styles.debugRow}>
      <strong>Authored:</strong> {info.description}
    </div>
    {info.artifact ? (
      <div className={styles.debugRow}>
        <strong>
          Hinted by {info.artifact.artifact_type} {info.artifact.id}
          {info.artifact.speaker_id && <> from {info.artifact.speaker_id}</>}
          {info.artifact.is_known && <> (on record at start)</>}:
        </strong>
        <pre className={styles.debugArtifact}>{info.artifact.content}</pre>
        <div>
          <strong>Humor:</strong>{" "}
          {info.artifact.humor_archetype ? (
            <span className={styles.debugRightText}>{info.artifact.humor_archetype}</span>
          ) : (
            <span className={styles.debugWrongText}>none</span>
          )}
          {info.artifact.humor_verdict && (
            <>
              {" "}·{" "}
              <span className={info.artifact.humor_verdict === "strong" ? styles.debugRightText : styles.debugWrongText}>
                {info.artifact.humor_verdict}
              </span>
            </>
          )}
        </div>
        {info.artifact.humor_review_reason && (
          <div className={styles.debugRow}>
            <strong>Humor review:</strong> {info.artifact.humor_review_reason}
          </div>
        )}
      </div>
    ) : (
      <div className={styles.debugRow}>
        <strong>Hinted by:</strong> no offline artifact (interview or debate only)
      </div>
    )}
  </>
);

/** How long the markers keep pulsing when the player never opens their tab. */
const CHANGE_BADGE_PULSE_TIMEOUT_MS = 15000;

/** Dwell on a tab before its marker counts as seen. */
const CHANGE_BADGE_SEEN_MS = 1000;

const TAG_STYLE_CLASS: Record<string, string> = {
  requirement: styles.tagRequirement,
  preference: styles.tagNegotiable,
  friction: styles.tagFriction,
  default: styles.tagDefault,
};

const CATEGORY_META: Record<string, { label: string; icon: string; color: string; styleClass: string }> = Object.fromEntries(
  [...INTEL_TAGS, CHALLENGE_INTEL_META].map((t) => [t.type, { label: t.label, icon: t.icon, color: t.color, styleClass: TAG_STYLE_CLASS[t.styleKey] }])
);

/** Document wording for the "your read of their ..." caption. */
const ARTIFACT_TYPE_LABEL: Record<string, string> = {
  email: "email",
  slack_message: "Slack message",
  meeting_notes: "meeting notes",
  document: "document",
};

/**
 * Where a note came from. The stamp already says how sure the player can be; this says how it
 * got here, which the stamp cannot: two confirmed notes can have arrived by very different
 * routes. Player language, one line, no system words.
 */
const getSourceCaption = (item: IntelEntry): { icon: string; text: string; title: string } | null => {
  switch ((item.source || "").toLowerCase()) {
    case "public_record":
      return {
        icon: "ph:megaphone-duotone",
        text: "Said openly in the team channel",
        title: "They said this in a channel the whole team reads, before you started digging.",
      };
    case "interview":
      return {
        icon: "ph:chats-circle-bold",
        text: "They told you this directly",
        title: "You got this straight from them while gathering intel.",
      };
    case "debate":
      return {
        icon: "ph:microphone-stage-bold",
        text: "Came out during the pitch",
        title: "This surfaced when they pushed back on your proposal.",
      };
    case "offline_artifact":
    default: {
      const label = ARTIFACT_TYPE_LABEL[(item.artifact_type || "").toLowerCase()];
      return {
        icon: "ph:file-text-bold",
        text: label ? `You read their ${label}` : "You read a document",
        title: "You read a document you found. Nobody has confirmed it yet.",
      };
    }
  }
};

type IntelPipStatus = "on_record" | "confirmed" | "unconfirmed" | "hidden";

/** Pips follow the stamps' colours, so they teach the player nothing new. */
const INTEL_PIP_META: Record<IntelPipStatus, { label: string; styleClass: string }> = {
  on_record: { label: "On record", styleClass: styles.pipOnRecord },
  confirmed: { label: "Confirmed", styleClass: styles.pipConfirmed },
  unconfirmed: { label: "Unconfirmed", styleClass: styles.pipUnconfirmed },
  hidden: { label: "Not found yet", styleClass: styles.pipHidden },
};

/** Settled first, so the row fills up from the left like a progress bar. */
const INTEL_PIP_ORDER: IntelPipStatus[] = ["on_record", "confirmed", "unconfirmed", "hidden"];

const getIntelPipStatus = (item: IntelEntry): IntelPipStatus => {
  const confidence = (item.intel_type || "unconfirmed").toLowerCase();
  if (confidence === "verified") {
    return (item.source || "").toLowerCase() === "public_record" ? "on_record" : "confirmed";
  }
  return "unconfirmed";
};

/**
 * One pip per note in the stakeholder's pool: the found ones by stamp, then a hollow one for
 * each still out there. Hollow pips say how many, never what: no category, no source. Found
 * pips go by stamp, never by `is_correct`, so they cannot give away a wrong tag either.
 */
const getIntelPips = (st: StakeholderDossierEntry): IntelPipStatus[] => {
  // Addressed/stale notes stay in the dossier for their chain history, but they're done or out
  // of date - not part of what's still active this challenge, so they don't count as "found".
  const found = (st.intel_items || [])
    .filter((item) => !isResolvedStatus(item.status))
    .map(getIntelPipStatus);
  const hiddenCount = Math.max(0, (st.intel_total ?? 0) - found.length);
  return [...found, ...Array<IntelPipStatus>(hiddenCount).fill("hidden")].sort(
    (a, b) => INTEL_PIP_ORDER.indexOf(a) - INTEL_PIP_ORDER.indexOf(b)
  );
};

/** Hover text for a pip row, e.g. "3 of 4 notes found: 1 on record, 2 unconfirmed". */
const describeIntelPips = (pips: IntelPipStatus[]): string => {
  const countOf = (status: IntelPipStatus) => pips.filter((p) => p === status).length;
  const breakdown = (["on_record", "confirmed", "unconfirmed"] as const)
    .filter((status) => countOf(status) > 0)
    .map((status) => `${countOf(status)} ${INTEL_PIP_META[status].label.toLowerCase()}`);
  const summary = `${pips.length - countOf("hidden")} of ${pips.length} notes found`;
  return breakdown.length > 0 ? `${summary}: ${breakdown.join(", ")}` : summary;
};

/** Display labels for the emotion factory's 7 dimensions (game-api EmotionValueConfig.json).
 * Short enough for a badge; never the raw score, only the bucket the backend already sorted it into. */
const EMOTION_DIMENSION_LABEL: Record<string, string> = {
  trust: "Trust",
  interest: "Interest",
  stress: "Stress",
  confidence: "Confidence",
  perceived_risk: "Perceived risk",
  sense_of_control: "Sense of control",
  fairness: "Fairness",
};

/** One-line, player-facing "how to move this" hint per dimension - shown as a hover/focus
 * tooltip on that dimension's row in the reveal card. Framed as an action, not a mechanic.
 * Source: docs/plans/pitch-debate-and-intel-item-redesign/02-stakeholder-emotion-changes.md
 * (section 2.4) and the malus/veto tables (sections 3-4) - keep in sync with whatever actually
 * moves that dimension in domain/emotion.py. */
const EMOTION_DIMENSION_HINT: Record<string, string> = {
  trust: "Deliver what you promised them",
  interest: "Keep addressing what they actually asked for",
  stress: "Resolve their blockers, avoid boundary breaches",
  confidence: "Ship clean, working simulation runs",
  perceived_risk: "Close compliance and safety gaps",
  sense_of_control: "Give their agenda a real seat at the table",
  fairness: "Match their share of demands with a share of slots",
};

/** Level/tick styling for each bucket. The backend only ever hands over one of three buckets, so
 * the reveal shows exactly three discrete steps rather than a continuous-looking bar - `level` is
 * how many of the three segments light up, never a percentage. */
const EMOTION_BUCKET_META: Record<
  "low" | "medium" | "high",
  { label: string; level: 1 | 2 | 3; fillClass: string; wordClass: string }
> = {
  low: { label: "Low", level: 1, fillClass: styles.emotionFillLow, wordClass: styles.emotionWordLow },
  medium: { label: "Med", level: 2, fillClass: styles.emotionFillMedium, wordClass: styles.emotionWordMedium },
  high: { label: "High", level: 3, fillClass: styles.emotionFillHigh, wordClass: styles.emotionWordHigh },
};

/** Dimensions where a *drop* is the good outcome for the stakeholder (less stress, less
 *  perceived risk). Mirrors ac_simulation.tsx's INVERTED_EMOTION_DIMENSIONS - everything else
 *  defaults to "higher is better". */
const INVERTED_EMOTION_DIMENSIONS = new Set(["stress", "perceived_risk", "frustration", "fear", "anxiety"]);

/** Good/bad colours, independent of the low/medium/high magnitude above - a dimension's reading
 *  can be low-magnitude and still bad news (low trust) or high-magnitude and good news (high
 *  trust), so the colour can't just follow the bucket directly. Green matches .pipConfirmed's
 *  existing "good" green elsewhere in this stylesheet. */
const EMOTION_VALENCE_COLOR = {
  good: { fillClass: styles.emotionFillGood, wordClass: styles.emotionWordGood },
  bad: { fillClass: styles.emotionFillHigh, wordClass: styles.emotionWordHigh },
};

/**
 * Bucket styling for one dimension's reading. `level`/`label` stay true to the actual magnitude
 * bucket (a "High" stress reading is still labelled High), but the fill/word colour is chosen by
 * whether that bucket is good or bad news for this specific dimension.
 */
const getEmotionBucketMeta = (metric: string, bucket: "low" | "medium" | "high") => {
  const magnitude = EMOTION_BUCKET_META[bucket] || EMOTION_BUCKET_META.medium;
  if (bucket === "medium") return magnitude;
  const inverted = INVERTED_EMOTION_DIMENSIONS.has(metric.toLowerCase());
  const isGood = inverted ? bucket === "low" : bucket === "high";
  const valence = EMOTION_VALENCE_COLOR[isGood ? "good" : "bad"];
  return { ...magnitude, fillClass: valence.fillClass, wordClass: valence.wordClass };
};

/** Screen-reader text for the emotion reveal, since the visual card is aria-hidden. */
const describeGatingDimensions = (dims: { metric: string; bucket: string }[] | undefined): string => {
  if (!dims || dims.length === 0) return "";
  return dims
    .map((d) => {
      const bucketLabel = EMOTION_BUCKET_META[d.bucket as "low" | "medium" | "high"]?.label || d.bucket;
      return `${EMOTION_DIMENSION_LABEL[d.metric] || d.metric}: ${bucketLabel}`;
    })
    .join(", ");
};

/** Breathing room kept between the reveal card and both the badge and the viewport edge,
 * mirroring HoverToolTip.tsx's own EDGE_MARGIN. */
const EMOTION_REVEAL_EDGE_MARGIN = 8;

/**
 * The emotion badge plus its hover/focus reveal card. The card is portaled to document.body
 * (same pattern as HoverToolTip.tsx) rather than absolutely positioned inside the badge: the
 * dossier page scrolls and its sticky notes each carry their own CSS transform for the paper
 * tilt, which makes every note its own stacking context independent of z-index - an absolutely
 * positioned descendant of the scrolling page can never out-rank that from the inside, no matter
 * how high its z-index goes. Rendering outside that DOM subtree and positioning it from the
 * badge's on-screen rect sidesteps the problem entirely.
 */
const EmotionRevealBadge: React.FC<{
  emotionDisplay: string;
  emotionColor: string;
  gatingInfo?: EmotionGatingInfo;
  fullDimensions?: EmotionGatingDimension[];
}> = ({ emotionDisplay, emotionColor, gatingInfo, fullDimensions }) => {
  const gatingDims = gatingInfo?.dimensions || [];
  const hasReveal = gatingDims.length > 0;
  const isCurrent = gatingInfo?.is_current ?? true;
  // Neutral is its own reading, not a discount on some other mood - the dimensions shown are
  // simply the ones with the most room to move, named without borrowing a state that hasn't
  // actually triggered.
  const revealTitle = isCurrent ? `Why ${emotionDisplay.toLowerCase()}` : "Steady for now";

  const gatingMetrics = new Set(gatingDims.map((d) => d.metric));
  // All 7 dimensions, gating ones first (in their gating order), then the rest in the fixed,
  // stable order EMOTION_DIMENSION_LABEL's keys already give - falls back to just the gating
  // dims if the full set hasn't arrived yet.
  const allDims: EmotionGatingDimension[] =
    fullDimensions && fullDimensions.length > 0
      ? [
          ...gatingDims,
          ...Object.keys(EMOTION_DIMENSION_LABEL)
            .filter((metric) => !gatingMetrics.has(metric))
            .map((metric) => fullDimensions.find((d) => d.metric === metric))
            .filter((d): d is EmotionGatingDimension => Boolean(d)),
        ]
      : gatingDims;

  const [show, setShow] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const hideTimeoutRef = useRef<number | null>(null);
  const clearHideTimeout = () => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const handleShow = () => {
    clearHideTimeout();
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + EMOTION_REVEAL_EDGE_MARGIN, left: rect.left });
    }
    setShow(true);
  };
  // Hides on a short delay rather than instantly: moving the mouse from the badge down into the
  // portaled card crosses a small gap that belongs to neither element, and closing the instant
  // that gap is entered would make the card impossible to hover into (and its per-dimension
  // `title` hints impossible to read). handleShow - fired by either the badge or the card itself
  // - cancels the pending hide before it fires.
  const handleHide = () => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => setShow(false), 200);
  };
  // Keyboard blur has no such gap to bridge, so it hides immediately.
  const handleBlur = () => {
    clearHideTimeout();
    setShow(false);
  };

  useEffect(() => clearHideTimeout, []);

  // Flip above the badge when the card would run off the bottom of the window, and keep it
  // inside the viewport horizontally. Mirrors HoverToolTip's own layout pass.
  useLayoutEffect(() => {
    if (!show || !cardRef.current || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const box = cardRef.current.getBoundingClientRect();

    let top = anchor.bottom + EMOTION_REVEAL_EDGE_MARGIN;
    if (top + box.height > window.innerHeight - EMOTION_REVEAL_EDGE_MARGIN) {
      const above = anchor.top - EMOTION_REVEAL_EDGE_MARGIN - box.height;
      top =
        above >= EMOTION_REVEAL_EDGE_MARGIN
          ? above
          : Math.max(EMOTION_REVEAL_EDGE_MARGIN, window.innerHeight - EMOTION_REVEAL_EDGE_MARGIN - box.height);
    }
    const left = Math.min(
      Math.max(anchor.left, EMOTION_REVEAL_EDGE_MARGIN),
      window.innerWidth - EMOTION_REVEAL_EDGE_MARGIN - box.width
    );

    setCoords((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
  }, [show]);

  const ariaLabel = hasReveal
    ? `Emotional state: ${emotionDisplay}. ${describeGatingDimensions(gatingDims)}`
    : undefined;

  return (
    <div
      ref={anchorRef}
      className={`${styles.powerInterestBadge} ${styles.emotionBadge}`}
      tabIndex={hasReveal ? 0 : undefined}
      title={hasReveal ? undefined : `Emotional State: "${emotionDisplay}"`}
      aria-label={ariaLabel}
      onMouseEnter={hasReveal ? handleShow : undefined}
      onMouseLeave={hasReveal ? handleHide : undefined}
      onFocus={hasReveal ? handleShow : undefined}
      onBlur={hasReveal ? handleBlur : undefined}
    >
      <Icon
        icon={iconForEmotionState(emotionDisplay)}
        className={styles.metricIcon}
        style={{ color: emotionColor }}
      />
      <span style={{ color: emotionColor, fontWeight: 700 }}>{emotionDisplay.toUpperCase()}</span>
      {hasReveal && (
        <span
          className={`${styles.emotionMicroTicks} ${!isCurrent ? styles.emotionMicroTicksPending : ""}`}
          aria-hidden="true"
        >
          {gatingDims.slice(0, 3).map((dim, idx) => {
            const meta = getEmotionBucketMeta(dim.metric, dim.bucket as "low" | "medium" | "high");
            const levelClass =
              meta.level === 1
                ? styles.emotionMicroTickLevel1
                : meta.level === 2
                ? styles.emotionMicroTickLevel2
                : styles.emotionMicroTickLevel3;
            return (
              <span
                key={idx}
                className={`${styles.emotionMicroTick} ${levelClass} ${
                  !isCurrent ? styles.emotionMicroTickPending : meta.fillClass
                }`}
              />
            );
          })}
        </span>
      )}
      {hasReveal &&
        show &&
        createPortal(
          <div
            className={styles.emotionRevealAnchor}
            style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
            onMouseEnter={handleShow}
            onMouseLeave={handleHide}
          >
            <div
              ref={cardRef}
              className={`${styles.emotionRevealCard} ${!isCurrent ? styles.emotionRevealCardPending : ""}`}
              aria-hidden="true"
            >
              <div className={styles.emotionRevealTitle}>{revealTitle}</div>
              <div className={styles.emotionRevealDims}>
                {allDims.map((dim, idx) => {
                  const meta = getEmotionBucketMeta(dim.metric, dim.bucket as "low" | "medium" | "high");
                  const isGating = gatingMetrics.has(dim.metric);
                  return (
                    <div className={styles.emotionDimRow} key={idx}>
                      {/* Portals to document.body (HoverTooltip's default), same as the reveal
                          card itself - NOT into the card's own subtree. That subtree sits under
                          .emotionRevealAnchor, which sets `perspective` for the card's flip
                          animation; `perspective` (like `transform`) creates a new containing
                          block for `position: fixed` descendants, which silently breaks this
                          tooltip's viewport-relative coordinates. Staying above HoverTooltip's own
                          z-index (see HoverToolTip.module.css) is what keeps it visible instead. */}
                      <HoverTooltip description={EMOTION_DIMENSION_HINT[dim.metric] || ""}>
                        <span
                          className={`${styles.emotionDimName} ${
                            isGating ? styles.emotionDimNameGating : ""
                          }`}
                        >
                          {EMOTION_DIMENSION_LABEL[dim.metric] || dim.metric}
                          <Icon icon="ph:info-bold" className={styles.emotionDimHintIcon} />
                        </span>
                      </HoverTooltip>
                      <span className={styles.emotionDimSegments}>
                        {[1, 2, 3].map((seg) => (
                          <span
                            key={seg}
                            className={`${styles.emotionDimSegment} ${seg === meta.level ? meta.fillClass : ""}`}
                          />
                        ))}
                      </span>
                      <span className={`${styles.emotionDimWord} ${meta.wordClass}`}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

/** Breathing room between a header button's hover tag and the viewport edge. */
const HEADER_TAG_EDGE_MARGIN = 6;

/**
 * One binder-header button: a fixed-size icon square, an optional corner badge, and a
 * hover/focus label. The label is portaled to document.body and positioned from the button's
 * own rect (same reasoning as EmotionRevealBadge above) - .binderHeader sits in a lower
 * z-index stacking context than the tabs row below it, so an absolutely positioned descendant
 * of the button can never paint above the tabs no matter how high its own z-index goes.
 * Rendering outside that subtree and placing it from the button's on-screen rect sidesteps it.
 */
const HeaderIconButton: React.FC<{
  icon: string;
  label: string;
  /** A second, smaller line under the label - current state worth a glance without a click. */
  detail?: string;
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  badge?: React.ReactNode;
  onClick?: () => void;
  /** Overrides the leather-button look for a differently-styled anchor, e.g. .topNavArrow. */
  buttonClassName?: string;
}> = ({ icon, label, detail, ariaLabel, active, disabled, badge, onClick, buttonClassName }) => {
  const [show, setShow] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const handleShow = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + HEADER_TAG_EDGE_MARGIN, left: rect.left + rect.width / 2 });
    }
    setShow(true);
  };
  const handleHide = () => setShow(false);

  // Keep the tag inside the viewport horizontally. The header always has room below it (the
  // tabs row, then the page), so unlike EmotionRevealBadge this never needs to flip upward.
  useLayoutEffect(() => {
    if (!show || !tagRef.current || !btnRef.current) return;
    const anchor = btnRef.current.getBoundingClientRect();
    const box = tagRef.current.getBoundingClientRect();
    const half = box.width / 2;
    const left = Math.min(
      Math.max(anchor.left + anchor.width / 2, HEADER_TAG_EDGE_MARGIN + half),
      window.innerWidth - HEADER_TAG_EDGE_MARGIN - half
    );
    setCoords((prev) => (prev.left === left ? prev : { ...prev, left }));
  }, [show, label, detail]);

  return (
    <button
      ref={btnRef}
      className={buttonClassName || `${styles.briefingButton} ${active ? styles.briefingButtonActive : ""}`}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
      aria-label={ariaLabel}
    >
      <span className={styles.buttonIconWrap}>
        <Icon icon={icon} />
        {badge}
      </span>
      {show &&
        createPortal(
          <div
            ref={tagRef}
            className={styles.headerHoverTag}
            style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
            aria-hidden="true"
          >
            <div className={styles.headerHoverTagFlip}>
              <div className={styles.headerHoverTagLabel}>{label}</div>
              {detail && <div className={styles.headerHoverTagDetail}>{detail}</div>}
            </div>
          </div>,
          document.body
        )}
    </button>
  );
};

/** Stage colours for the filter row and the environment page, from the pipeline view (plan 08). */
const STAGE_META: Record<string, { label: string; color: string }> = {
  req: { label: "Requirements", color: "#7c3aed" },
  data: { label: "Data", color: "#0284c7" },
  model: { label: "Modeling", color: "#16a34a" },
  deploy: { label: "Deployment", color: "#d97706" },
  ops: { label: "Monitoring and Ops", color: "#dc2626" },
};

const stageMeta = (id?: string | null): { label: string; color: string } =>
  (id ? STAGE_META[id] : undefined) || { label: id || "Not on the map", color: "#94a3b8" };

/**
 * What the graph currently says about a note. "open" is the quiet default and gets no badge:
 * most notes are open, and a badge on every one of them would say nothing.
 */
const STATUS_META: Record<string, { label: string; title: string; styleClass: string }> = {
  addressed: {
    label: "DONE",
    title: "Somebody already took this as far as they asked for.",
    styleClass: "statusAddressed",
  },
  stale: {
    label: "OUT OF DATE",
    title: "The system has moved since you wrote this down.",
    styleClass: "statusStale",
  },
};

/** Addressed or stale: the note has nothing left to act on, so it drops into its own category. */
const isResolvedStatus = (status?: string): boolean => status === "addressed" || status === "stale";

export interface IntelChain {
  id: string;
  /** The newest link: the headline, and the payload the card builder uses. */
  newest: IntelEntry;
  /** The links it grew out of, oldest first. */
  older: IntelEntry[];
}

/** One card per refinement chain (D24), however many notes went into it. */
const toChains = (items: IntelEntry[]): IntelChain[] => {
  const byChain = new Map<string, IntelEntry[]>();
  (items || []).forEach((item) => {
    const key = item.chain_id || item.id;
    byChain.set(key, [...(byChain.get(key) || []), item]);
  });
  return [...byChain.entries()].map(([id, links]) => {
    const ordered = [...links].sort((a, b) => (a.chain_position ?? 0) - (b.chain_position ?? 0));
    return { id, newest: ordered[ordered.length - 1], older: ordered.slice(0, -1) };
  });
};

/** Everything in a chain the search box should match: every layer, its target and its stage. */
const chainText = (chain: IntelChain): string =>
  [chain.newest, ...chain.older]
    .map((link) => `${link.description || ""} ${link.target || ""} ${link.stage_name || ""}`)
    .join(" ")
    .toLowerCase();

/** Phases are stored from zero and spoken from one, and they have names worth using. */
export const phaseLabel = (phase?: number | null, phases?: PhaseData[]): string => {
  if (phase === null || phase === undefined) return "earlier";
  const named = phases?.[phase]?.phase_name;
  return named || `phase ${phase + 1}`;
};

/** Dock-sized phase names. Deployment is checked before model: "Model Deployment" deploys. */
const PHASE_SHORT_LABELS: Array<[RegExp, string]> = [
  [/requirement/i, "REQ"],
  [/deploy/i, "DEPLOY"],
  [/monitor|usage|operation/i, "OPS"],
  [/data/i, "DATA"],
  [/model/i, "MODEL"],
  [/intro/i, "INTRO"],
];

export const phaseShortLabel = (phase?: number | null, phases?: PhaseData[]): string => {
  if (phase === null || phase === undefined) return "EARLIER";
  const named = phases?.[phase]?.phase_name || "";
  return PHASE_SHORT_LABELS.find(([pattern]) => pattern.test(named))?.[1] || `P${phase + 1}`;
};

export default function StakeholderDossier({
  isOpen,
  onClose,
  dossierData,
  activeStakeholderId,
  speakingStakeholderId = null,
  onActiveStakeholderChange,
  highlightedIntelId,
  currentPhase: propPhase,
  currentChallenge: propChallenge = 0,
  canClose = true,
  isEmbedded = false,
  emotionColors: propEmotionColors,
  buyInInfoMap,
  showPhaseChangeBadges = false,
  onOpenPhaseBriefing,
  draggableIntel = false,
  onPerformanceToggle,
  isPerformanceOpen = false,
  onLogToggle,
  isLogOpen = false,
  logCount,
  onSettingsToggle,
  isSettingsOpen = false,
  onOpenArtifact,
  cheatSheetActiveSection,
}: StakeholderDossierProps) {
  const { emit, subscribe, username } = useGameWebSocket();
  const { stakeholders, emotionColors: contextEmotionColors } = useContext(StakeholderContext) || {
    stakeholders: {},
    emotionColors: {},
  };
  const activeEmotionColors = propEmotionColors || contextEmotionColors || {};
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const { currentPhase: contextPhase, phases, introPhaseEnabled } = useContext(PhasesContext) || {
    currentPhase: 0,
    phases: [],
    introPhaseEnabled: false,
  };
  const currentPhase = propPhase ?? contextPhase ?? 0;
  const currentChallenge = propChallenge;

  // Badges the Performance button with the project graph's overall health, the same number
  // PerformanceDashboard itself shows. Only asked for when that button exists.
  const [systemHealth, setSystemHealth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!onPerformanceToggle) return;
    emit("graph:state_request", { phase_id: currentPhase });
    const unsub = subscribe("graph:state", (data: { system_health?: number }) => {
      setSystemHealth(data?.system_health);
    });
    return unsub;
  }, [onPerformanceToggle, currentPhase]);

  const [activeRetagNoteId, setActiveRetagNoteId] = useState<string | null>(null);
  const [hoveredPolaroidStId, setHoveredPolaroidStId] = useState<string | null>(null);
  /** Which answer-key panel is unfolded: a note id, or `page-<stakeholder id>`. Debug builds only. */
  const [openDebugId, setOpenDebugId] = useState<string | null>(null);
  const toggleDebug = (id: string) => setOpenDebugId((prev) => (prev === id ? null : id));

  // The same flip-down hover/focus tag HeaderIconButton uses, but shared across every
  // stakeholder tab and every power/interest/intel badge instead of one hook instance per
  // element: only one can ever be visible at a time, and several of these anchors are built
  // inside .map() loops, where a per-element hook call would break the Rules of Hooks.
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
    setInfoTag({ label, detail, top: rect.bottom + HEADER_TAG_EDGE_MARGIN, anchorX, left: anchorX });
  };
  const hideInfoTag = () => setInfoTag(null);

  // Keep the tag inside the viewport horizontally, same as HeaderIconButton's own pass.
  // Recomputed from the fixed anchorX (not the previous left) so repeat adjustments - e.g. its
  // detail text changing width while it's already showing - never drift it off its anchor.
  useLayoutEffect(() => {
    if (!infoTag || !infoTagRef.current) return;
    const box = infoTagRef.current.getBoundingClientRect();
    const half = box.width / 2;
    const left = Math.min(
      Math.max(infoTag.anchorX, HEADER_TAG_EDGE_MARGIN + half),
      window.innerWidth - HEADER_TAG_EDGE_MARGIN - half
    );
    setInfoTag((prev) => (prev && prev.left !== left ? { ...prev, left } : prev));
  }, [infoTag?.anchorX, infoTag?.label, infoTag?.detail]);

  // Dossier filters (plan 05). `null` means the player has not touched the stage row yet, so it
  // keeps following the challenge's focus stages as those change.
  const [phaseFilter, setPhaseFilter] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [collapseAddressed, setCollapseAddressed] = useState(true);
  const [confFilter, setConfFilter] = useState<
    "all" | "on_record" | "verified" | "unconfirmed"
  >("all");
  /** The page the player was on before opening the system, so the button toggles back. */
  const lastPersonPage = useRef(0);

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  /** The cheat sheet is static reference content, so it needs no state from outside. */
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);

  // Track fading out highlight state
  const [fadingOutIntelId, setFadingOutIntelId] = useState<string | null>(null);
  const prevHighlightedIdRef = useRef<string | null | undefined>(highlightedIntelId);
  const fadeOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prevId = prevHighlightedIdRef.current;
    if (prevId && !highlightedIntelId) {
      // Highlight was just removed, trigger fade out
      setFadingOutIntelId(prevId);
      if (fadeOutTimerRef.current) clearTimeout(fadeOutTimerRef.current);
      fadeOutTimerRef.current = setTimeout(() => {
        setFadingOutIntelId(null);
      }, 300); // match fade out animation duration
    } else if (highlightedIntelId) {
      // New highlight active, clear any pending fade-out
      setFadingOutIntelId(null);
      if (fadeOutTimerRef.current) clearTimeout(fadeOutTimerRef.current);
    }
    prevHighlightedIdRef.current = highlightedIntelId;
  }, [highlightedIntelId]);

  // Position state for window dragging. Committed to React state only once, on mouse-up - see
  // handleMouseDown below for why the drag itself never calls setPosition.
  const [position, setPosition] = useState({ x: 120, y: 60 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  // The window's own DOM node, moved directly during a drag rather than through React state -
  // see handleMouseDown.
  const windowRef = useRef<HTMLDivElement>(null);

  const prevDossierRef = useRef<StakeholderDossierEntry[]>(dossierData);

  // Dossier entries that arrived but have not yet played their "appear" animation.
  // Keys are `intel-<stakeholder>-<intel id>`.
  const [pendingAppearKeys, setPendingAppearKeys] = useState<Set<string>>(new Set());
  const seenAppearKeysRef = useRef<Set<string> | null>(null);
  const prevIsOpenRef = useRef<boolean>(isOpen);
  const prevActiveStIdRef = useRef<string | undefined>(activeStakeholderId);

  // Smoothly scroll active tab into view when page changes
  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [currentPageIndex]);

  // Derive active stakeholders with useMemo
  const effectiveDossierData = React.useMemo<StakeholderDossierEntry[]>(() => {
    const allSts = Object.values(stakeholders || {});
    const activeSts = allSts.filter((st: any) => {
      const metric = metrics[st.metric_id] || Object.values(metrics).find((m: any) => m.id === st.metric_id);
      const metricIntro = metrics[`${st.metric_id}_intro`] || Object.values(metrics).find((m: any) => m.id === `${st.metric_id}_intro`);
      return (
        (metric && metric.phases && metric.phases[currentPhase]) ||
        (metricIntro && metricIntro.phases && metricIntro.phases[currentPhase])
      );
    });
    const targetSts = activeSts.length > 0 ? activeSts : allSts;

    const fallbackList: StakeholderDossierEntry[] = targetSts.map((st: any) => ({
      stakeholder_id: st.id || st.name,
      name: st.name || st.id,
      responsibilities: st.responsibilities || "",
      priorities: st.priorities || "",
      constraints: st.constraints || "",
      role_description: st.role_description || "Project Stakeholder",
      metric_id: st.metric_id || "",
      power: st.power || "low",
      interest: st.interest || "low",
      intel_items: [],
    }));

    if (dossierData && dossierData.length > 0) {
      return dossierData;
    } else if (fallbackList.length > 0) {
      return fallbackList;
    } else {
      return Object.values(stakeholders || {}).map((st: any) => ({
        stakeholder_id: st.id || st.name,
        name: st.name || st.id,
        responsibilities: st.responsibilities || "",
        priorities: st.priorities || "",
        constraints: st.constraints || "",
        role_description: st.role_description || "Project Stakeholder",
        metric_id: st.metric_id || "",
        power: st.power || "low",
        interest: st.interest || "low",
        intel_items: [],
      }));
    }
  }, [stakeholders, metrics, currentPhase, dossierData]);

  // The same comparison the phase briefing's radar makes, so the markers here
  // agree with what the player was just shown. Derived rather than handed over,
  // and stable for the whole phase.
  const phaseChanges = React.useMemo(() => {
    const changes = new Map<string, { isNew: boolean; shiftText: string }>();
    if (!showPhaseChangeBadges || !phases || phases.length === 0) return changes;

    const current = phases[currentPhase]?.stakeholder_power_interest || [];
    const previous = isFirstPlayablePhase(phases, currentPhase, introPhaseEnabled)
      ? []
      : phases[currentPhase - 1]?.stakeholder_power_interest || [];
    const previousById = new Map(previous.map((ps) => [ps.stakeholder_id, ps]));

    current.forEach((cs) => {
      const prev = previousById.get(cs.stakeholder_id);
      const power = (cs.power || "low").toLowerCase();
      const interest = (cs.interest || "low").toLowerCase();

      if (!prev) {
        changes.set(cs.stakeholder_id, { isNew: true, shiftText: "" });
        return;
      }

      const parts: string[] = [];
      if (prev.power.toLowerCase() !== power) {
        parts.push(`Power: ${prev.power.toUpperCase()} ➔ ${cs.power.toUpperCase()}`);
      }
      if (prev.interest.toLowerCase() !== interest) {
        parts.push(`Interest: ${prev.interest.toUpperCase()} ➔ ${cs.interest.toUpperCase()}`);
      }
      if (parts.length > 0) {
        changes.set(cs.stakeholder_id, { isNew: false, shiftText: parts.join(", ") });
      }
    });

    return changes;
  }, [showPhaseChangeBadges, phases, currentPhase]);

  const phaseChangeKey = Array.from(phaseChanges.keys()).join("|");

  // Markers pulse only until the player has had a fair chance to notice them:
  // either they open that stakeholder's tab, or the timeout runs out. After
  // that the marker stays put, quietly, for the rest of the phase.
  const [pulsingChangeIds, setPulsingChangeIds] = useState<Set<string>>(new Set());
  // Markers the player has read and then navigated away from: those are done
  // with, and the tab goes back to being uncluttered.
  const [dismissedChangeIds, setDismissedChangeIds] = useState<Set<string>>(new Set());
  const previousChangePageRef = useRef<number>(currentPageIndex);

  useEffect(() => {
    setPulsingChangeIds(new Set(phaseChanges.keys()));
    setDismissedChangeIds(new Set());
  }, [phaseChangeKey]);

  // Drop a marker when the player leaves that tab, but only once it has stopped
  // pulsing: a tab flicked past on the way elsewhere was never actually read.
  useEffect(() => {
    const leftIndex = previousChangePageRef.current;
    previousChangePageRef.current = currentPageIndex;
    if (leftIndex === currentPageIndex) return;

    const left = effectiveDossierData[leftIndex];
    if (!left || !phaseChanges.has(left.stakeholder_id)) return;
    if (pulsingChangeIds.has(left.stakeholder_id)) return;

    setDismissedChangeIds((prev) => {
      if (prev.has(left.stakeholder_id)) return prev;
      const next = new Set(prev);
      next.add(left.stakeholder_id);
      return next;
    });
  }, [currentPageIndex, effectiveDossierData, phaseChanges, pulsingChangeIds]);

  useEffect(() => {
    if (phaseChanges.size === 0) return;
    const timer = setTimeout(() => setPulsingChangeIds(new Set()), CHANGE_BADGE_PULSE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phaseChangeKey]);

  // Leaving the tab before the dwell elapses cancels it, so a tab flicked past
  // on the way somewhere else does not count as read.
  useEffect(() => {
    if (pulsingChangeIds.size === 0) return;
    const visible = effectiveDossierData[currentPageIndex];
    if (!visible || !pulsingChangeIds.has(visible.stakeholder_id)) return;

    const timer = setTimeout(() => {
      setPulsingChangeIds((prev) => {
        if (!prev.has(visible.stakeholder_id)) return prev;
        const next = new Set(prev);
        next.delete(visible.stakeholder_id);
        return next;
      });
    }, CHANGE_BADGE_SEEN_MS);

    return () => clearTimeout(timer);
  }, [pulsingChangeIds, currentPageIndex, effectiveDossierData]);

  // Phase filter, search and collapse (plan 05). The row filters by the phase a note was found in,
  // the name its spine shows. An empty selection means no filtering at all, so clearing the row
  // is how the player gets everything back.
  const phaseFilterActive = phaseFilter.size > 0;
  const nowOnly = phaseFilter.size === 1 && phaseFilter.has(currentPhase);

  const phasesOnPage = (st?: StakeholderDossierEntry): number[] => {
    const ids = new Set<number>();
    (st?.intel_items || []).forEach((item) => {
      if (item.discovered_phase_id !== null && item.discovered_phase_id !== undefined) {
        ids.add(item.discovered_phase_id);
      }
    });
    return [...ids].sort((a, b) => a - b);
  };

  const togglePhase = (phase: number) => {
    const next = new Set(phaseFilter);
    if (next.has(phase)) next.delete(phase);
    else next.add(phase);
    setPhaseFilter(next);
  };

  // A note with no phase is never filtered out by phase: it predates the stamp, and filtering it
  // away would lose it entirely.
  /** The states a note can be in. */
  const confidenceOf = (
    item: { intel_type?: string; source?: string },
  ): "on_record" | "verified" | "unconfirmed" => {
    const confidence = (item.intel_type || "unconfirmed").toLowerCase();
    if (confidence === "verified") {
      return (item.source || "").toLowerCase() === "public_record" ? "on_record" : "verified";
    }
    return "unconfirmed";
  };

  // Unconfirmed sorts first: those are the ones still worth doing something about.
  const CONF_ORDER: Record<string, number> = {
    unconfirmed: 0, verified: 1, on_record: 2,
  };

  const visibleChains = (st: StakeholderDossierEntry): IntelChain[] => {
    const needle = search.trim().toLowerCase();
    return toChains(st.intel_items || [])
      .filter((chain) => {
        const phase = chain.newest.discovered_phase_id;
        if (phaseFilterActive && phase !== null && phase !== undefined && !phaseFilter.has(phase)) return false;
        if (confFilter !== "all" && confidenceOf(chain.newest) !== confFilter) return false;
        return !needle || chainText(chain).includes(needle);
      })
      // Unconfirmed first: those are the ones still worth doing something about.
      .sort((a, b) => CONF_ORDER[confidenceOf(a.newest)] - CONF_ORDER[confidenceOf(b.newest)]);
  };

  const totalPages = effectiveDossierData.length;
  const challengeIntelIndex = effectiveDossierData.findIndex((st) => st.is_challenge_intel);

  const requestPageChange = (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= totalPages) return;
    if (targetIndex !== challengeIntelIndex) lastPersonPage.current = targetIndex;
    setActiveRetagNoteId(null);
    setCurrentPageIndex(targetIndex);
    if (onActiveStakeholderChange) {
      onActiveStakeholderChange(
        targetIndex === challengeIntelIndex ? null : effectiveDossierData[targetIndex]?.stakeholder_id ?? null
      );
    }
  };

  // Helper to find a stakeholder page index by ID, name, or sub-matches
  const findStakeholderIndex = (stIdentifier?: string | null): number => {
    if (!stIdentifier || !effectiveDossierData.length) return -1;
    const target = stIdentifier.toLowerCase().trim();
    return effectiveDossierData.findIndex((st) => {
      const stId = (st.stakeholder_id || "").toLowerCase().trim();
      const stName = (st.name || "").toLowerCase().trim();
      return (
        stId === target ||
        stName === target ||
        target.includes(stId) ||
        stId.includes(target) ||
        target.includes(stName) ||
        stName.includes(target)
      );
    });
  };

  // Helper to find stakeholder page index that contains a given intel item
  const findStakeholderIndexByIntelId = (intelId?: string | null): number => {
    if (!intelId || !effectiveDossierData.length) return -1;
    return effectiveDossierData.findIndex((st) =>
      st.intel_items?.some(
        (item) =>
          item.id === intelId ||
          String(item.id) === String(intelId) ||
          (item.description && item.description === intelId)
      )
    );
  };

  // Auto-switch page when opened or when activeStakeholderId or highlightedIntelId changes
  useEffect(() => {
    if (!isOpen || effectiveDossierData.length === 0) return;

    // 1. If an intel item is highlighted, prioritize jumping to that intel item's owner page
    if (highlightedIntelId) {
      const intelOwnerIdx = findStakeholderIndexByIntelId(highlightedIntelId);
      if (intelOwnerIdx !== -1) {
        if (intelOwnerIdx !== currentPageIndex) {
          setCurrentPageIndex(intelOwnerIdx);
        }
        return;
      }
    }

    // 2. If activeStakeholderId is provided and changed (or just opened), jump to stakeholder page
    const justOpened = isOpen && !prevIsOpenRef.current;
    const activeStChanged = activeStakeholderId !== prevActiveStIdRef.current;

    if (activeStakeholderId && (justOpened || activeStChanged)) {
      const stIdx = findStakeholderIndex(activeStakeholderId);
      if (stIdx !== -1 && stIdx !== currentPageIndex) {
        setCurrentPageIndex(stIdx);
      }
    }

    prevIsOpenRef.current = isOpen;
    prevActiveStIdRef.current = activeStakeholderId;
  }, [isOpen, activeStakeholderId, highlightedIntelId, effectiveDossierData]);

  // Auto-scroll to highlighted intel sticky note
  useEffect(() => {
    if (!highlightedIntelId) return;

    // Small delay to allow DOM render after possible page switch
    const scrollTimer = setTimeout(() => {
      const el =
        document.getElementById(`intel-sticky-${highlightedIntelId}`) ||
        document.querySelector(`[data-intel-id="${highlightedIntelId}"]`) ||
        document.querySelector(`[data-requirement-id="${highlightedIntelId}"]`) ||
        (highlightedIntelId ? document.querySelector(`[data-intel-description="${CSS.escape(highlightedIntelId)}"]`) : null);

      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 60);

    return () => clearTimeout(scrollTimer);
  }, [highlightedIntelId, currentPageIndex]);

  // Detect when artifact tagging adds new intel to a stakeholder & auto-switch to their page
  useEffect(() => {
    if (dossierData && dossierData.length > 0 && prevDossierRef.current) {
      for (const newSt of dossierData) {
        const oldSt = prevDossierRef.current.find(
          (s) => s.stakeholder_id === newSt.stakeholder_id || s.name === newSt.name
        );
        const oldCount = oldSt?.intel_items?.length || 0;
        const newCount = newSt?.intel_items?.length || 0;
        if (newCount > oldCount) {
          const targetIdx = effectiveDossierData.findIndex(
            (s) => s.stakeholder_id === newSt.stakeholder_id || s.name === newSt.name
          );
          if (targetIdx !== -1) {
            requestPageChange(targetIdx);
          }
          break;
        }
      }
    }
    prevDossierRef.current = dossierData;
  }, [dossierData, effectiveDossierData]);

  // All animatable keys a stakeholder page currently holds.
  // On-record notes are left out: the game deals them at the start of a challenge, so they
  // are never something the player added.
  const appearKeysForStakeholder = (st: StakeholderDossierEntry): string[] => {
    return (st.intel_items || [])
      .filter((item) => item.id && (item.source || "").toLowerCase() !== "public_record")
      .map((item) => `intel-${st.stakeholder_id}-${item.id}`);
  };

  // Flag intel items that the previous dossier payload did not have
  useEffect(() => {
    // The placeholder pages built from context are not a payload. Taking the baseline from
    // them would make everything in the first real payload look freshly added.
    if (!dossierData || dossierData.length === 0) return;

    const currentKeys = new Set<string>();
    for (const st of effectiveDossierData) {
      for (const key of appearKeysForStakeholder(st)) {
        currentKeys.add(key);
      }
    }

    const seen = seenAppearKeysRef.current;
    seenAppearKeysRef.current = currentKeys;

    // Finding something only ever adds notes. A payload that drops some is a reload (a new
    // challenge, a restored game, Reset all), so it becomes the new baseline and nothing in
    // it is "new". The first payload is a baseline too.
    const isReload =
      seen === null || [...seen].some((key) => key.startsWith("intel-") && !currentKeys.has(key));
    if (isReload) {
      setPendingAppearKeys((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const added = [...currentKeys].filter((key) => !seen.has(key));
    if (added.length === 0) return;

    setPendingAppearKeys((prev) => new Set([...prev, ...added]));
  }, [dossierData, effectiveDossierData, stakeholders]);

  // Consume a flag only while its own page is on screen. Tagging an artifact during offline
  // intel gathering flips the dossier to the next artifact's stakeholder almost immediately,
  // so a flag consumed on a timer alone would be spent while the card is off-screen. Pending
  // flags survive until that tab is visited.
  const visibleAppearSt = effectiveDossierData[currentPageIndex];
  const playingAppearKeys = visibleAppearSt
    ? appearKeysForStakeholder(visibleAppearSt).filter((key) => pendingAppearKeys.has(key))
    : [];
  // Keyed on the keys themselves, not the data objects: a dossier or emotion update landing
  // mid-animation would otherwise restart the timer, and if those keep coming the flag is
  // never spent and replays on every return to the tab.
  const playingAppearSignature = playingAppearKeys.join("|");

  useEffect(() => {
    if (!playingAppearSignature) return;
    const playingKeys = playingAppearSignature.split("|");

    // Leaving the page before this fires cancels it, so the animation replays on return
    const timer = setTimeout(() => {
      setPendingAppearKeys((prev) => {
        const next = new Set(prev);
        playingKeys.forEach((key) => next.delete(key));
        return next;
      });
    }, 1000); // slightly longer than the appear animations

    return () => clearTimeout(timer);
  }, [currentPageIndex, playingAppearSignature]);

  /**
   * Dragging used to call `setPosition` on every native mousemove, which re-rendered this whole
   * (very heavy) component tree at mouse-poll rate - visibly janky and expensive on CPU/GPU alike.
   * Instead, the drag moves the window's own DOM node directly via a `transform` (compositor-only,
   * no React re-render, no layout reflow) and only commits the final spot to `position` state once,
   * on mouse-up - so the rest of the dossier re-renders at most once per drag instead of hundreds
   * of times.
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const baseX = position.x;
    const baseY = position.y;
    dragStartRef.current = { x: startX, y: startY };

    const el = windowRef.current;
    if (el) el.style.willChange = "transform";

    let latestDx = 0;
    let latestDy = 0;
    let rafId: number | null = null;

    const applyFrame = () => {
      rafId = null;
      if (el) el.style.transform = `translate3d(${latestDx}px, ${latestDy}px, 0)`;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      latestDx = e.clientX - dragStartRef.current.x;
      latestDy = e.clientY - dragStartRef.current.y;
      if (rafId === null) rafId = requestAnimationFrame(applyFrame);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (el) {
        el.style.willChange = "";
        el.style.transform = "";
      }
      // Fold the drag's transform delta into the real position - a single re-render for the
      // whole drag, instead of one per mousemove.
      setPosition({ x: baseX + latestDx, y: baseY + latestDy });
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  if (!isOpen) return null;

  /**
   * Verified intel comes from two different places and players could not tell them apart:
   * items the game hands them already true because the stakeholder said it in public, and
   * items they earned by confirming a guess. Same confidence, different story, two stamps.
   */
  const renderRubberStamp = (conf: string, isPublicRecord = false) => {
    const lower = conf ? conf.toLowerCase() : "unconfirmed";
    const stampTagProps = (label: string, detail: string) => ({
      tabIndex: 0,
      "aria-label": `${label}: ${detail}`,
      onMouseEnter: (e: React.MouseEvent) => showInfoTag(e, label, detail),
      onMouseLeave: hideInfoTag,
      onFocus: (e: React.FocusEvent) => showInfoTag(e, label, detail),
      onBlur: hideInfoTag,
    });
    if (lower === "verified") {
      if (isPublicRecord) {
        return (
          <div
            className={`${styles.rubberStamp} ${styles.stampOnRecord}`}
            {...stampTagProps(
              "On Record",
              "They said this openly, in a channel the whole team reads, before you started digging. Nothing left to confirm."
            )}
          >
            ★ ON RECORD
          </div>
        );
      }
      return (
        <div
          className={`${styles.rubberStamp} ${styles.stampVerified}`}
          {...stampTagProps("Confirmed", "You verified this yourself by talking to them.")}
        >
          ✓ CONFIRMED
        </div>
      );
    }
    return (
      <div
        className={`${styles.rubberStamp} ${styles.stampUnconfirmed}`}
        {...stampTagProps(
          "Unconfirmed",
          "Confirm this item by selecting it during the Intel Verification phase, or through dialogue in the Pitch & Debate phase."
        )}
      >
        unconfirmed?
      </div>
    );
  };

  const renderHighlightedTradeOffText = (item: IntelEntry, isItalic = false, speakerName?: string) => {
    if (item.branch_x?.description && item.branch_y?.description) {
      const speaker = speakerName || "Stakeholder";
      const inner = (
        <>
          {speaker} would compromise{" "}
          <span className={styles.tradeOffBadgeA}>
            <GlossaryText text={item.branch_x.description} surface="intel_notes" />
          </span>{" "}
          for{" "}
          <span className={styles.tradeOffBadgeB}>
            <GlossaryText text={item.branch_y.description} surface="intel_notes" />
          </span>
          .
        </>
      );
      return isItalic ? <em className={styles.intelReading}>{inner}</em> : inner;
    }

    const text = item.description || "";
    const match = text.match(/^(.*?\b(?:would compromise|would trade|compromise|trade|compromised|traded)\s+)(.+?)(\s+for\s+)(.+?)(\.?)$/i);
    if (!match) {
      return isItalic ? (
        <em className={styles.intelReading}><GlossaryText text={text} surface="intel_notes" /></em>
      ) : (
        <GlossaryText text={text} surface="intel_notes" />
      );
    }
    const [, prefix, partA, connector, partB, suffix] = match;
    const inner = (
      <>
        {prefix}
        <span className={styles.tradeOffBadgeA}>
          <GlossaryText text={partA} surface="intel_notes" />
        </span>
        {connector}
        <span className={styles.tradeOffBadgeB}>
          <GlossaryText text={partB} surface="intel_notes" />
        </span>
        {suffix}
      </>
    );
    return isItalic ? <em className={styles.intelReading}>{inner}</em> : inner;
  };

  const handleReTagIntel = (intelId: string, newType: string) => {
    setActiveRetagNoteId(null);
    emit("intel:tag_item", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      intel_id: intelId,
      categorized_type: newType,
    });
    emit("intel:get_dossier", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
    });
  };


  const getStakeholderColor = (st: any): string => {
    if (!st) return "#38bdf8";
    const stId = st.stakeholder_id || st.id;
    const stObj = stakeholders[stId] || st;
    return stObj.stakeholder_color || (stObj.metric_id && metrics[stObj.metric_id]?.metric_color) || "#38bdf8";
  };

  /** The phase row, the search box and the collapse toggle, shared by both dossier views. */
  const renderFilterBar = (st: StakeholderDossierEntry, hiddenByFilter: number) => {
    const pagePhases = phasesOnPage(st);
    const nowLabel = phaseLabel(currentPhase, phases);
    const hasNowNotes = pagePhases.includes(currentPhase);
    return (
      <div className={styles.filterBar}>
        {pagePhases.length > 0 && (
          <div className={styles.phaseRow}>
            <button
              className={`${styles.phaseChip} ${styles.phaseChipNow} ${nowOnly ? styles.phaseChipOn : ""}`}
              onClick={() => setPhaseFilter(nowOnly ? new Set() : new Set([currentPhase]))}
              disabled={!hasNowNotes && !nowOnly}
              aria-pressed={nowOnly}
              title={
                nowOnly
                  ? "Show notes from every phase again"
                  : hasNowNotes
                    ? `Show only what you found in ${nowLabel}, the phase you are in`
                    : `Nothing found in ${nowLabel} yet`
              }
            >
              Now
            </button>
            {/* The dock has room for a word per phase; the full name is on the spine and in the tooltip. */}
            <div className={styles.phaseGroup}>
              {pagePhases.map((phase) => {
                const label = phaseLabel(phase, phases);
                const on = phaseFilter.has(phase);
                return (
                  <button
                    key={phase}
                    className={`${styles.phaseChip} ${on ? styles.phaseChipOn : ""}`}
                    onClick={() => togglePhase(phase)}
                    aria-pressed={on}
                    title={on ? `Stop filtering on ${label}` : `Show only what you found in ${label}`}
                  >
                    {phaseShortLabel(phase, phases)}
                  </button>
                );
              })}
            </div>
            {phaseFilterActive && (
              <button
                className={styles.phaseChipClear}
                onClick={() => setPhaseFilter(new Set())}
                title="Show notes from every phase again"
                aria-label="Show every phase"
              >
                <Icon icon="ph:x-bold" />
              </button>
            )}
          </div>
        )}
        <div className={styles.filterControls}>
          <label className={styles.searchBox}>
            <Icon icon="ph:magnifying-glass-bold" />
            <input
              type="search"
              value={search}
              placeholder="Search your notes"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className={styles.confFilters}>
            {([
              ["all", "ph:stack-bold", "All", "Everything you have written down"],
              ["unconfirmed", "ph:question-bold", "Unconfirmed", "You have not checked these yet. Wrong ones cost you in the room."],
              ["verified", "ph:check-circle-bold", "Verified", "You checked these yourself."],
              ["on_record", "ph:star-bold", "On record", "Said openly to the whole team. Nothing left to confirm."],
            ] as const).map(([key, icon, label, hint]) => (
              <button
                key={key}
                className={`${styles.confChip} ${confFilter === key ? styles.confChipOn : ""}`}
                onClick={() => setConfFilter(key)}
                title={`${label}: ${hint}`}
                aria-label={label}
              >
                <Icon icon={icon} />
                <span className={styles.confTip}>{label}</span>
              </button>
            ))}
          </div>
        </div>
        {hiddenByFilter > 0 && (
          <div className={styles.filterHint}>
            {hiddenByFilter} {hiddenByFilter === 1 ? "note is" : "notes are"} hidden by the phase row
            or the search box.
          </div>
        )}
      </div>
    );
  };

  const renderPageContent = (st: StakeholderDossierEntry) => {
    if (!st) return null;

    const allChains = toChains(st.intel_items || []);
    // Out of date / done chains sink to the bottom of the page, in their own category, so a
    // resolved note never sits ahead of one still open (D-dossier-resolved-section). Within each
    // bucket the environment page still reads stage by stage; a stakeholder page keeps whatever
    // order it already had (a stable sort, so this tie-break is a no-op there).
    const pageChains = visibleChains(st).sort((a, b) => {
      const aResolved = isResolvedStatus(a.newest.status) ? 1 : 0;
      const bResolved = isResolvedStatus(b.newest.status) ? 1 : 0;
      if (aResolved !== bResolved) return aResolved - bResolved;
      return st.is_challenge_intel ? (a.newest.stage_id || "~").localeCompare(b.newest.stage_id || "~") : 0;
    });
    const hiddenByFilter = allChains.length - pageChains.length;
    const hasIntelEntries = st && st.intel_items && st.intel_items.length > 0;
    const intelPips = getIntelPips(st);
    const hiddenIntelCount = intelPips.filter((status) => status === "hidden").length;
    const stObj = stakeholders[st.stakeholder_id];
    const avatar = stObj?.avatar;
    const stakeholderColor = getStakeholderColor(st);
    const emotionDisplay = stObj?.emotional_state || "neutral";
    const emotionColor =
      activeEmotionColors[emotionDisplay] ||
      activeEmotionColors[emotionDisplay.toLowerCase()] ||
      "#64748b";
    const powerDetail = `${(st.power || stObj?.power || "low").toUpperCase()} — ${
      (st.power || stObj?.power || "").toLowerCase() === "high" ? "strong authority" : "limited authority"
    }`;
    const interestDetail = `${(st.interest || stObj?.interest || "low").toUpperCase()} — ${
      (st.interest || stObj?.interest || "").toLowerCase() === "high" ? "closely engaged" : "loosely engaged"
    }`;

    return (
      <>
        {/* Only the wall of notes scrolls. The dock below it is a sibling of this
            box, not an item inside it, so it always ends up on the page's edge. */}
        <div className={styles.pageScroll}>
        {st.is_challenge_intel ? (
          <div className={styles.environmentHeader}>
            <Icon icon={intelTagMeta("fact").icon} className={styles.environmentIcon} />
            <div>
              <div className={styles.environmentTitle}>Challenge-Intel</div>
              <div className={styles.environmentSubtitle}>
                Facts about the system that were already on record when the challenge began.
              </div>
            </div>
          </div>
        ) : (
          <>
        {/* Header: Polaroid Snapshot Frame with Caption + Main Info */}
        <div className={styles.sketchbookHeader}>
          <div
            className={styles.polaroidFrame}
            onMouseEnter={() => setHoveredPolaroidStId(st.stakeholder_id)}
            onMouseLeave={() => setHoveredPolaroidStId(null)}
          >
            <div className={styles.sellotape} />
            <div className={styles.avatarBox}>
              <StakeholderAvatarComponent
                avatar={avatar}
                emotion={faceForEmotionState(emotionDisplay)}
                stakeholderColor={stakeholderColor}
                stakeholderId={st.stakeholder_id}
                isFramed={false}
                isSpeaking={speakingStakeholderId === st.stakeholder_id}
                play_blink_animation={false}
                size="100%"
                title={st.name}
                isHovered={hoveredPolaroidStId === st.stakeholder_id}
              />
            </div>
            <div className={styles.polaroidCaption}>
              <span
                className={styles.highlightMarker}
                style={{
                  background: `linear-gradient(180deg, transparent 48%, ${stakeholderColor}66 48%)`,
                }}
              >
                {st.name}
              </span>
            </div>
          </div>

          <div className={styles.stakeholderMainInfo}>
            <div className={styles.stakeholderRole}>
              <strong className={styles.fieldLabel}>Role:</strong>{" "}
              <GlossaryText
                text={st.role_description || "Project Stakeholder"}
                surface="dossier_profile"
              />
            </div>
            <div className={styles.stakeholderMetaRow}>
              <EmotionRevealBadge
                emotionDisplay={emotionDisplay}
                emotionColor={emotionColor}
                gatingInfo={stObj?.emotion_dimensions}
                fullDimensions={stObj?.emotion_dimensions_full}
              />
              <div
                className={styles.powerInterestBadge}
                tabIndex={0}
                aria-label={`Power: ${powerDetail}`}
                onMouseEnter={(e) => showInfoTag(e, "Power", powerDetail)}
                onMouseLeave={hideInfoTag}
                onFocus={(e) => showInfoTag(e, "Power", powerDetail)}
                onBlur={hideInfoTag}
              >
                <Icon
                  icon="ph:lightning-bold"
                  className={styles.metricIcon}
                  style={{
                    color: (st.power || stObj?.power || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                  }}
                />
                <span
                  style={{
                    color: (st.power || stObj?.power || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                    fontWeight: 700,
                  }}
                >
                  {(st.power || stObj?.power || "low").toUpperCase()}
                </span>
              </div>
              <div
                className={styles.powerInterestBadge}
                tabIndex={0}
                aria-label={`Interest: ${interestDetail}`}
                onMouseEnter={(e) => showInfoTag(e, "Interest", interestDetail)}
                onMouseLeave={hideInfoTag}
                onFocus={(e) => showInfoTag(e, "Interest", interestDetail)}
                onBlur={hideInfoTag}
              >
                <Icon
                  icon="ph:eye-bold"
                  className={styles.metricIcon}
                  style={{
                    color: (st.interest || stObj?.interest || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                  }}
                />
                <span
                  style={{
                    color: (st.interest || stObj?.interest || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                    fontWeight: 700,
                  }}
                >
                  {(st.interest || stObj?.interest || "low").toUpperCase()}
                </span>
              </div>
              {intelPips.length > 0 && (
                <div
                  className={styles.powerInterestBadge}
                  tabIndex={0}
                  aria-label={`Intel: ${describeIntelPips(intelPips)}`}
                  onMouseEnter={(e) => showInfoTag(e, "Intel", describeIntelPips(intelPips))}
                  onMouseLeave={hideInfoTag}
                  onFocus={(e) => showInfoTag(e, "Intel", describeIntelPips(intelPips))}
                  onBlur={hideInfoTag}
                >
                  <Icon icon="ph:push-pin-bold" className={`${styles.metricIcon} ${styles.intelBadgeInk}`} />
                  <span className={styles.intelPips}>
                    {intelPips.map((status, idx) => (
                      <span
                        key={idx}
                        className={`${styles.intelPip} ${INTEL_PIP_META[status].styleClass}`}
                        title={INTEL_PIP_META[status].label}
                      />
                    ))}
                  </span>
                  <span className={styles.intelBadgeInk} style={{ fontWeight: 700 }}>
                    {intelPips.length - hiddenIntelCount}/{intelPips.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Buy-In / Persuasion Breakdown Bar Card (Rendered during Pitch Debate when buyInInfoMap prop is provided) */}
        {(() => {
          const buyInInfo = buyInInfoMap ? (buyInInfoMap[st.stakeholder_id] || buyInInfoMap[st.name]) : undefined;
          if (!buyInInfo) return null;

          const totalPercent = Math.min(100, Math.max(0, Math.round(buyInInfo.total * 100)));
          const cardPercent = Math.min(60, Math.max(0, Math.round(buyInInfo.actionCardScore * 100)));
          const emotionPercent = Math.min(40, Math.max(0, Math.round(buyInInfo.emotionScore * 100)));
          const isBoundaryViolated = Boolean(buyInInfo.boundaryViolated);
          const isRevealed = buyInInfo.isRevealed ?? false;

          return (
            <div className={`${styles.buyInCard} ${!isRevealed ? styles.buyInCardBlurred : ""}`}>
              <div className={styles.buyInVerticalSpine}>
                <span className={styles.buyInVerticalText}>Buy-In</span>
              </div>
              <div className={`${styles.buyInMainBody} ${!isRevealed ? styles.buyInBlurredContent : ""}`}>
                {/* Top row: Label, Target & Status badge */}
                <div className={styles.buyInTopRow}>
                  <div className="d-flex align-items-center gap-2">
                    <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#1e293b" }}>
                      <EmojiIcon name="balanceScale" /> Buy-In Progress
                    </span>
                    <span
                      className={`badge ${isBoundaryViolated || buyInInfo.blocks ? "bg-danger" : buyInInfo.isPersuaded ? "bg-success" : "bg-warning text-dark"}`}
                      style={{ fontSize: "0.62rem" }}
                    >
                      {isBoundaryViolated ? (
                        <><EmojiIcon name="noEntry" /> Boundary Violated ({totalPercent}%)</>
                      ) : buyInInfo.blocks ? (
                        <><EmojiIcon name="noEntry" /> Resistant ({totalPercent}%)</>
                      ) : buyInInfo.isPersuaded ? (
                        <><EmojiIcon name="checkMark" /> Persuaded ({totalPercent}%)</>
                      ) : (
                        <><EmojiIcon name="warning" /> Wavering ({totalPercent}%)</>
                      )}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.65rem", color: "#64748b", fontWeight: 600 }}>
                    Blocks below: <strong>{Math.round(buyInInfo.threshold * 100)}%</strong>
                  </span>
                </div>

                {/* Stacked Progress Bar with Threshold Marker Notch */}
                <div className="progress position-relative" style={{ height: "16px", backgroundColor: "#e2e8f0", borderRadius: "4px" }}>
                  {/* Threshold Marker Notch */}
                  <div
                    style={{
                      position: "absolute",
                      left: `${Math.min(99, Math.max(1, buyInInfo.threshold * 100))}%`,
                      top: "-2px",
                      bottom: "-2px",
                      width: "3px",
                      backgroundColor: "#dc3545",
                      zIndex: 5,
                      borderRadius: "1px",
                    }}
                    title={`Required Threshold: ${Math.round(buyInInfo.threshold * 100)}%`}
                  />

                  {cardPercent > 0 && (
                    <div
                      className="progress-bar bg-primary"
                      role="progressbar"
                      style={{ width: `${cardPercent}%` }}
                      title={`Action Card Alignment: +${cardPercent}% (max 60%)`}
                    >
                      {cardPercent >= 10 && `+${cardPercent}%`}
                    </div>
                  )}
                  {emotionPercent > 0 && (
                    <div
                      className="progress-bar bg-success"
                      role="progressbar"
                      style={{ width: `${emotionPercent}%` }}
                      title={`Emotional State (${buyInInfo.currentEmotion || "neutral"}): +${emotionPercent}% (max 40%)`}
                    >
                      {emotionPercent >= 10 && `+${emotionPercent}%`}
                    </div>
                  )}
                </div>

                {/* Breakdown Legend Row */}
                <div className={styles.buyInLegendRow}>
                  <span><EmojiIcon name="cardJoker" /> Card: <b>{isBoundaryViolated ? "0% (Boundary Violated)" : `+${cardPercent}%`}</b></span>
                  <span><EmojiIcon name="emotion" /> Emotion: <b>+{emotionPercent}%</b></span>
                </div>
              </div>

              {!isRevealed && (
                <div className={styles.buyInLockOverlay}>
                  <Icon icon="ph:lock-simple-bold" style={{ fontSize: "0.85rem", color: "#475569" }} />
                  <span>Revealed when you assemble an action card</span>
                </div>
              )}
            </div>
          );
        })()}

          </>
        )}

        {/* Intelligence Section Header */}
        <div className={styles.sectionTitle}>
          <span className={styles.doodleIcon}></span>{" "}
          {st.is_challenge_intel ? "Facts by stage" : "Challenge-Specific Stance"}
          <span className={styles.sectionTitleActions}>
          <button
            className={`${styles.collapseToggle} ${collapseAddressed ? styles.collapseToggleOn : ""}`}
            onClick={() => setCollapseAddressed(!collapseAddressed)}
            title="Fold the notes somebody has already acted on down to one line each"
          >
            <Icon
              icon={collapseAddressed ? "ph:arrows-out-line-vertical-bold" : "ph:arrows-in-line-vertical-bold"}
            />
            <span>Collapse done</span>
          </button>
          </span>
        </div>

        {st.debug && (
          <div className={styles.debugPanel}>
            <button className={styles.debugPanelTitle} onClick={() => toggleDebug(`page-${st.stakeholder_id}`)}>
              <Icon icon="ph:bug-bold" /> Answer key (debug): {st.debug.missing_intel.length} not found yet
            </button>
            {openDebugId === `page-${st.stakeholder_id}` && (
              <>
                {st.debug.missing_intel.map((info) => (
                  <div key={info.id} className={styles.debugMissing}>
                    <DebugRequirement info={info} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* One card per refinement chain: the newest link is the headline (D24) */}
        {pageChains.length > 0 ? (
          <div className={styles.stickyNoteGrid}>
            {pageChains.map((chain, idx) => {
              const item = chain.newest;
              // The first resolved chain in the (now sorted) list opens its own category, below
              // whatever is still open for this challenge.
              const opensResolvedGroup =
                isResolvedStatus(item.status) &&
                (idx === 0 || !isResolvedStatus(pageChains[idx - 1].newest.status));
              const resolvedGroupTitle = opensResolvedGroup ? (
                <div key={`${st.stakeholder_id}-resolved-title`} className={styles.stageGroupTitle}>
                  Out of Date &amp; Done
                </div>
              ) : null;
              if (collapseAddressed && isResolvedStatus(item.status)) {
                const collapsedMeta = STATUS_META[item.status];
                return (
                  <React.Fragment key={`${st.stakeholder_id}-collapsed-wrap-${item.id}`}>
                    {resolvedGroupTitle}
                    <button
                      className={styles.collapsedNote}
                      onClick={() => setCollapseAddressed(false)}
                      title={`${collapsedMeta.title} Click to unfold every note again.`}
                    >
                      <Icon
                        icon={(CATEGORY_META[item.categorized_type || "driver"] || CATEGORY_META.driver).icon}
                        style={{ color: (CATEGORY_META[item.categorized_type || "driver"] || CATEGORY_META.driver).color }}
                      />
                      <span className={styles.collapsedText}>{item.description}</span>
                      <span className={`${styles.statusBadge} ${styles[collapsedMeta.styleClass]}`}>{collapsedMeta.label}</span>
                    </button>
                  </React.Fragment>
                );
              }
              const typeKey = item.categorized_type || "driver";
              const catMeta = CATEGORY_META[typeKey] || CATEGORY_META.driver;
              const noteId = item.id || `note-${idx}`;
              const noteConfidence = (item.intel_type || "unconfirmed").toLowerCase();
              const isUnconfirmed = noteConfidence === "unconfirmed";
              const canRetag = isUnconfirmed;
              // Split items carry a fact that holds still and a reading that changes with the tag:
              // bold the fact, italicise the reading while it is unconfirmed. Legacy items only have
              // one sentence, and the only span that reliably survives a re-tag is the name.
              const noteDescription = item.description || "";
              const hasSplit = Boolean(item.fact);
              const hasSubjectLead = Boolean(st.name) && noteDescription.startsWith(st.name);
              const noteSubject = hasSplit ? item.fact || "" : hasSubjectLead ? st.name : "";
              const noteReading = hasSplit
                ? ` ${item.reading || ""}`
                : hasSubjectLead
                ? noteDescription.slice(st.name.length)
                : noteDescription;
              const isPublicRecord = (item.source || "").toLowerCase() === "public_record";
              const hasArtifact = Boolean(
                item.artifact || (item.artifact_type && (item.source === "offline_artifact" || item.source === "public_record"))
              );
              const sourceCaption = getSourceCaption(item);
              // Paper colour matches the stamp: orange still open, blue public, green earned.
              const noteStatusClass = isUnconfirmed
                ? ""
                : isPublicRecord
                  ? styles.noteOnRecord
                  : styles.noteConfirmed;
              const isRetagging = canRetag && activeRetagNoteId === noteId;
              const isHighlighted = Boolean(
                highlightedIntelId &&
                (noteId === highlightedIntelId ||
                  item.id === highlightedIntelId ||
                  (item.description && item.description === highlightedIntelId))
              );
              const isNewIntel = pendingAppearKeys.has(`intel-${st.stakeholder_id}-${item.id}`);
              const isFadingOut = Boolean(
                !isHighlighted &&
                fadingOutIntelId &&
                (noteId === fadingOutIntelId ||
                  item.id === fadingOutIntelId ||
                  (item.description && item.description === fadingOutIntelId))
              );

              return (
                <React.Fragment key={`${st.stakeholder_id}-${noteId}`}>
                {resolvedGroupTitle}
                {/* On the environment page the cards arrive in stage order, so a divider is
                    enough to group them without a second grid. */}
                {st.is_challenge_intel &&
                  (idx === 0 || pageChains[idx - 1].newest.stage_id !== item.stage_id) && (
                    <div
                      className={styles.stageGroupTitle}
                      style={{ borderColor: stageMeta(item.stage_id).color, color: stageMeta(item.stage_id).color }}
                    >
                      {stageMeta(item.stage_id).label}
                    </div>
                  )}
                <div
                  key={`${st.stakeholder_id}-${noteId}`}
                  id={`intel-sticky-${noteId}`}
                  data-intel-id={item.id}
                  data-intel-description={item.description}
                  draggable={draggableIntel}
                  onDragStart={(e) => {
                    if (!draggableIntel) return;
                    // Same channel the engagement cards use, so the builder needs no library.
                    e.dataTransfer.setData("intelItemId", item.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`${styles.stickyNote} ${noteStatusClass} ${isRetagging ? styles.retagActive : ""} ${isHighlighted ? styles.highlightedStickyNote : ""} ${isFadingOut ? styles.fadingOutStickyNote : ""} ${isNewIntel ? styles.newStickyNote : ""}`}
                >
                  <span
                    className={styles.notePhaseSpine}
                    tabIndex={0}
                    aria-label={`Discovered during ${phaseLabel(item.discovered_phase_id, phases)}`}
                    onMouseEnter={(e) => showInfoTag(e, "Discovered during", phaseLabel(item.discovered_phase_id, phases))}
                    onMouseLeave={hideInfoTag}
                    onFocus={(e) => showInfoTag(e, "Discovered during", phaseLabel(item.discovered_phase_id, phases))}
                    onBlur={hideInfoTag}
                  >
                    <span className={styles.notePhaseName}>
                      {phaseLabel(item.discovered_phase_id, phases)}
                    </span>
                  </span>

                  {/* Header Row: Intel Type Badge on sticky note (Clickable to Re-tag only if unconfirmed) */}
                  <div className={styles.noteTopBar}>
                    <div className="d-flex align-items-center gap-1">
                      {canRetag ? (
                        <button
                          className={`${styles.noteCategoryTag} ${catMeta.styleClass}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveRetagNoteId(isRetagging ? null : noteId);
                          }}
                          aria-label={`${catMeta.label}: click to re-tag this intel item's category`}
                          onMouseEnter={(e) => showInfoTag(e, catMeta.label, "Click to re-tag")}
                          onMouseLeave={hideInfoTag}
                          onFocus={(e) => showInfoTag(e, catMeta.label, "Click to re-tag")}
                          onBlur={hideInfoTag}
                        >
                          <span className={styles.categoryBadgeContent}>
                            <Icon icon={catMeta.icon} style={{ color: catMeta.color }} /> {catMeta.label}
                          </span>
                          <span className={styles.reTagIconBtn} aria-label="Re-tag">
                            <Icon icon="ph:pencil-simple-bold" />
                          </span>
                        </button>
                      ) : (
                        <div
                          className={`${styles.categoryBadgeStatic} ${catMeta.styleClass}`}
                          tabIndex={0}
                          aria-label={`${catMeta.label}: category is locked once intel is confirmed/verified`}
                          onMouseEnter={(e) => showInfoTag(e, catMeta.label, "Locked once intel is confirmed/verified")}
                          onMouseLeave={hideInfoTag}
                          onFocus={(e) => showInfoTag(e, catMeta.label, "Locked once intel is confirmed/verified")}
                          onBlur={hideInfoTag}
                        >
                          <span className={styles.categoryBadgeContent}>
                            <Icon icon={catMeta.icon} style={{ color: catMeta.color }} /> {catMeta.label}
                          </span>
                        </div>
                      )}
                      {hasArtifact && onOpenArtifact && (
                        <button
                          type="button"
                          className={styles.artifactLinkBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenArtifact(item);
                          }}
                          aria-label="View associated artifact in Offline Intel Gathering"
                          onMouseEnter={(e) => showInfoTag(e, "View artifact", "Open in Offline Intel Gathering")}
                          onMouseLeave={hideInfoTag}
                          onFocus={(e) => showInfoTag(e, "View artifact", "Open in Offline Intel Gathering")}
                          onBlur={hideInfoTag}
                        >
                          <Icon icon="ph:link-bold" />
                        </button>
                      )}
                    </div>
                    <div className={styles.cardCornerStamp}>
                      {item.debug && (
                        <button
                          className={`${styles.debugToggle} ${
                            item.debug.correct_tag === item.categorized_type ? styles.debugRight : styles.debugWrong
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDebug(noteId);
                          }}
                          title={`Debug: true tag is ${item.debug.correct_tag}`}
                        >
                          <Icon icon="ph:bug-bold" />
                        </button>
                      )}
                      {item.debug && item.debug.artifact && (
                        <button
                          className={`${styles.debugToggle} ${
                            item.debug.artifact.humor_archetype ? styles.debugRight : styles.debugWrong
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDebug(noteId);
                          }}
                          title={
                            item.debug.artifact.humor_archetype
                              ? `Debug: humor applied (${item.debug.artifact.humor_archetype})`
                              : "Debug: no humor applied"
                          }
                        >
                          <Icon icon={item.debug.artifact.humor_archetype ? "ph:mask-happy-bold" : "ph:mask-happy"} />
                        </button>
                      )}
                      {item.status && STATUS_META[item.status] && (
                        <span
                          className={`${styles.statusBadge} ${styles[STATUS_META[item.status].styleClass]}`}
                          tabIndex={0}
                          aria-label={`${STATUS_META[item.status].label}: ${STATUS_META[item.status].title}`}
                          onMouseEnter={(e) => showInfoTag(e, STATUS_META[item.status].label, STATUS_META[item.status].title)}
                          onMouseLeave={hideInfoTag}
                          onFocus={(e) => showInfoTag(e, STATUS_META[item.status].label, STATUS_META[item.status].title)}
                          onBlur={hideInfoTag}
                        >
                          {STATUS_META[item.status].label}
                        </span>
                      )}
                      {renderRubberStamp(item.intel_type, isPublicRecord)}
                    </div>
                  </div>

                  {/* Interactive Re-tag Picker Popover */}
                  {isRetagging && (
                    <div className={styles.retagPopover} onClick={(e) => e.stopPropagation()}>
                      <div className={styles.retagPopoverTitle}>Re-tag intel stance category:</div>
                      <div className={styles.retagOptionsGrid}>
                        {Object.entries(CATEGORY_META).map(([typeOptKey, metaOpt]) => (
                          <button
                            key={typeOptKey}
                            className={`${styles.retagOptionBtn} ${typeOptKey === typeKey ? styles.activeOptionBtn : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReTagIntel(item.id, typeOptKey);
                            }}
                          >
                            <Icon icon={metaOpt.icon} style={{ color: metaOpt.color }} /> {metaOpt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {item.debug && openDebugId === noteId && (
                    <div className={styles.debugPanel} onClick={(e) => e.stopPropagation()}>
                      <div className={styles.debugPanelTitle}>Answer key (debug)</div>
                      <DebugRequirement info={item.debug} playerTag={typeKey} />
                    </div>
                  )}

                  <div className={styles.intelBody}>
                    <div className={styles.intelText}>
                      "
                      {typeKey === "trade_off" ? (
                        renderHighlightedTradeOffText(item, isUnconfirmed, st.name)
                      ) : (
                        <>
                          {noteSubject && <strong className={styles.intelSubject}>{noteSubject}</strong>}
                          {isUnconfirmed ? (
                            <em className={styles.intelReading}>
                              <GlossaryText text={noteReading} surface="intel_notes" />
                            </em>
                          ) : (
                            <GlossaryText text={noteReading} surface="intel_notes" />
                          )}
                        </>
                      )}
                      "
                    </div>
                    {sourceCaption && (
                      <div
                        className={`${styles.intelSourceCaption} ${hasArtifact && onOpenArtifact ? styles.intelSourceCaptionClickable : ""}`}
                        tabIndex={0}
                        aria-label={`${sourceCaption.text}: ${sourceCaption.title}${
                          hasArtifact && onOpenArtifact ? " (Click to view artifact)" : ""
                        }`}
                        onMouseEnter={(e) =>
                          showInfoTag(
                            e,
                            sourceCaption.text,
                            hasArtifact && onOpenArtifact ? `${sourceCaption.title} Click to view artifact.` : sourceCaption.title
                          )
                        }
                        onMouseLeave={hideInfoTag}
                        onFocus={(e) =>
                          showInfoTag(
                            e,
                            sourceCaption.text,
                            hasArtifact && onOpenArtifact ? `${sourceCaption.title} Click to view artifact.` : sourceCaption.title
                          )
                        }
                        onBlur={hideInfoTag}
                        onClick={hasArtifact && onOpenArtifact ? (e) => {
                          e.stopPropagation();
                          onOpenArtifact(item);
                        } : undefined}
                      >
                        <Icon icon={sourceCaption.icon} className={styles.intelSourceIcon} />
                        <span>{sourceCaption.text}</span>
                        {hasArtifact && onOpenArtifact && (
                          <Icon icon="ph:arrow-square-out-bold" className={styles.intelSourceLinkIcon} />
                        )}
                      </div>
                    )}
                    {/* The layers this reading grew out of, newest first, so the card gets taller
                        the longer the player has been working on the same note (D24). */}
                    {chain.older.length > 0 && (
                      <div className={styles.chainStack}>
                        {[...chain.older].reverse().map((link) => (
                          <div key={link.id} className={styles.chainLayer}>
                            <span className={styles.chainLayerPhase}>
                              {phaseLabel(link.discovered_phase_id, phases)}
                            </span>
                            <span>"{link.description}"</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(item.locked_links || 0) > 0 && (
                      <div
                        className={styles.lockedRow}
                        tabIndex={0}
                        aria-label="More to learn: keep digging in the phases ahead."
                        onMouseEnter={(e) => showInfoTag(e, "More to learn", "Keep digging in the phases ahead.")}
                        onMouseLeave={hideInfoTag}
                        onFocus={(e) => showInfoTag(e, "More to learn", "Keep digging in the phases ahead.")}
                        onBlur={hideInfoTag}
                      >
                        <Icon icon="ph:lock-simple-bold" className={styles.lockedIcon} />
                        <span>
                          {item.locked_links === 1
                            ? "1 more layer of this note is still out there"
                            : `${item.locked_links} more layers of this note are still out there`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                </React.Fragment>
              );
            })}
            {hiddenIntelCount > 0 && (
              <div
                className={`${styles.ghostNote} ${hiddenIntelCount > 1 ? styles.ghostNoteStacked : ""}`}
                tabIndex={0}
                aria-label="Not found yet: their pips stay hollow until you do."
                onMouseEnter={(e) => showInfoTag(e, "Not found yet", "Their pips stay hollow until you do.")}
                onMouseLeave={hideInfoTag}
                onFocus={(e) => showInfoTag(e, "Not found yet", "Their pips stay hollow until you do.")}
                onBlur={hideInfoTag}
              >
                <Icon icon="ph:magnifying-glass-bold" className={styles.ghostNoteIcon} />
                <span>
                  {hiddenIntelCount === 1
                    ? `1 more note about ${st.name} is still out there`
                    : `${hiddenIntelCount} more notes about ${st.name} are still out there`}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyStateCard}>
              <div className={styles.paperclip} />
              <div className={styles.emptyStateTitle}>
                {hasIntelEntries ? (
                  <><EmojiIcon name="searchGlass" /> Nothing Matches These Filters</>
                ) : (
                  <><EmojiIcon name="actionItems" /> No Field Intelligence Collected Yet</>
                )}
              </div>
              <div className={styles.emptyStateText}>
                {hasIntelEntries ? (
                  <>Your notes on <strong>{st.name}</strong> are all filtered out right now.</>
                ) : (
                  <>No interview notes, requirements, or personal stances recorded for <strong>{st.name}</strong>.</>
                )}
              </div>
              <div className={styles.emptyStateHint}>
                {hasIntelEntries ? (
                  <><EmojiIcon name="tip" /> <em>Clear the stage row or the search box below to see them again.</em></>
                ) : (
                  <><EmojiIcon name="tip" /> <em>Participate in Intel Gathering activities to uncover and verify their hidden constraints.</em></>
                )}
              </div>
            </div>
          </div>
        )}

        </div>

        {/* The filter strip is the foot of the page: last item in the page column,
            below the scrolling wall, so it never covers a note. */}
        <div className={styles.filterDock}>{renderFilterBar(st, hiddenByFilter)}</div>
      </>
    );
  };

  const activeStakeholder = effectiveDossierData[currentPageIndex] || effectiveDossierData[0];

  // System button badge: how much of what you've worked out about the pipeline itself is
  // actually found, the same found/total the page's own pip row shows.
  const systemPips = challengeIntelIndex >= 0 ? getIntelPips(effectiveDossierData[challengeIntelIndex]) : [];
  const systemFoundCount = systemPips.filter((status) => status !== "hidden").length;

  // Performance button badge: the same overall health bucket PerformanceDashboard shows, as a dot
  // rather than a count - it's a state, not a tally.
  const systemHealthBucket = healthBucket(systemHealth);

  // The margin-note hint pointing at the header buttons only earns its keep if there is
  // something for it to point at - a dossier with none of these handlers wired up has no
  // button group to find.
  const hasHeaderTools = Boolean(
    onOpenPhaseBriefing || onPerformanceToggle || challengeIntelIndex >= 0 || onLogToggle || onSettingsToggle
  );

  if (!isOpen && !isEmbedded) return null;

  const windowContent = (
    <div
      ref={windowRef}
      className={styles.sketchbookWindow}
      style={
        isEmbedded
          ? {
            position: "relative",
            top: "0px",
            left: "0px",
            width: "100%",
            height: "100%",
            maxWidth: "100%",
            maxHeight: "100%",
          }
          : {
            top: `${Math.max(10, position.y)}px`,
            left: `${Math.max(10, position.x)}px`,
          }
      }
    >
      {/* Header Drag Handle */}
      <div className={styles.binderHeader} onMouseDown={isEmbedded ? undefined : handleMouseDown}>
        <div className={styles.binderTitle}>
          <Icon icon="ph:address-book-tabs-duotone" className={styles.binderTitleIcon} />
          STAKEHOLDER DOSSIER
        </div>
        <div className={styles.headerControls}>
          {hasHeaderTools && (
            <div className={styles.headerHint} aria-hidden="true">
              More info <Icon icon="ph:arrow-right-bold" className={styles.headerHintArrow} />
            </div>
          )}
          <div className={styles.headerButtonGroup}>
            {onOpenPhaseBriefing && (
              <HeaderIconButton
                icon="ph:projector-screen-chart-bold"
                label="Phase Briefing"
                detail={"Objectives & current challenge\nStakeholder power & interest radar"}
                ariaLabel="Briefing: reopen the phase briefing — objectives, current challenge, and the stakeholder power & interest radar"
                onClick={onOpenPhaseBriefing}
              />
            )}
            {onPerformanceToggle && (
              <HeaderIconButton
                icon="ph:gauge-bold"
                label="Performance"
                detail={systemHealth !== undefined ? `Health: ${HEALTH_BUCKET_WORD[systemHealthBucket]}` : undefined}
                ariaLabel={
                  isPerformanceOpen
                    ? "Performance: close"
                    : `Performance: open — gameplay metrics and the project pipeline. System health: ${HEALTH_BUCKET_WORD[systemHealthBucket]}`
                }
                active={isPerformanceOpen}
                onClick={onPerformanceToggle}
                badge={
                  systemHealth !== undefined ? (
                    <span
                      className={styles.headerBadgeDot}
                      style={{ background: healthBucketColor(systemHealthBucket) }}
                    />
                  ) : undefined
                }
              />
            )}
            {challengeIntelIndex >= 0 && (
              <HeaderIconButton
                icon={intelTagMeta("fact").icon}
                label="Challenge-Intel"
                detail={systemPips.length > 0 ? describeIntelPips(systemPips) : undefined}
                ariaLabel={`Challenge-Intel: facts about the system already on record at the start of the challenge — ${describeIntelPips(systemPips)}`}
                active={currentPageIndex === challengeIntelIndex}
                onClick={() => requestPageChange(currentPageIndex === challengeIntelIndex ? lastPersonPage.current : challengeIntelIndex)}
                badge={
                  systemPips.length > 0 ? (
                    <span className={styles.headerBadgeCount}>
                      {systemFoundCount}/{systemPips.length}
                    </span>
                  ) : undefined
                }
              />
            )}
            {onLogToggle && (
              <HeaderIconButton
                icon="ph:scroll-bold"
                label="Log"
                ariaLabel={isLogOpen ? "Log: close event log" : "Log: open — what's been filed and verified so far"}
                active={isLogOpen}
                onClick={onLogToggle}
                badge={Boolean(logCount) ? <span className={styles.headerBadgeCount}>{logCount}</span> : undefined}
              />
            )}
            {onSettingsToggle && (
              <HeaderIconButton
                icon="ph:gear-six-bold"
                label="Settings"
                ariaLabel={isSettingsOpen ? "Settings: close" : "Settings: open"}
                active={isSettingsOpen}
                onClick={onSettingsToggle}
              />
            )}
            <HeaderIconButton
              icon="ph:question-bold"
              label="Cheat Sheet"
              detail="Quick reference for every phase, and a Report Bug tab"
              ariaLabel="Cheat Sheet: quick reference for every phase, in plain language, and a Report Bug tab"
              active={isCheatSheetOpen}
              onClick={() => setIsCheatSheetOpen(true)}
            />
          </div>
          <div className={styles.headerArrowGroup}>
            <HeaderIconButton
              icon="ph:caret-left-bold"
              label="Previous Stakeholder"
              ariaLabel={currentPageIndex <= 0 ? "Previous stakeholder: none, this is the first" : "Previous Stakeholder (←)"}
              disabled={currentPageIndex <= 0}
              onClick={() => requestPageChange(currentPageIndex - 1)}
              buttonClassName={styles.topNavArrow}
            />
            <HeaderIconButton
              icon="ph:caret-right-bold"
              label="Next Stakeholder"
              ariaLabel={currentPageIndex >= totalPages - 1 ? "Next stakeholder: none, this is the last" : "Next Stakeholder (→)"}
              disabled={currentPageIndex >= totalPages - 1}
              onClick={() => requestPageChange(currentPageIndex + 1)}
              buttonClassName={styles.topNavArrow}
            />
          </div>
          {canClose && (
            <button className={styles.closeButton} onClick={onClose} title="Close Sketchbook">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Shared flip-down tag for the stakeholder tabs and the power/interest/intel badges -
          see the note on the infoTag state above for why this is one portal, not one per anchor. */}
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

      {/* Physical Bookmark Tabs (Top Bar) */}
      {effectiveDossierData.length > 0 && (
        <div className={styles.tabsContainer}>
          {effectiveDossierData.map((st, idx) => {
            // The environment is not a person, so it is not in the tab strip (D45).
            if (st.is_challenge_intel) return null;
            const stColor = getStakeholderColor(st);
            const stObj = stakeholders[st.stakeholder_id];
            const emotion = stObj?.emotional_state || "neutral";
            const emotionColor =
              activeEmotionColors[emotion] ||
              activeEmotionColors[emotion.toLowerCase()] ||
              "#64748b";
            const isActive = idx === currentPageIndex;
            const isHighPower = (st.power || stObj?.power || "").toLowerCase() === "high";
            const isHighInterest = (st.interest || stObj?.interest || "").toLowerCase() === "high";
            const keyPlayerHint = [
              isHighPower ? "High power" : null,
              isHighInterest ? "High interest" : null,
            ].filter(Boolean).join(", ");

            // New and shifted are mutually exclusive: shifted needs a previous
            // reading to compare against, new means there wasn't one.
            const change = dismissedChangeIds.has(st.stakeholder_id)
              ? undefined
              : phaseChanges.get(st.stakeholder_id);
            const isPulsingChange = Boolean(change && pulsingChangeIds.has(st.stakeholder_id));
            const changeHint = change
              ? change.isNew
                ? "New this phase"
                : `Shifted this phase${change.shiftText ? `: ${change.shiftText}` : ""}`
              : "";
            const tabPips = getIntelPips(st);
            const tabFoundCount = tabPips.filter((status) => status !== "hidden").length;
            // Stakeholder names are authored "<role/category> <given name>" (e.g. "Requirements
            // Reuben"): split on the first space so the tab always breaks there, on its own two
            // lines, rather than wherever the browser happens to wrap a too-narrow single line.
            const [tabRoleWord, ...tabGivenNameWords] = st.name.split(" ");
            const tabGivenName = tabGivenNameWords.join(" ");
            const tabTagDetail = [
              `Emotional State: ${emotion}`,
              keyPlayerHint || null,
              changeHint || null,
              tabPips.length > 0 ? `Intel: ${describeIntelPips(tabPips)}` : null,
            ].filter(Boolean).join("\n");

            return (
              <button
                key={st.stakeholder_id || idx}
                ref={idx === currentPageIndex ? activeTabRef : null}
                className={`${styles.tabButton} ${isActive ? styles.activeTab : ""}`}
                onClick={() => requestPageChange(idx)}
                aria-label={`${st.name}: ${tabTagDetail}`}
                onMouseEnter={(e) => showInfoTag(e, st.name, tabTagDetail)}
                onMouseLeave={hideInfoTag}
                onFocus={(e) => showInfoTag(e, st.name, tabTagDetail)}
                onBlur={hideInfoTag}
                style={
                  {
                    "--tab-color": stColor,
                    "--emotion-color": emotionColor,
                  } as React.CSSProperties
                }
              >
                {change && (
                  <span
                    className={`${styles.tabChangeBadge} ${
                      change.isNew ? styles.tabChangeBadgeNew : styles.tabChangeBadgeShifted
                    } ${isPulsingChange ? styles.tabChangeBadgePulsing : ""}`}
                  >
                    {change.isNew ? "NEW" : "SHIFTED"}
                  </span>
                )}
                {tabPips.length > 0 && (
                  <span className={styles.tabIntelCountBadge} title={describeIntelPips(tabPips)}>
                    {tabFoundCount}/{tabPips.length}
                  </span>
                )}
                <span className={styles.tabName}>
                  {tabGivenName ? (
                    <>
                      <span className={styles.tabNameLine}>{tabRoleWord}</span>
                      <span className={styles.tabNameLine}>{tabGivenName}</span>
                    </>
                  ) : (
                    <span className={styles.tabNameLine}>{tabRoleWord}</span>
                  )}
                </span>
                <div className={styles.tabEmotionRow}>
                  <Icon
                    icon={iconForEmotionState(emotion)}
                    className={styles.tabEmotionIcon}
                  />
                  <span className={styles.tabEmotionLabel} title={`Emotional State: ${emotion}`}>
                    {emotion}
                  </span>
                  {isHighPower && (
                    <span
                      className={styles.tabKeyFlag}
                      title="High power: strong authority"
                    >
                      <Icon icon="ph:lightning-fill" className={styles.tabKeyFlagIcon} />
                    </span>
                  )}
                  {isHighInterest && (
                    <span
                      className={styles.tabKeyFlag}
                      title="High interest: closely engaged"
                    >
                      <Icon icon="ph:eye-fill" className={styles.tabKeyFlagIcon} />
                    </span>
                  )}
                </div>
                {tabPips.length > 0 && (
                  <span className={styles.tabIntelBar} aria-hidden="true">
                    {/* Every segment renders, even at zero width, so a stamp change animates */}
                    {INTEL_PIP_ORDER.filter((status) => status !== "hidden").map((status) => (
                      <span
                        key={status}
                        className={`${styles.tabIntelBarFill} ${INTEL_PIP_META[status].styleClass}`}
                        style={{
                          width: `${(tabPips.filter((p) => p === status).length / tabPips.length) * 100}%`,
                        }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Notebook Binding Container */}
      <div className={styles.notebookBindingContainer}>
        {/* Paper Canvas */}
        <div className={styles.flipBookWrapper}>
          <div className={styles.pageBase} key={currentPageIndex}>
            {renderPageContent(activeStakeholder)}
          </div>
        </div>
      </div>
    </div>
  );

  const cheatSheet = (
    <CheatSheetModal
      isOpen={isCheatSheetOpen}
      onClose={() => setIsCheatSheetOpen(false)}
      activeSectionTitle={cheatSheetActiveSection}
      username={username}
      currentPhase={currentPhase}
      currentChallenge={currentChallenge}
    />
  );

  if (isEmbedded) {
    return (
      <div style={{ width: "100%", height: "100%", minHeight: "450px", position: "relative", pointerEvents: "auto" }}>
        {windowContent}
        {cheatSheet}
      </div>
    );
  }

  return (
    <div className={styles.dossierOverlay}>
      {windowContent}
      {cheatSheet}
    </div>
  );
}
