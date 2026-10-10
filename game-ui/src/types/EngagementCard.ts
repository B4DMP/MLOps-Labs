export interface EngagementCard {
  id: string;
  title: string;
  icon: string;
  image?: string;
  token_cost: number;
  description: string;
  stakeholder_selection_amount: number; // -1 for all, 0 for intel, >0 for exact count
  target_type: "stakeholder" | "intel" | "component";
  response_snippet?: string;
  max_plays_per_phase?: number;
  turns?: number;
  allowed_requirement_types?: string[];
  repeatable_target?: boolean;
  effect_kind?: "gather" | "patience_reset" | "pep_talk";
}

export interface PlayedEngagementCardState {
  card: EngagementCard;
  selectedStakeholderIds: string[];
  selectedIntelId?: string;
}
