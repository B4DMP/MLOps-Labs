export type ActionCard = {
  ac_title: string;
  ac_descr: string;
  metric_changes: Record<string, number>;
  stakeholder_ids: string[];
  ac_image: string;
};