import {
  createContext,
  useContext,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useState,
  useRef,
  useLayoutEffect,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import styles from "./HoverToolTip.module.css";

/** Breathing room kept between the tooltip and both the anchor and the viewport edge. */
const EDGE_MARGIN = 8;

type HoverTooltipVariant = "default" | "parchment" | "paper";

const VariantContext = createContext<HoverTooltipVariant>("default");

/** Themes every HoverTooltip below it, e.g. the dossier's sketchbook window. */
export function HoverTooltipTheme({
  variant,
  children,
}: {
  variant: HoverTooltipVariant;
  children: React.ReactNode;
}) {
  return <VariantContext.Provider value={variant}>{children}</VariantContext.Provider>;
}

const VARIANT_CLASS: Record<HoverTooltipVariant, string> = {
  default: "",
  parchment: styles.parchment,
  paper: styles.paper,
};

/** Keyboard focus only: a click also focuses the control and would leave the tooltip stuck. */
function isKeyboardFocus(e: SyntheticEvent): boolean {
  try {
    return (e.target as Element).matches(":focus-visible");
  } catch {
    return false; // :focus-visible unsupported
  }
}

/**
 * The tooltip box itself. Mounted only while shown, so it measures and positions itself once per
 * show: flips above the anchor when it would run off the bottom, and stays inside the viewport
 * horizontally. Shared by `HoverTooltip` and `useTooltipController`.
 */
function TooltipBubble({
  anchor,
  content,
  id,
  portalTarget,
  onDismiss,
}: {
  anchor: DOMRect;
  content: ReactNode;
  id?: string;
  portalTarget?: HTMLElement | null;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const variant = useContext(VariantContext);
  const [coords, setCoords] = useState({
    top: anchor.bottom + EDGE_MARGIN,
    left: anchor.left + anchor.width / 2,
  });

  // Dismiss on Escape and on any scroll, since the tooltip is fixed to a stale anchor position.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  const textKey = typeof content === "string" ? content : null;
  useLayoutEffect(() => {
    if (!ref.current) return;
    const box = ref.current.getBoundingClientRect();

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
  }, [anchor, textKey]);

  return createPortal(
    <div
      id={id}
      role="tooltip"
      ref={ref}
      className={`rounded ${styles.tooltipContent} ${VARIANT_CLASS[variant]}`}
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        transform: "translateX(-50%)",
      }}
    >
      {content}
    </div>,
    portalTarget ?? document.body
  );
}

/**
 * One shared tooltip for many anchors, for places a `HoverTooltip` wrapper cannot go: elements
 * inside an `<svg>` (the wrapper collapses to zero size) and anchors built in `.map()` loops
 * (a hook per element would break the Rules of Hooks). Spread `bind(content)` on the anchor and
 * render `bubble` once. Same box, placement and dismissal as `HoverTooltip`.
 */
export function useTooltipController(portalTarget: HTMLElement | null = null) {
  const [open, setOpen] = useState<{ anchor: DOMRect; content: ReactNode } | null>(null);
  const dismiss = useCallback(() => setOpen(null), []);

  // Always the same four handlers, so a caller can wrap one with its own work. Empty content shows nothing.
  const bind = useCallback((content?: ReactNode) => {
    const show = (e: SyntheticEvent) => {
      if (content) setOpen({ anchor: (e.currentTarget as Element).getBoundingClientRect(), content });
    };
    return {
      onMouseEnter: show,
      onMouseLeave: () => setOpen(null),
      onFocus: (e: SyntheticEvent) => {
        if (isKeyboardFocus(e)) show(e);
      },
      onBlur: () => setOpen(null),
    };
  }, []);

  const bubble = open ? (
    <TooltipBubble anchor={open.anchor} content={open.content} portalTarget={portalTarget} onDismiss={dismiss} />
  ) : null;

  return { bind, bubble, hide: dismiss };
}

interface HoverTooltipProps {
  /** Empty or undefined renders the children untouched, so callers can pass a conditional. */
  description?: ReactNode;
  /** Plain-text twin of a rich `description`, used for `labelsChild`. */
  ariaText?: string;
  children: React.ReactNode;
  /**
   * Element the tooltip is portaled into. Defaults to `document.body`, which is
   * fine on a normal page but renders *behind* an open modal, so components
   * inside a dialog should pass a layer that lives within it.
   */
  portalTarget?: HTMLElement | null;
  /**
   * Use for icon-only controls: gives the single child `aria-label={description}` (unless it
   * already has a label), replacing the accessible name a native `title` used to provide.
   */
  labelsChild?: boolean;
  /** Make the wrapper fill its container, for block-level children such as a full-width card. */
  block?: boolean;
}

export default function HoverTooltip({
  description,
  ariaText,
  children,
  portalTarget = null,
  labelsChild = false,
  block = false,
}: HoverTooltipProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const dismiss = useCallback(() => setAnchor(null), []);

  function open() {
    if (anchorRef.current) setAnchor(anchorRef.current.getBoundingClientRect());
  }

  if (!description) return <>{children}</>;

  const label = ariaText ?? (typeof description === "string" ? description : undefined);
  const content =
    labelsChild &&
    label &&
    isValidElement<Record<string, unknown>>(children) &&
    !children.props["aria-label"] &&
    !children.props["aria-labelledby"]
      ? cloneElement(children, { "aria-label": label })
      : children;

  return (
    <span
      ref={anchorRef}
      onMouseEnter={open}
      onMouseLeave={dismiss}
      onFocus={(e) => isKeyboardFocus(e) && open()}
      onBlur={dismiss}
      aria-describedby={anchor ? tooltipId : undefined}
      className={`${styles.tooltipWrapper} ${block ? styles.block : ""}`}
    >
      {content}

      {anchor && (
        <TooltipBubble
          anchor={anchor}
          content={description}
          id={tooltipId}
          portalTarget={portalTarget}
          onDismiss={dismiss}
        />
      )}
    </span>
  );
}
