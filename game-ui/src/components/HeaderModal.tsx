import { useEffect, type CSSProperties, type ReactNode } from "react";

export interface HeaderModalProps {
  isVisible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** CSS width value for the card. */
  width?: string;
  /** CSS height value; omit to size to content, up to maxHeight. */
  height?: string;
  /** CSS max-height value for the card. */
  maxHeight?: string;
  /** Card background. */
  background?: string;
  /** Card inner padding. Set to "0" when the content brings its own edge-to-edge chrome
   * (e.g. a header bar that should reach the card's rounded corners). */
  padding?: string;
  /** Whether the card itself scrolls, or leaves that to its content. */
  overflowY?: CSSProperties["overflowY"];
  /** Renders the shared close (X) button, top-right of the card. Turn off when the content
   * already has its own close affordance in that corner (e.g. a badge it would collide with). */
  showCloseButton?: boolean;
  /** Used in the close button's title/aria-label, e.g. "performance", "event log". */
  closeLabel?: string;
  /** Closes on Escape. Turn off when the content has its own nested Escape behavior to run
   * first (e.g. closing a drill-down before closing the whole panel). */
  closeOnEscape?: boolean;
}

/**
 * Shared chrome for the dossier header's pop-open panels (Performance, Event log, and the phase
 * briefing when reopened mid-phase): a dimmed backdrop plus a card fixed at the top of the
 * screen, dismissible with Escape or a backdrop click. Every consumer supplies its own header
 * row and body as children — this only owns the scaffold, so the panels read as one family
 * instead of three different UI patterns.
 */
export default function HeaderModal({
  isVisible,
  onClose,
  children,
  width = "min(560px, 94vw)",
  height,
  maxHeight = "88vh",
  background = "rgba(9, 11, 20, 0.96)",
  padding = "10px 18px 12px",
  overflowY = "auto",
  showCloseButton = true,
  closeLabel = "panel",
  closeOnEscape = true,
}: HeaderModalProps) {
  useEffect(() => {
    if (!isVisible || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVisible, closeOnEscape, onClose]);

  if (!isVisible) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 1039, background: "rgba(0, 0, 0, 0.35)" }}
        aria-hidden
      />
      <div
        style={{
          position: "fixed",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          width,
          height,
          zIndex: 1040,
          background,
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 14,
          boxShadow: "0 18px 45px rgba(0, 0, 0, 0.55)",
          padding,
          maxHeight,
          overflowY,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {showCloseButton && (
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={onClose}
            title={`Close ${closeLabel} (Esc)`}
            aria-label={`Close ${closeLabel}`}
            style={{ position: "absolute", top: 8, right: 12, zIndex: 1 }}
          />
        )}
        {children}
      </div>
    </>
  );
}
