/** Gather: engagement cards buy conversations, not batches (D49, plan 11). */

export type GatherOptionKind =
  | "open_question"
  | "test_hypothesis"
  | "generic_question"
  | "trial_balloon"
  | "one_on_one";

export interface GatherOptionSpec {
  option: GatherOptionKind;
  available: boolean;
  reason?: string | null;
  item_id?: string | null;
  archetype?: string | null;
}

export interface GatherStatePayload {
  phase_id: number;
  challenge_id: number;
  card_id: string;
  stakeholder_id: string;
  stakeholder_name: string;
  turns_left: number;
  turns_used: number;
  closed: boolean;
  options: GatherOptionSpec[];
  result?: string | null;
  error?: string | null;
}
