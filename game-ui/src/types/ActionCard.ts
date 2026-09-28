/**
 * One slot of an action card: exactly one step on one axis of one target
 * (docs/plans/graph-governance-automation-rework/00-plan.md §2.3). Mirrors the backend's
 * `pitch_debate_service.session.AtomicChange`.
 *
 * `axis` is required in practice for `raise_to`: the backend drops a raise_to without one,
 * since there is no combined level left to infer it from.
 */
export interface AtomicChange {
  target: string;
  kind?: "raise_to" | "set_trigger" | string;
  axis?: "automation" | "governance";
  value?: any;
  trigger?: string;
}

/** What one slotted change would do, as far as the player can tell. Mirrors the backend's
 *  `ItemPrediction`: one entry per (target, axis), so match on both. */
export interface ItemPrediction {
  item_id?: string;
  target: string;
  axis?: "automation" | "governance" | null;
  /** The rung the change asks for. */
  asked?: number | null;
  /** The rung it would effectively run at afterwards; null while the player cannot know. */
  predicted?: number | null;
  capped_by?: string | null;
  known?: boolean;
  upstream_uncertain?: boolean;
  upstream_uncertain_nodes?: string[];
}

export type ActionCard = {
  id: string;
  title: string;
  description: string;
  intel_ids?: string[];
  addendum_intel_item_ids?: string[];
  metric_changes?: Record<string, number>;
  atomic_changes?: AtomicChange[];
  /** Player-facing name of each atomic change (the curated option's name), index-aligned with
   *  `atomic_changes`. Optional: a card built without the graph at hand falls back to a
   *  generic "Automation → manual" description. */
  atomic_change_labels?: string[];
  predictions?: ItemPrediction[];
  target_names?: Record<string, string>;
  current_phase?: number;
  challenge_id?: number;
};
