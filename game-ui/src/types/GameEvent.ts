/** The event log (plan 11, D51): one record for every change, with a cause the player can read.
 * `text` is rendered server-side from `gameConfig/EventCauses.json` - causes are config
 * templates, never LLM text, so the frontend never needs its own copy of that file. */

export type GameEventStep = "offline" | "gather" | "build" | "object" | "commit" | "simulation" | "gate";
export type GameEventKind =
  | "emotion" | "patience" | "intel" | "tokens" | "escalation"
  | "card" | "objection" | "outcome" | "grudge" | "graph" | "metric" | "thread";
export type GameEventDirection = "up" | "down" | "none";
export type GameEventMagnitude = "slight" | "clear" | "large";

export interface GameEventPayload {
  seq: number;
  phase_id: number;
  challenge_id: number;
  step: GameEventStep;
  kind: GameEventKind;
  subject_id?: string | null;
  direction: GameEventDirection;
  magnitude?: GameEventMagnitude | null;
  cause: string;
  params: Record<string, string>;
  refs: Record<string, unknown>;
  /** Rendered from the cause template server-side - always present from the API. */
  text: string;
}

/** The four filters the log offers (plan 11): who they're about, intel, cards/tokens, or the
 * system underneath. */
export type EventLogFilter = "people" | "intel" | "card" | "system";

export const EVENT_LOG_FILTER_KINDS: Record<EventLogFilter, GameEventKind[]> = {
  people: ["emotion", "patience", "objection", "outcome", "grudge"],
  intel: ["intel", "thread"],
  card: ["card", "tokens", "escalation"],
  system: ["graph", "metric"],
};

export const filterForKind = (kind: GameEventKind): EventLogFilter => {
  for (const [filter, kinds] of Object.entries(EVENT_LOG_FILTER_KINDS) as [EventLogFilter, GameEventKind[]][]) {
    if (kinds.includes(kind)) return filter;
  }
  return "system";
};
