import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import styles from "./HoverToolTip.module.css";

/** Breathing room kept between the tooltip and both the anchor and the viewport edge. */
const EDGE_MARGIN = 8;

interface HoverTooltipProps {
  description: string;
  children: React.ReactNode;
  /**
   * Element the tooltip is portaled into. Defaults to `document.body`, which is
   * fine on a normal page but renders *behind* an open modal, so components
   * inside a dialog should pass a layer that lives within it.
   */
  portalTarget?: HTMLElement | null;
}

export default function HoverTooltip({
  description,
  children,
  portalTarget = null,
}: HoverTooltipProps) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const anchorRectRef = useRef<DOMRect | null>(null);

  function handleMouseEnter() {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      anchorRectRef.current = rect;
      setCoords({
        top: rect.bottom + EDGE_MARGIN,
        left: rect.left + rect.width / 2,
      });
    }

    setShow(true);
  }

  function handleMouseLeave() {
    setShow(false);
  }

  // Flip the tooltip above its anchor when it would run off the bottom of the
  // window, and keep the horizontally centered box inside the viewport. Runs
  // once per show: the measurement only needs the tooltip's size, which does
  // not change with its position.
  useLayoutEffect(() => {
    if (!show || !tooltipRef.current || !anchorRectRef.current) return;

    const anchor = anchorRectRef.current;
    const box = tooltipRef.current.getBoundingClientRect();

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
  }, [show, description]);

  return (
    <span
      ref={anchorRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={styles.tooltipWrapper}
    >
      {children}

      {show &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`rounded ${styles.tooltipContent}`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              transform: "translateX(-50%)",
            }}
          >
            {description}
          </div>,
          portalTarget ?? document.body
        )}
    </span>
  );
}
