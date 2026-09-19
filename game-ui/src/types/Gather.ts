/** Gather: component-driven dialogue and engagement options (Plan 01, Section 3). */

export type GatherOptionKind =
  | "component_query"
  | "priority_query"
  | "generic_query"
  | "investigate_component";

export interface GatherOptionSpec {
  option: GatherOptionKind;
  available: boolean;
  reason?: string | null;
  component_id?: string | null;
  prompt?: string | null;
  label?: string | null;
  item_id?: string | null;
}

export interface GatherStatePayload {
  phase_id: number;
  challenge_id: number;
  card_id: string;
  conversation_id?: string;
  stakeholder_id: string;
  stakeholder_name: string;
  turns_left: number;
  turns_used: number;
  closed: boolean;
  options: GatherOptionSpec[];
  result?: string | null;
  error?: string | null;
}
