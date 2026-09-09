export type ActionCard = {
  id: string;
  title: string;
  description: string;
  intel_ids: string[];
  addendum_intel_item_ids: string[];
  metric_changes?: Record<string, number>;
};