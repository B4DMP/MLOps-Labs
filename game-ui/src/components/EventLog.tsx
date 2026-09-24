/**
 * The event log (plan 11, D51): everything that happened, with a cause the player can read.
 * Collapsed by default, grouped by step (the "turn" the game is on), filterable by who/what it's
 * about, searchable by text. This is the one implementation: `EventLogModal` wraps it in dialog
 * chrome for the in-game overlay, and the post-game results screen (`TimelineTab`) renders it
 * inline as a plain panel - same grouping, same search, same phrasing either way.
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import HoverTooltip from "./HoverToolTip";
import type { EventLogFilter, GameEventKind, GameEventPayload } from "../types/GameEvent";
import { filterForKind } from "../types/GameEvent";
import styles from "./EventLog.module.css";

/** Player-facing step names: what the player was doing, not the internal step code. */
const STEP_LABEL: Record<string, string> = {
  offline: "Offline gathering",
  gather: "Gathering intel",
  build: "Building your case",
  object: "Facing objections",
  commit: "Making your decision",
  simulation: "Running the simulation",
  gate: "Milestone gate",
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

const STEP_TOOLTIP: Record<string, string> = {
  offline: "Intel you dug up before the room ever convened.",
  gather: "Conversations where you drew stakeholders out and filed what they told you.",
  build: "Cards you drafted and sounded out before bringing them to the room.",
  object: "The room pushing back on what you brought.",
  commit: "The call you made once the room had its say.",
  simulation: "The pipeline running with the decisions you made.",
  gate: "The checkpoint between one MLOps phase and the next.",
};

interface KindMeta {
  label: string;
  icon: string;
  description: string;
}

const KIND_META: Record<GameEventKind, KindMeta> = {
  emotion: { label: "Mood", icon: "ph:heart-bold", description: "How a stakeholder feels about you right now." },
  patience: { label: "Patience", icon: "ph:hourglass-medium-bold", description: "How much runway a stakeholder has left before they check out." },
  intel: { label: "Intel", icon: "ph:file-text-bold", description: "Something learned about a stakeholder or the system, filed for later." },
  tokens: { label: "Tokens", icon: "ph:coins-bold", description: "Attention tokens spent to get a card in front of someone." },
  escalation: { label: "Escalation", icon: "ph:lightning-bold", description: "A conflict that got bumped up rather than resolved." },
  card: { label: "Card", icon: "ph:cards-bold", description: "A pitch card played, or a turn that went unused." },
  objection: { label: "Objection", icon: "ph:hand-palm-bold", description: "A read on whether a stakeholder would let a card through." },
  outcome: { label: "Outcome", icon: "ph:flag-checkered-bold", description: "How the room, or the gate, actually decided." },
  grudge: { label: "Grudge", icon: "ph:eye-bold", description: "Something a stakeholder is holding onto, and when it came due." },
  graph: { label: "System", icon: "ph:graph-bold", description: "A change in the ML system itself, underneath the conversation." },
  metric: { label: "Metric", icon: "ph:chart-line-up-bold", description: "A tracked number that moved." },
};

interface FilterMeta {
  label: string;
  icon: string;
  description: string;
}

const FILTER_META: Record<EventLogFilter, FilterMeta> = {
  people: { label: "People", icon: "ph:users-three-bold", description: "Mood, patience, objections, outcomes, and grudges - what the room feels." },
  intel: { label: "Intel", icon: "ph:file-text-bold", description: "What you've learned and filed about stakeholders or the system." },
  card: { label: "Card", icon: "ph:cards-bold", description: "Cards played, tokens spent, and escalations." },
  system: { label: "System", icon: "ph:graph-bold", description: "The ML system and its metrics, moving underneath the conversation." },
};

const DIRECTION_CLASS: Record<string, string> = {
  up: styles.directionUp,
  down: styles.directionDown,
  none: "",
};

const DIRECTION_LABEL: Record<string, string> = {
  up: "improved",
  down: "worsened",
  none: "unchanged",
};

const MAGNITUDE_LABEL: Record<string, string> = {
  slight: "Slight shift",
  clear: "Clear shift",
  large: "Major shift",
};

const MAGNITUDE_DOTS: Record<string, number> = { slight: 1, clear: 2, large: 3 };

interface EventGroup {
  key: string;
  step: string;
  phaseId: number;
  challengeId: number;
  events: GameEventPayload[];
}

/** Newest first, chunked into consecutive runs of the same phase + challenge + step - not bucketed
 * by those fields globally. A challenge can in principle be revisited, and bucketing globally
 * would pool a later visit's rows in with an earlier one under a single header, scrambling the
 * order they actually happened in. Chunking consecutive rows instead means two visits, even to the
 * exact same step, always render as two separate groups in their true chronological place. */
const groupEvents = (events: GameEventPayload[]): EventGroup[] => {
  const bySeqDesc = [...events].sort((a, b) => b.seq - a.seq);
  const groups: EventGroup[] = [];
  for (const event of bySeqDesc) {
    const current = groups[groups.length - 1];
    if (
      current &&
      current.phaseId === event.phase_id &&
      current.challengeId === event.challenge_id &&
      current.step === event.step
    ) {
      current.events.push(event);
    } else {
      groups.push({
        key: `run-${event.seq}`,
        step: event.step,
        phaseId: event.phase_id,
        challengeId: event.challenge_id,
        events: [event],
      });
    }
  }
  // Groups stay newest-first (the most recent thing you did leads), but within a group the
  // rows read oldest-first: a merged run like "decision -> simulation" is a story ("here's the
  // card that got applied, then here's what followed from it"), and a story reads forward, not
  // backward - the loop above collects each run newest-first, so this un-reverses just that part.
  groups.forEach((group) => group.events.reverse());
  return groups;
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
  /** True when a flex ancestor (the in-game modal) already sizes this component's box: the log
   * grows to fill it instead of capping its own height. Leave false for a plain inline panel
   * (e.g. the post-game results tab), which has no such ancestor to fill. */
  fill?: boolean;
  /** Element the row/chip tooltips portal into. See HoverTooltip's own `portalTarget` prop -
   * needed when this log is rendered inside a modal, or its tooltips render behind it. */
  tooltipPortalTarget?: HTMLElement | null;
}

export default function EventLog({
  events, title = "Event log", defaultCollapsed = true, showToggle = true, onItemClick,
  fill = false, tooltipPortalTarget = null,
}: EventLogProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [activeFilters, setActiveFilters] = useState<Set<EventLogFilter>>(
    () => new Set<EventLogFilter>(["people", "intel", "card", "system"]),
  );
  const [query, setQuery] = useState("");

  const toggleFilter = (filter: EventLogFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      // Never let every filter turn off at once - an empty log reads as broken, not filtered.
      return next.size === 0 ? new Set<EventLogFilter>(["people", "intel", "card", "system"]) : next;
    });
  };

  const trimmedQuery = query.trim().toLowerCase();
  const bySearch = useMemo(
    () => (trimmedQuery ? events.filter((e) => e.text.toLowerCase().includes(trimmedQuery)) : events),
    [events, trimmedQuery],
  );

  /** Counts next to each filter chip say how many rows *this search* would show if it were on -
   * independent of whether it currently is, so toggling a chip off never changes its own count. */
  const countsByFilter = useMemo(() => {
    const counts: Record<EventLogFilter, number> = { people: 0, intel: 0, card: 0, system: 0 };
    bySearch.forEach((e) => { counts[filterForKind(e.kind)] += 1; });
    return counts;
  }, [bySearch]);

  const filtered = useMemo(
    () => bySearch.filter((e) => activeFilters.has(filterForKind(e.kind))),
    [bySearch, activeFilters],
  );

  const groups = useMemo(() => groupEvents(filtered), [filtered]);

  /** Only worth showing a phase/challenge badge on group headers once a session has actually
   * been through more than one - a single-challenge log (most results screens) doesn't need it. */
  const spansMultipleChallenges = useMemo(
    () => new Set(events.map((e) => `${e.phase_id}:${e.challenge_id}`)).size > 1,
    [events],
  );

  const isFilteredEmpty = groups.length === 0 && events.length > 0;

  return (
    <div className={`${styles.wrap} ${fill ? styles.wrapFill : ""}`}>
      {showToggle && (
        <button className={styles.toggle} onClick={() => setCollapsed((v) => !v)} title="What happened, and why">
          <Icon icon={collapsed ? "ph:caret-right-bold" : "ph:caret-down-bold"} />
          <span>{title}</span>
          {events.length > 0 && <span className={styles.count}>{events.length}</span>}
        </button>
      )}

      {(!showToggle || !collapsed) && (
        <div className={`${styles.body} ${fill ? styles.bodyFill : ""}`}>
          <div className={styles.controls}>
            <div className={styles.search}>
              <Icon icon="ph:magnifying-glass-bold" className={styles.searchIcon} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the log..."
                aria-label="Search the event log"
                className={styles.searchInput}
              />
              {query && (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => setQuery("")}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <Icon icon="ph:x-bold" />
                </button>
              )}
            </div>

            <div className={styles.filters}>
              {(Object.keys(FILTER_META) as EventLogFilter[]).map((filter) => (
                <HoverTooltip key={filter} description={FILTER_META[filter].description} portalTarget={tooltipPortalTarget}>
                  <button
                    className={`${styles.filterChip} ${activeFilters.has(filter) ? styles.filterChipOn : ""}`}
                    onClick={() => toggleFilter(filter)}
                    aria-pressed={activeFilters.has(filter)}
                  >
                    <Icon icon={FILTER_META[filter].icon} />
                    {FILTER_META[filter].label}
                    <span className={styles.filterCount}>{countsByFilter[filter]}</span>
                  </button>
                </HoverTooltip>
              ))}
            </div>
          </div>

          <div className={`${styles.scrollArea} ${fill ? styles.scrollAreaFill : ""}`}>
          {groups.length === 0 ? (
            <div className={styles.emptyStateContainer}>
              <Icon icon={isFilteredEmpty ? "ph:funnel-x-bold" : "ph:scroll-bold"} className={styles.emptyStateIcon} />
              <span className={styles.emptyStatePrimary}>
                {isFilteredEmpty ? "Nothing matches" : "Nothing logged yet"}
              </span>
              <span className={styles.emptyStateSecondary}>
                {isFilteredEmpty
                  ? "Try a different filter, or clear the search."
                  : "Every change shows up here, with the reason why."}
              </span>
            </div>
          ) : (
            <ul className={styles.groupList}>
              {groups.map((group) => (
                <li key={group.key} className={styles.group}>
                  <div className={styles.groupTitle}>
                    <HoverTooltip description={STEP_TOOLTIP[group.step] || "A step in the game."} portalTarget={tooltipPortalTarget}>
                      <span className={styles.groupTitleMain}>
                        <Icon icon={STEP_ICON[group.step] || "ph:dot-bold"} className={styles.groupIcon} />
                        <span className={styles.groupTitleText}>{STEP_LABEL[group.step] || group.step}</span>
                      </span>
                    </HoverTooltip>
                    {spansMultipleChallenges && (
                      <HoverTooltip
                        description="Where this happened in your playthrough: the MLOps phase and the challenge within it."
                        portalTarget={tooltipPortalTarget}
                      >
                        <span className={styles.groupWhen}>
                          Phase {group.phaseId} &middot; Challenge {group.challengeId}
                        </span>
                      </HoverTooltip>
                    )}
                    <span className={styles.groupCount}>{group.events.length}</span>
                  </div>
                  <ul className={styles.list}>
                    {group.events.map((event) => {
                      const itemId = typeof event.refs?.item_id === "string" ? event.refs.item_id : undefined;
                      const clickable = Boolean(itemId && onItemClick);
                      const kindMeta = KIND_META[event.kind];
                      // The pipeline still computes a real up/down for a fogged target (D11/D51:
                      // the graph moves whether the player has looked or not) - showing that
                      // direction here would tell the player which way it went, defeating the
                      // "you have not looked at it yet" the row's own text says.
                      const isFogged = event.cause === "graph.moved_unknown";
                      const shownDirection = isFogged ? "none" : event.direction;
                      return (
                        <li
                          key={event.seq}
                          className={`${styles.row} ${clickable ? styles.rowClickable : ""}`}
                          {...(clickable
                            ? {
                                role: "button",
                                tabIndex: 0,
                                onClick: () => onItemClick!(itemId!),
                                onKeyDown: (e: KeyboardEvent) => {
                                  if (e.key === "Enter" || e.key === " ") onItemClick!(itemId!);
                                },
                              }
                            : {})}
                        >
                          <HoverTooltip description={kindMeta?.description || event.kind} portalTarget={tooltipPortalTarget}>
                            <Icon icon={kindMeta?.icon || "ph:dot-bold"} className={styles.rowIcon} />
                          </HoverTooltip>
                          {shownDirection !== "none" && (
                            <HoverTooltip description={`This ${DIRECTION_LABEL[shownDirection]}.`} portalTarget={tooltipPortalTarget}>
                              <Icon
                                icon={shownDirection === "up" ? "ph:arrow-up-bold" : "ph:arrow-down-bold"}
                                className={`${styles.directionIcon} ${DIRECTION_CLASS[shownDirection]}`}
                              />
                            </HoverTooltip>
                          )}
                          <span
                            className={`${styles.rowText} ${DIRECTION_CLASS[shownDirection]}`}
                            aria-label={
                              shownDirection !== "none" ? `${event.text} (${DIRECTION_LABEL[shownDirection]})` : undefined
                            }
                          >
                            {event.text}
                          </span>
                          {clickable && (
                            <HoverTooltip description="Click to jump to this item in your dossier." portalTarget={tooltipPortalTarget}>
                              <Icon icon="ph:arrow-square-out-bold" className={styles.jumpIcon} />
                            </HoverTooltip>
                          )}
                          {event.magnitude && (
                            <HoverTooltip
                              description={
                                shownDirection !== "none"
                                  ? `${MAGNITUDE_LABEL[event.magnitude] || event.magnitude} (${DIRECTION_LABEL[shownDirection]})`
                                  : MAGNITUDE_LABEL[event.magnitude] || event.magnitude
                              }
                              portalTarget={tooltipPortalTarget}
                            >
                              <span className={`${styles.magnitude} ${DIRECTION_CLASS[shownDirection]}`}>
                                {"●".repeat(MAGNITUDE_DOTS[event.magnitude] || 1)}
                              </span>
                            </HoverTooltip>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
