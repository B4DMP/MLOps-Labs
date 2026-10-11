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
  effect_kind?: "gather" | "patience_reset" | "pep_talk" | "pen";
  /** Badge on the face of a direct-effect card, in the slot a gather card's "+N turns" takes. */
  effect_label?: string;
  effect_icon?: string;
  effect_hint?: string;
}

export interface PlayedEngagementCardState {
  card: EngagementCard;
  selectedStakeholderIds: string[];
  selectedIntelId?: string;
}
