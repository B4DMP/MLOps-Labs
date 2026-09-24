import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import EventLog from "./EventLog";
import type { GameEventPayload } from "../types/GameEvent";
import styles from "./EventLogModal.module.css";

export interface EventLogModalProps {
  isVisible: boolean;
  onClose: () => void;
  events: GameEventPayload[];
  onItemClick?: (itemId: string) => void;
}

/** Dialog chrome around `EventLog` (plan 11, D51): the in-game overlay players open mid-play.
 * Grouping, filtering, search, and row rendering all live in `EventLog` itself - this component
 * only owns the modal frame, so the in-game log and the post-game results log never drift apart. */
export default function EventLogModal({
  isVisible,
  onClose,
  events,
  onItemClick,
}: EventLogModalProps) {
  const [panelNode, setPanelNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVisible, onClose]);

  const handleItemClick = (itemId: string) => {
    if (onItemClick) {
      onItemClick(itemId);
      onClose();
    }
  };

  return (
    <div
      className={`${styles.helpOverlayLayer} ${
        isVisible ? styles.helpLayerVisible : styles.helpLayerHidden
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.dashboardPanel} ref={setPanelNode}>
        <div className={styles.header}>
          <h4 className={styles.headerTitle}>
            <Icon icon="ph:scroll-bold" style={{ fontSize: "1.35rem", color: "#ffffff" }} />
            <span>Project Event Log</span>
            {events.length > 0 && (
              <span className="badge bg-white text-dark ms-2" style={{ fontSize: "0.75rem", verticalAlign: "middle" }}>
                {events.length} {events.length === 1 ? "event" : "events"}
              </span>
            )}
          </h4>
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={onClose}
            aria-label="Close Event Log"
            title="Close Event Log (Esc)"
            style={{ cursor: "pointer" }}
          />
        </div>

        <div className={styles.modalBody}>
          <EventLog
            events={events}
            title="Project Event Log"
            showToggle={false}
            onItemClick={onItemClick ? handleItemClick : undefined}
            fill
            tooltipPortalTarget={panelNode}
          />
        </div>
      </div>
    </div>
  );
}
