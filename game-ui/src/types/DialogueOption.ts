export interface DialogueOptionArchetype {
  name: string;
  evidence_basis?: number;
  risk_and_control?: number;
  value_horizon?: number;
  strategy?: string;
}

export interface DialogueOption {
  text: string;
  intel_item_id?: string | null;
  intel_description?: string | null;
  intel_stakeholder_name?: string | null;
  intel_type?: string | null;
  archetype?: DialogueOptionArchetype | null;
}
