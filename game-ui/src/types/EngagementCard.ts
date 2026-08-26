export interface EngagementCardConfig {
  id: string;
  title: string;
  icon: string;
  token_cost: number;
  description: string;
  stakeholder_selection_amount: number; // -1 for all, 0 for intel, >0 for exact count
  target_type: "stakeholder" | "intel";
  response_snippet?: string;
  max_plays_per_phase?: number;
}

export interface PlayedEngagementCardState {
  card: EngagementCardConfig;
  selectedStakeholderIds: string[];
  selectedIntelId?: string;
}
