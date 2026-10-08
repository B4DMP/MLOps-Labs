import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { EmojiIcon } from "../utils/emojiIcons";
import styles from "./BuyInMeter.module.css";

export type BuyInBand = "very_low" | "low" | "medium" | "high" | "very_high";
export type BuyInTone = "resistant" | "wavering" | "persuaded";

// The meter renders from `band` alone; every other field only feeds the hover card.
export interface StakeholderBuyInInfo {
  band?: BuyInBand;
  /** Impatience step from the server (0 clears the tag). */
  impatience?: number;
  /** How well the card meets their demands, -1 to 1. */
  alignment?: number;
  /** Mood, 0 (bad) to 1 (good). */
  emotions?: number;
  /** Buy-in (0 to 1) below which they veto (high power) or object (low). */
  threshold?: number;
  power?: string;
  total?: number;
  isPersuaded?: boolean;
  // High power vetoes, low power only objects.
  blocks?: boolean;
  currentEmotion?: string;
  boundaryViolated?: boolean;
  isRevealed?: boolean;
}

export const BUY_IN_BAND_META: Record<BuyInBand, { label: string; stance: string; notches: number }> = {
  very_low: { label: "Very low", stance: "Against you", notches: 1 },
  low: { label: "Low", stance: "Leaning against", notches: 2 },
  medium: { label: "Medium", stance: "On the fence", notches: 3 },
  high: { label: "High", stance: "Leaning your way", notches: 4 },
  very_high: { label: "Very high", stance: "Fully behind you", notches: 5 },
};
const BUY_IN_ORDER: BuyInBand[] = ["very_low", "low", "medium", "high", "very_high"];

// Band wins; the old flags only fill in when the server sent no band.
export const resolveBuyIn = (info: StakeholderBuyInInfo): { band: BuyInBand; tone: BuyInTone } => {
  const band: BuyInBand =
    info.band ?? (info.blocks ? "low" : info.isPersuaded ? "high" : "medium");
  const tone: BuyInTone =
    info.boundaryViolated || info.blocks || band === "very_low" || band === "low"
      ? "resistant"
      : band === "medium"
      ? "wavering"
      : "persuaded";
  return { band, tone };
};

type ReasonDir = "up" | "down" | "flat";
const REASON_GLYPH: Record<ReasonDir, string> = { up: "▲", down: "▼", flat: "•" };

const fitReason = (alignment: number): { dir: ReasonDir; text: string } =>
  alignment < -0.33
    ? { dir: "down", text: "Your proposal goes against what they asked for" }
    : alignment < 0.33
    ? { dir: "flat", text: "Your proposal meets only part of what they asked for" }
    : { dir: "up", text: "Your proposal meets most of what they asked for" };

const moodReason = (emotions: number, feeling?: string): { dir: ReasonDir; text: string } => {
  const feel = feeling?.toLowerCase();
  const word = feel && feel !== "neutral" ? ` (${feel})` : "";
  return emotions < 0.4
    ? { dir: "down", text: `They are in a bad mood${word}` }
    : emotions <= 0.6
    ? { dir: "flat", text: `Their mood is neutral${word}` }
    : { dir: "up", text: `They are in a good mood${word}` };
};

const NEXT_STEP: Record<BuyInTone, string> = {
  resistant: "Rework the proposal toward what they asked for, or ease their mood.",
  wavering: "Close. A better fit or a calmer mood tips them.",
  persuaded: "Good for now. Don't cross them.",
};

const EDGE_MARGIN = 8;

const Reason: React.FC<{ dir: ReasonDir; text: string }> = ({ dir, text }) => (
  <li className={styles[`reason_${dir}`]}>
    <span className={styles.reasonGlyph}>{REASON_GLYPH[dir]}</span> {text}
  </li>
);

const Notches: React.FC<{ filled: number; tone: BuyInTone; threshold?: number }> = ({
  filled,
  tone,
  threshold,
}) => (
  <span className={styles.notches}>
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} className={`${styles.notch} ${n <= filled ? styles[`notchOn_${tone}`] : ""}`} />
    ))}
    {threshold !== undefined && (
      <span className={styles.line} style={{ left: `${threshold * 100}%` }} aria-hidden="true" />
    )}
  </span>
);

/**
 * One compact row: five notches and a stance pill. Hovering or focusing it opens a card with
 * the reasons and the veto line. The card is portaled to document.body for the same stacking
 * reason as the emotion badge: dossier notes are tilted and form their own stacking contexts.
 */
