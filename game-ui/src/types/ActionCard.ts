export interface AtomicChange {
  target: string;
  kind: "raise_to";
  value?: number;
}

export type ActionCard = {
  id: string;
  title: string;
  description: string;
  intel_ids?: string[];
  addendum_intel_item_ids?: string[];
  metric_changes?: Record<string, number>;
  atomic_changes?: AtomicChange[];
  predictions?: Array<{
    target: string;
    current: number;
    predicted: number;
    effective_current?: number;
    effective_predicted?: number;
    capped_by?: string;
    upstream_uncertain?: boolean;
    upstream_uncertain_nodes?: string[];
  }>;
  target_names?: Record<string, string>;
  current_phase?: number;
  challenge_id?: number;
};