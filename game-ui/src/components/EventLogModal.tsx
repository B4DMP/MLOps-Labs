import { useMemo, useState, useEffect, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import type { EventLogFilter, GameEventKind, GameEventPayload } from "../types/GameEvent";
import { filterForKind } from "../types/GameEvent";
import styles from "./EventLogModal.module.css";

const STEP_LABEL: Record<string, string> = {
  offline: "Offline Gathering",
  gather: "Gathering Intel",
  build: "Build Pitch Case",
  object: "Face Stakeholder Objections",
  commit: "Pitch Decision",
  simulation: "Simulation",
  gate: "Milestone Gate",
};

const STEP_ICON: Record<string, string> = {
  offline: "ph:magnifying-glass-bold",
  gather: "ph:chats-circle-bold",
  build: "ph:cards-bold",
  object: "ph:hand-palm-bold",
  commit: "ph:gavel-bold",
  simulation: "ph:play-bold",
  gate: "ph:flag-checkered-bold",
};

const KIND_ICON: Record<GameEventKind, string> = {
  emotion: "ph:heart-bold",
  patience: "ph:hourglass-medium-bold",
  intel: "ph:file-text-bold",
  tokens: "ph:coins-bold",
  escalation: "ph:lightning-bold",
  card: "ph:cards-bold",
  objection: "ph:hand-palm-bold",
  outcome: "ph:flag-checkered-bold",
  grudge: "ph:eye-bold",
  graph: "ph:graph-bold",
  metric: "ph:chart-line-up-bold",
};

const FILTER_META: Record<EventLogFilter, { label: string; icon: string }> = {
  people: { label: "People", icon: "ph:users-three-bold" },
  intel: { label: "Intel", icon: "ph:file-text-bold" },
  card: { label: "Card", icon: "ph:cards-bold" },
  system: { label: "System", icon: "ph:graph-bold" },
};

const DIRECTION_CLASS: Record<string, string> = {
  up: styles.directionUp,
  down: styles.directionDown,
  none: "",
};

const MAGNITUDE_DOTS: Record<string, number> = { slight: 1, clear: 2, large: 3 };

interface EventGroup {
  step: string;
  events: GameEventPayload[];
  maxSeq: number;
}

const groupByStep = (events: GameEventPayload[]): EventGroup[] => {
  const byStep = new Map<string, GameEventPayload[]>();
  events.forEach((event) => {
    byStep.set(event.step, [...(byStep.get(event.step) || []), event]);
  });
  return [...byStep.entries()]
    .map(([step, stepEvents]) => ({
      step,
      events: [...stepEvents].sort((a, b) => b.seq - a.seq),
      maxSeq: Math.max(...stepEvents.map((e) => e.seq)),
    }))
    .sort((a, b) => b.maxSeq - a.maxSeq);
};

export interface EventLogModalProps {
  isVisible: boolean;
  onClose: () => void;
  events: GameEventPayload[];
  onItemClick?: (itemId: string) => void;
}

export default function EventLogModal({
  isVisible,
  onClose,
  events,
  onItemClick,
}: EventLogModalProps) {
  const [activeFilters, setActiveFilters] = useState<Set<EventLogFilter>>(
    () => new Set<EventLogFilter>(["people", "intel", "card", "system"]),
  );

  // Close on Escape key
  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVisible, onClose]);

  const toggleFilter = (filter: EventLogFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next.size === 0 ? new Set<EventLogFilter>(["people", "intel", "card", "system"]) : next;
    });
  };

  const countsByFilter = useMemo(() => {
    const counts: Record<EventLogFilter, number> = {
      people: 0,
      intel: 0,
      card: 0,
      system: 0,
    };
    events.forEach((e) => {
      const f = filterForKind(e.kind);
      if (f in counts) counts[f]++;
    });
    return counts;
  }, [events]);

  const filteredEvents = useMemo(
    () => events.filter((e) => activeFilters.has(filterForKind(e.kind))),
    [events, activeFilters],
  );

  const groups = useMemo(() => groupByStep(filteredEvents), [filteredEvents]);

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
      <div className={styles.dashboardPanel}>
        {/* Header matching PrePhaseDialog and PerformanceDashboard */}
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

        {/* Modal Body */}
        <div className={styles.modalBody}>
          {/* Filter Chips Bar */}
          <div className={styles.sectionCard}>
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>
                <Icon icon="ph:funnel-bold" /> Filter Categories
              </span>

              <div className={styles.filtersRow}>
                {(Object.keys(FILTER_META) as EventLogFilter[]).map((filter) => {
                  const isActive = activeFilters.has(filter);
                  const count = countsByFilter[filter];
                  return (
                    <button
                      key={filter}
                      type="button"
                      className={`${styles.filterChip} ${isActive ? styles.filterChipActive : ""}`}
                      onClick={() => toggleFilter(filter)}
                      title={`Filter by ${FILTER_META[filter].label}`}
                    >
                      <Icon icon={FILTER_META[filter].icon} style={{ fontSize: "1rem" }} />
                      <span>{FILTER_META[filter].label}</span>
                      <span className={styles.filterCountBadge}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Event Groups List */}
          <div className={`${styles.sectionCard} ${styles.timelineSectionCard}`}>
            <span className={styles.sectionLabel}>
              <Icon icon="ph:clock-counter-clockwise-bold" /> Chronological Timeline
            </span>

            {groups.length === 0 ? (
              <div className={styles.emptyStateContainer}>
                <Icon icon="ph:scroll-bold" className={styles.emptyStateIcon} />
                <span className={styles.emptyStatePrimary}>No Events Recorded Yet</span>
                <span className={styles.emptyStateSecondary}>
                  Stakeholder shifts, card plays, and pipeline modifications will appear here in chronological sequence.
                </span>
              </div>
            ) : (
              <div className={styles.timelineListWrapper}>
                {groups.map((group) => (
                  <details key={group.step} className={styles.groupCard} open>
                    <summary className={styles.groupSummary}>
                      <div className={styles.groupTitleBox}>
                        <Icon icon={STEP_ICON[group.step] || "ph:dot-bold"} className={styles.groupIcon} />
                        <span>{STEP_LABEL[group.step] || group.step}</span>
                      </div>
                      <span className={styles.groupCountPill}>
                        {group.events.length} {group.events.length === 1 ? "entry" : "entries"}
                      </span>
                    </summary>

                    <ul className={styles.eventsList}>
                      {group.events.map((event) => {
                        const itemId = typeof event.refs?.item_id === "string" ? event.refs.item_id : undefined;
                        const clickable = Boolean(itemId && onItemClick);

                        return (
                          <li
                            key={event.seq}
                            className={`${styles.eventRow} ${clickable ? styles.eventRowClickable : ""}`}
                            onClick={clickable ? () => handleItemClick(itemId!) : undefined}
                            role={clickable ? "button" : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onKeyDown={
                              clickable
                                ? (e: KeyboardEvent<HTMLLIElement>) => {
                                    if (e.key === "Enter" || e.key === " ") handleItemClick(itemId!);
                                  }
                                : undefined
                            }
                            title={clickable ? "Click to view this item in the Stakeholder Dossier" : undefined}
                          >
                            <Icon icon={KIND_ICON[event.kind] || "ph:dot-bold"} className={styles.eventKindIcon} />
                            <span className={`${styles.eventText} ${DIRECTION_CLASS[event.direction]}`}>
                              {event.text}
                            </span>

                            {event.magnitude && (
                              <span
                                className={`${styles.magnitudeDots} ${DIRECTION_CLASS[event.direction]}`}
                                title={`Impact magnitude: ${event.magnitude}`}
                              >
                                {"●".repeat(MAGNITUDE_DOTS[event.magnitude] || 1)}
                              </span>
                            )}

                            {clickable && (
                              <span className={styles.jumpDossierBadge}>
                                <Icon icon="ph:arrow-square-out-bold" />
                                <span>Dossier</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