const BuyInMeter: React.FC<{ info: StakeholderBuyInInfo }> = ({ info }) => {
  const { band, tone } = resolveBuyIn(info);
  const meta = BUY_IN_BAND_META[band];
  const isBoundaryViolated = Boolean(info.boundaryViolated);
  const isRevealed = info.isRevealed ?? false;
  const prevBand = useRef<BuyInBand | null>(null);
  const [move, setMove] = useState<{ dir: "up" | "down"; from: string } | null>(null);

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
      setCoords({ top: rect.bottom + EDGE_MARGIN, left: rect.left + rect.width / 2 });
    }
    setShow(true);
  };
  // Short delay so the pointer can cross the gap into the card without closing it.
  const handleHide = () => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => setShow(false), 200);
  };
  const handleBlur = () => {
    clearHideTimeout();
    setShow(false);
  };
  useEffect(() => clearHideTimeout, []);

  // Flip above the row when the card would run off the bottom; keep it inside the viewport.
  useLayoutEffect(() => {
    if (!show || !cardRef.current || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const box = cardRef.current.getBoundingClientRect();
    let top = anchor.bottom + EDGE_MARGIN;
    if (top + box.height > window.innerHeight - EDGE_MARGIN) {
      const above = anchor.top - EDGE_MARGIN - box.height;
      top =
        above >= EDGE_MARGIN
          ? above
          : Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN - box.height);
    }
    const half = box.width / 2;
    const left = Math.min(
      Math.max(anchor.left + anchor.width / 2, EDGE_MARGIN + half),
      window.innerWidth - EDGE_MARGIN - half
    );
    setCoords((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
  }, [show]);

  useEffect(() => {
    if (!isRevealed) {
      prevBand.current = null;
      setMove(null);
      setShow(false);
      return;
    }
    const prev = prevBand.current;
    if (prev && prev !== band) {
      setMove({
        dir: BUY_IN_ORDER.indexOf(band) > BUY_IN_ORDER.indexOf(prev) ? "up" : "down",
        from: BUY_IN_BAND_META[prev].stance,
      });
    }
    prevBand.current = band;
  }, [band, isRevealed]);

  const filled = isRevealed && !isBoundaryViolated ? meta.notches : 0;
  const stanceText = isBoundaryViolated ? "Line crossed" : meta.stance;
  const stanceTone = isBoundaryViolated ? "resistant" : tone;
  const moveText = move ? `${move.dir === "up" ? "Warmer" : "Cooler"} than before (${move.from})` : "";

  return (
    <div className={styles.meter}>
      <div
        ref={anchorRef}
        className={`${styles.row} ${isRevealed ? styles.rowLive : ""}`}
        tabIndex={isRevealed ? 0 : undefined}
        aria-label={isRevealed ? `Where they stand: ${stanceText}` : undefined}
        onMouseEnter={isRevealed ? handleShow : undefined}
        onMouseLeave={isRevealed ? handleHide : undefined}
        onFocus={isRevealed ? handleShow : undefined}
        onBlur={isRevealed ? handleBlur : undefined}
      >
        <span className={styles.title}>
          <EmojiIcon name="balanceScale" /> Where they stand
        </span>
        <span
          className={styles.notchesWrap}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={filled}
          aria-valuetext={isRevealed ? stanceText : "Not yet revealed"}
        >
          <Notches filled={filled} tone={tone} threshold={info.threshold} />
        </span>
        {isRevealed ? (
          <>
            {move && (
              <span className={move.dir === "up" ? styles.moveUp : styles.moveDown} title={moveText}>
                {move.dir === "up" ? "▲" : "▼"}
              </span>
            )}
            <span className={`${styles.stance} ${styles[`stance_${stanceTone}`]}`}>{stanceText}</span>
          </>
        ) : (
          <span className={styles.stancePending}>
            <Icon icon="ph:lock-simple-bold" /> Pick a card to see
          </span>
        )}
      </div>
      {isRevealed &&
        show &&
        createPortal(
          <div
            className={styles.cardAnchor}
            style={{ top: `${coords.top}px`, left: `${coords.left}px`, transform: "translateX(-50%)" }}
            onMouseEnter={handleShow}
            onMouseLeave={handleHide}
          >
            <div ref={cardRef} className={styles.card} role="tooltip">
              {info.threshold !== undefined && (
                <div className={styles.lineNote}>
                  <span className={styles.lineSwatch} />
                  {info.power === "high"
                    ? "Their line. Stay above it or they veto the plan."
                    : "Their line. Stay above it or they object, though the plan can still pass."}
                </div>
              )}
              <ul className={styles.reasons}>
                {isBoundaryViolated && <Reason dir="down" text="A line of theirs is crossed, whatever else you offer" />}
                {info.alignment !== undefined && <Reason {...fitReason(info.alignment)} />}
                {info.emotions !== undefined && <Reason {...moodReason(info.emotions, info.currentEmotion)} />}
                {Boolean(info.impatience) && <Reason dir="down" text="They are tired of hearing the same problem again" />}
                {move && <Reason dir={move.dir} text={moveText} />}
              </ul>
              <div className={styles.hint}>{NEXT_STEP[tone]}</div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default BuyInMeter;
