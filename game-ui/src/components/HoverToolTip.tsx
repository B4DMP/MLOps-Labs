import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./HoverToolTip.module.css";


interface HoverTooltipProps {
  description: string;
  children: React.ReactNode;
}

export default function HoverTooltip({
  description,
  children,
}: HoverTooltipProps) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);

  function handleMouseEnter() {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
      });
    }

    setShow(true);

  }

  function handleMouseLeave() {
    setShow(false);
  }

  const tooltipElement = (
    <div
      className={`rounded ${styles.tooltipContent}`}
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        transform: "translateX(-50%)",
      }}
    >
      {show && <>{description}</>}
    </div>
  );

  return (
    <span
      ref={anchorRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={styles.tooltipWrapper}
    >
      {children}

      {(show) && createPortal(tooltipElement, document.body)}
    </span>
  );
}
