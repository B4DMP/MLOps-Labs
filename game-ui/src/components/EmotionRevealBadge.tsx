import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import styles from "./StakeholderDossier.module.css";
import type { EmotionGatingInfo, EmotionGatingDimension } from "./StakeholderProvider";
import { iconForEmotionState } from "../utils/emotionFace";
import HoverTooltip from "./HoverToolTip";

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
    <HoverTooltip description={hasReveal ? undefined : `Emotional State: "${emotionDisplay}"`}>
    <div
      ref={anchorRef}
      className={`${styles.powerInterestBadge} ${styles.emotionBadge}`}
      tabIndex={hasReveal ? 0 : undefined}
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
          className={styles.emotionMicroTicks}
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
              <span key={idx} className={styles.emotionMicroTick}>
                <span
                  className={`${styles.emotionMicroTickFill} ${
                    !isCurrent ? styles.emotionMicroTickNotch : `${levelClass} ${meta.fillClass}`
                  }`}
                />
              </span>
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
    </HoverTooltip>
  );
};

export default EmotionRevealBadge;
