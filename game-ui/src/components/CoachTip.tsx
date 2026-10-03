import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./CoachTip.module.css";

export interface CoachTipProps {
  title?: string;
  body: ReactNode;
  /** "mistake" gets an amber accent, "guide" the tour teal. */
  tone?: "mistake" | "guide";
  /** Element or CSS selector to point at. Missing or not found: the tip sits at the bottom centre. */
  anchor?: HTMLElement | string | null;
  /** Rings the anchor while the tip is open. */
  spotlight?: boolean;
  dismissLabel?: string;
  /** Omit for a tip that closes only when its owner removes it (a wait-for-action step). */
  onDismiss?: () => void;
  children?: ReactNode;
}

const MARGIN = 10;

function resolveAnchor(anchor: CoachTipProps["anchor"]): HTMLElement | null {
  if (!anchor) return null;
  if (typeof anchor !== "string") return anchor.isConnected ? anchor : null;
  try {
    return document.querySelector<HTMLElement>(anchor);
  } catch {
    return null;
  }
}

/** Small silent popover. It never narrates; tours own the voice. */
export default function CoachTip({
  title,
  body,
  tone = "guide",
  anchor,
  spotlight = false,
  dismissLabel = "Got it",
  onDismiss,
  children,
}: CoachTipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const target = resolveAnchor(anchor)?.getBoundingClientRect();
    let top: number;
    let left: number;
    if (!target || (target.width === 0 && target.height === 0)) {
      top = window.innerHeight - box.height - 24;
      left = (window.innerWidth - box.width) / 2;
    } else {
      const below = target.bottom + MARGIN;
      top = below + box.height <= window.innerHeight - 6 ? below : Math.max(6, target.top - box.height - MARGIN);
      left = Math.min(Math.max(6, target.left + target.width / 2 - box.width / 2), window.innerWidth - box.width - 6);
    }
    top = Math.round(top);
    left = Math.round(left);
    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
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

  // Ring the anchor with a data attribute; the rule lives in this module's CSS.
  useEffect(() => {
    if (!spotlight) return;
    const el = resolveAnchor(anchor);
    el?.setAttribute("data-coach-spot", "true");
    return () => el?.removeAttribute("data-coach-spot");
  }, [spotlight, anchor]);

  return createPortal(
    <div
      ref={ref}
      className={`${styles.tip} ${tone === "mistake" ? styles.tipMistake : styles.tipGuide}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      role="status"
      aria-live="polite"
      data-testid="coach-tip"
    >
      {title && <div className={styles.title}>{title}</div>}
      <div className={styles.body}>{body}</div>
      {children}
      {onDismiss && (
        <div className={styles.actions}>
          <button type="button" className={styles.dismiss} onClick={onDismiss}>
            {dismissLabel}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
