/**
 * The event log (plan 11, D51): everything that happened, with a cause the player can read.
 * Collapsed by default, grouped by step (the "turn" the game is on), filterable by who/what it's
 * about. Reused as-is in the pitch phase, offline gathering, and the simulation report.
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import type { EventLogFilter, GameEventKind, GameEventPayload } from "../types/GameEvent";
import { filterForKind } from "../types/GameEvent";
import styles from "./EventLog.module.css";

const STEP_LABEL: Record<string, string> = {
  offline: "Offline gathering",
  gather: "Gather",
  build: "Build your case",
  object: "Face the room",
  commit: "Decide",
  simulation: "Simulation",
  gate: "Gate",
};

const KIND_ICON: Record<GameEventKind, string> = {
  emotion: "ph:heart-bold",
  patience: "ph:hourglass-medium-bold",
  intel: "ph:file-text-bold",
  archetype: "ph:broadcast-bold",
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

const STEP_ICON: Record<string, string> = {
  offline: "ph:magnifying-glass-bold",
  gather: "ph:chats-circle-bold",
  build: "ph:cards-bold",
  object: "ph:hand-palm-bold",
  commit: "ph:gavel-bold",
  simulation: "ph:play-bold",
  gate: "ph:flag-checkered-bold",
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

export interface EventLogProps {
  events: GameEventPayload[];
  title?: string;
  defaultCollapsed?: boolean;
  /** False when a parent tab/button already controls visibility (e.g. the pitch phase's side
   * rail, which shows its own "Event log" tab next to "Conversation history"): this component
   * then skips its own toggle header and always renders the filters and groups. */
  showToggle?: boolean;
  /** Called with `refs.item_id` when the player clicks a row that names an intel item. Omit it
   * on a screen with nowhere to jump to (e.g. the simulation report): rows just render as plain
   * text there. */
  onItemClick?: (itemId: string) => void;
}

export default function EventLog({
  events, title = "Event log", defaultCollapsed = true, showToggle = true, onItemClick,
}: EventLogProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [activeFilters, setActiveFilters] = useState<Set<EventLogFilter>>(
    () => new Set<EventLogFilter>(["people", "intel", "card", "system"]),
  );

  const toggleFilter = (filter: EventLogFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      // Never let every filter turn off at once - an empty log reads as broken, not filtered.
      return next.size === 0 ? new Set<EventLogFilter>(["people", "intel", "card", "system"]) : next;
    });
  };

  const filtered = useMemo(
    () => events.filter((e) => activeFilters.has(filterForKind(e.kind))),
    [events, activeFilters],
  );
  const groups = useMemo(() => groupByStep(filtered), [filtered]);

  return (
    <div className={styles.wrap}>
      {showToggle && (
        <button className={styles.toggle} onClick={() => setCollapsed((v) => !v)} title="What happened, and why">
          <Icon icon={collapsed ? "ph:caret-right-bold" : "ph:caret-down-bold"} />
          <span>{title}</span>
          {events.length > 0 && <span className={styles.count}>{events.length}</span>}
        </button>
      )}

      {(!showToggle || !collapsed) && (
        <div className={styles.body}>
          <div className={styles.filters}>
            {(Object.keys(FILTER_META) as EventLogFilter[]).map((filter) => (
              <button
                key={filter}
                className={`${styles.filterChip} ${activeFilters.has(filter) ? styles.filterChipOn : ""}`}
                onClick={() => toggleFilter(filter)}
                title={FILTER_META[filter].label}
              >
                <Icon icon={FILTER_META[filter].icon} />
                {FILTER_META[filter].label}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <div className={styles.emptyStateContainer}>
              <Icon icon="ph:scroll-bold" className={styles.emptyStateIcon} />
              <span className={styles.emptyStatePrimary}>Nothing logged yet</span>
              <span className={styles.emptyStateSecondary}>
                Every change shows up here, with the reason why.
              </span>
            </div>
          ) : (
            groups.map((group) => (
              <details key={group.step} className={styles.group} open>
                <summary className={styles.groupTitle}>
                  <Icon icon={STEP_ICON[group.step] || "ph:dot-bold"} className={styles.groupIcon} />
                  <span className={styles.groupTitleText}>{STEP_LABEL[group.step] || group.step}</span>
                  <span className={styles.groupCount}>{group.events.length}</span>
                </summary>
                <ul className={styles.list}>
                  {group.events.map((event) => {
                    const itemId = typeof event.refs?.item_id === "string" ? event.refs.item_id : undefined;
                    const clickable = Boolean(itemId && onItemClick);
                    return (
                      <li
                        key={event.seq}
                        className={`${styles.row} ${clickable ? styles.rowClickable : ""}`}
                        {...(clickable
                          ? {
                              role: "button",
                              tabIndex: 0,
                              title: "Jump to this intel item",
                              onClick: () => onItemClick!(itemId!),
                              onKeyDown: (e: KeyboardEvent) => {
                                if (e.key === "Enter" || e.key === " ") onItemClick!(itemId!);
                              },
                            }
                          : {})}
                      >
                        <Icon icon={KIND_ICON[event.kind] || "ph:dot-bold"} className={styles.rowIcon} />
                        <span className={`${styles.rowText} ${DIRECTION_CLASS[event.direction]}`}>{event.text}</span>
                        {event.magnitude && (
                          <span
                            className={`${styles.magnitude} ${DIRECTION_CLASS[event.direction]}`}
                            title={event.magnitude}
                          >
                            {"●".repeat(MAGNITUDE_DOTS[event.magnitude] || 1)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))
          )}
        </div>
      )}
    </div>
  );
}
