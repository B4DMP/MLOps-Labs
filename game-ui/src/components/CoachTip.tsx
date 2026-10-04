import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import OnceIcon from "./Results/OnceIcon";
import magnifier from "./Results/icons/magnifier.json";
import puzzleSquare from "./Results/icons/puzzle-square.json";
import warningTriangle from "./Results/icons/warning-triangle.json";
import avatarsChatting from "./Results/icons/avatars-chatting.json";
import radioWalkieTalkie from "./Results/icons/radio-walkie-talkie.json";
import eye from "./Results/icons/eye.json";
import scaleRetro from "./Results/icons/scale-retro.json";
import handsApplause from "./Results/icons/hands-applause.json";
import layers from "./Results/icons/layers.json";
import listRules from "./Results/icons/list-rules.json";
import { COACH_EYEBROW } from "../content/helpCopy";
import styles from "./CoachTip.module.css";

/** Hero icon per hint (documented in docs/plans/lordicon-icons.md). */
export const COACH_ICONS = {
  verify: magnifier,
  verifyRight: puzzleSquare,
  verifyWrong: warningTriangle,
  talk: avatarsChatting,
  ask: radioWalkieTalkie,
  reveal: eye,
  deck: scaleRetro,
  reactions: handsApplause,
  warning: warningTriangle,
  canvas: layers,
  dials: listRules,
  pickNode: magnifier,
  pickOption: puzzleSquare,
  governance: listRules,
  feeds: eye,
  slots: scaleRetro,
} as const;

export type CoachIconKey = keyof typeof COACH_ICONS;

export interface CoachTipProps {
  title?: string;
  body: ReactNode;
  /** "mistake" is the amber heads-up (silent), "guide" the friendly teal suggestion. */
  tone?: "mistake" | "guide";
  /** Hero icon; mistake tips default to the warning triangle. */
  icon?: CoachIconKey;
  /** Element or CSS selector to point at. Missing or not found: the tip sits at the bottom centre. */
  anchor?: HTMLElement | string | null;
  /** Rings the anchor while the tip is open (the ring never captures clicks). */
  spotlight?: boolean;
  dismissLabel?: string;
  /** Omit for a tip that closes only when its owner removes it (a wait-for-action step). */
  onDismiss?: () => void;
  /** Quieter second button, e.g. "Skip the guide" next to "Skip this step". */
  secondaryLabel?: string;
  onSecondary?: () => void;
  children?: ReactNode;
}

const MARGIN = 12;
const EDGE = 6;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function resolveAnchor(anchor: CoachTipProps["anchor"]): HTMLElement | null {
  if (!anchor) return null;
  if (typeof anchor !== "string") return anchor.isConnected ? anchor : null;
  try {
    return document.querySelector<HTMLElement>(anchor);
  } catch {
    return null;
  }
}

/** Picks a spot for the tip: below, above, right, left of the target, else bottom centre. */
export function placeTip(
  box: { width: number; height: number },
  target: Rect | null,
  vw: number,
  vh: number,
): { top: number; left: number } {
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), vw - box.width - EDGE);
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), vh - box.height - EDGE);
  if (!target || (target.width === 0 && target.height === 0)) {
    return { top: Math.round(clampY(vh - box.height - 24)), left: Math.round(clampX((vw - box.width) / 2)) };
  }
  const centerX = target.left + target.width / 2 - box.width / 2;
  const centerY = target.top + target.height / 2 - box.height / 2;
  const below = target.top + target.height + MARGIN;
  const above = target.top - box.height - MARGIN;
  const right = target.left + target.width + MARGIN;
  const left = target.left - box.width - MARGIN;
  let pos: { top: number; left: number };
  if (below + box.height <= vh - EDGE) pos = { top: below, left: clampX(centerX) };
  else if (above >= EDGE) pos = { top: above, left: clampX(centerX) };
  else if (right + box.width <= vw - EDGE) pos = { top: clampY(centerY), left: right };
  else if (left >= EDGE) pos = { top: clampY(centerY), left };
  else pos = { top: clampY(vh - box.height - 24), left: clampX(centerX) };
  return { top: Math.round(pos.top), left: Math.round(pos.left) };
}

/** Small popover with a springy entrance. It never narrates; the pitch screen owns the voice. */
export default function CoachTip({
  title,
  body,
  tone = "guide",
  icon,
  anchor,
  spotlight = false,
  dismissLabel = "Got it",
  onDismiss,
  secondaryLabel,
  onSecondary,
  children,
}: CoachTipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [ring, setRing] = useState<Rect | null>(null);
  const heroKey: CoachIconKey | undefined = icon ?? (tone === "mistake" ? "warning" : undefined);

  const place = () => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const t = resolveAnchor(anchor)?.getBoundingClientRect();
    const target = t ? { top: t.top, left: t.left, width: t.width, height: t.height } : null;
    const next = placeTip(box, target, window.innerWidth, window.innerHeight);
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    const nextRing = spotlight && target && (target.width > 0 || target.height > 0) ? target : null;
    setRing((prev) =>
      prev === nextRing ||
      (prev && nextRing && prev.top === nextRing.top && prev.left === nextRing.left && prev.width === nextRing.width && prev.height === nextRing.height)
        ? prev
        : nextRing,
    );
  };

  useLayoutEffect(place);

  useEffect(() => {
    const timer = window.setInterval(place, 500);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  });

  // Mark the anchor with a data attribute (a hook for tests and styling); the ring is drawn below.
  useEffect(() => {
    if (!spotlight) return;
    const el = resolveAnchor(anchor);
    el?.setAttribute("data-coach-spot", "true");
    return () => el?.removeAttribute("data-coach-spot");
  }, [spotlight, anchor]);

  const toneClass = tone === "mistake" ? styles.tipMistake : styles.tipGuide;

  return createPortal(
    <>
      {ring && (
        <div
          className={`${styles.ring} ${tone === "mistake" ? styles.ringMistake : ""}`}
          style={{ top: ring.top - 5, left: ring.left - 5, width: ring.width + 10, height: ring.height + 10 }}
          aria-hidden
          data-testid="coach-ring"
        >
          {!reduced && (
            <motion.span
              className={styles.ringPulse}
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 1.08 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </div>
      )}
      <motion.div
        ref={ref}
        className={`${styles.tip} ${toneClass}`}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        role="status"
        aria-live="polite"
        data-testid="coach-tip"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.92 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
        transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 24 }}
      >
        <motion.div
          className={styles.inner}
          animate={reduced ? undefined : { y: [0, -3, 0] }}
          transition={reduced ? undefined : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          {heroKey && (
            <span className={styles.hero} data-testid="coach-hero">
              <OnceIcon icon={COACH_ICONS[heroKey]} className={styles.heroIcon} />
            </span>
          )}
          <div className={styles.text}>
            <div className={styles.eyebrow}>{COACH_EYEBROW[tone]}</div>
            {title && <div className={styles.title}>{title}</div>}
            <div className={styles.body}>{body}</div>
            {children}
            {onDismiss && (
              <div className={styles.actions}>
                <button type="button" className={styles.dismiss} onClick={onDismiss}>
                  {dismissLabel}
                </button>
                {onSecondary && secondaryLabel && (
                  <button type="button" className={styles.secondary} onClick={onSecondary}>
                    {secondaryLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </>,
    document.body,
  );
}
