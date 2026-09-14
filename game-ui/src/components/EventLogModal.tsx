/**
 * The event log, opened from the "Log" button in the Stakeholder Dossier header (alongside
 * System / Performance / Briefing). Built on the shared HeaderModal chrome so it reads as the
 * same family of panel as Performance and the phase briefing's mid-phase review.
 */

import { Icon } from "@iconify/react";
import HeaderModal from "./HeaderModal";
import EventLog from "./EventLog";
import type { GameEventPayload } from "../types/GameEvent";

interface EventLogModalProps {
  isVisible: boolean;
  onClose: () => void;
  events: GameEventPayload[];
  onItemClick?: (itemId: string) => void;
}

export default function EventLogModal({ isVisible, onClose, events, onItemClick }: EventLogModalProps) {
  return (
    <HeaderModal isVisible={isVisible} onClose={onClose} closeLabel="event log">
      <div className="d-flex align-items-center gap-2 mb-2" style={{ paddingRight: 28 }}>
        <Icon icon="ph:scroll-bold" style={{ color: "#7dd3fc", fontSize: "1.15rem" }} />
        <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.95rem", letterSpacing: "0.02em" }}>
          Event log
        </span>
      </div>

      <EventLog events={events} showToggle={false} onItemClick={onItemClick} />
    </HeaderModal>
  );
}
