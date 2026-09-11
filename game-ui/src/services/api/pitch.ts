/** API calls for the merged pitch phase (plan 06). */

const BASE = "/api/pitch";

export interface CardIntelItem {
  id: string;
  intel_type: string;
  categorized_type: string;
  description: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
  metric_id?: string;
}

export interface ObjectionData {
  id: string;
  kind: "boundary" | "technical" | "stance" | "price" | "correction";
  stakeholder_id: string;
  item_id?: string;
  target?: string;
  text: string;
  hard: boolean;
}

export interface DialogueOptionData {
  option: "amend" | "reframe" | "stonewall" | "emergency_addendum" | "concede_correction";
  available: boolean;
  reason?: string;
}

export interface ObjectionsResponse {
  objections: ObjectionData[];
  buy_in_preview: Record<string, number>;
}

export interface CommitResponse {
  outcome: "PASS" | "SOFT_PASS" | "VETO";
  buy_in: Record<string, number>;
  vetoing: string[];
  soft_blocking: string[];
}

interface ObjectionsRequest {
  username: string;
  phase_id: number;
  challenge_id: number;
  card_item_ids: string[];
  main_archetype_name?: string | null;
  secondary_archetype_name?: string | null;
}

interface CommitRequest extends ObjectionsRequest {
  emotion_values?: Record<string, Record<string, number>>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchObjections(req: ObjectionsRequest): Promise<ObjectionsResponse> {
  return post<ObjectionsResponse>("/objections", req);
}

export async function fetchCommit(req: CommitRequest): Promise<CommitResponse> {
  return post<CommitResponse>("/commit", req);
}
