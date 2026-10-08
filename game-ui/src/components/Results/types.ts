/**
 * The `results:data` payload (docs/plans/results-screen.md), mirroring `build_results` in
 * `game-api/.../results_service/service.py`. Kept in one place so the hero, the tabs and the
 * admin drill-down all read the same shape.
 */

import type { GameEventPayload } from "../../types/GameEvent";

export type PillarId =
  | "pipeline_health"
  | "stakeholder_relations"
  | "intel_accuracy"
  | "decision_quality";

export interface Pillar {
  id: PillarId;
  /** 0..1 */
  score: number;
  detail: Record<string, unknown>;
  /** True on a spiral run: the score is movement over the inherited system, not an absolute. */
  relative: boolean;
}

export type GradeLetter = "S" | "A" | "B" | "C" | "D" | "E";

export interface Grade {
  overall: number;
  grade: GradeLetter;
  label: string;
}

export type ScoreboardKey = "availability" | "waste" | "residual_stock" | "override_rate";

export interface Epilogue {
  closing: string;
  scoreboard: Record<ScoreboardKey, string>;
  beats: Array<{ id: string; text: string }>;
}

export interface MetricResult {
  id: string;
  value: number;
  max: number;
  gained: number;
  ratio: number;
  series: number[];
}

export interface KnowledgeDelta {
  total_questions: number;
  intro: { correct: number | null; percent: number | null };
  outro_per_run: Array<{ run: number; correct: number | null; percent: number | null }>;
  delta: number | null;
  delta_percent: number | null;
}

export interface IntelRow {
  id: string;
  gathered: number;
  available: number;
  correct: number;
  wrong: number;
}

export interface IntelBreakdown {
  per_stakeholder: IntelRow[];
  /** confusion[trueTag][taggedTag] = how many. Counts only, never wording (D7). */
  confusion: Record<string, Record<string, number>>;
  confidence: { verified: number; unconfirmed: number };
}

export type Outcome = "PASS" | "SOFT_PASS" | "VETO" | "STALEMATE";

export interface DecisionRow {
  position: number;
  phase_index: number;
  challenge_index: number;
  name: string;
  card_title: string | null;
  /** Null when the challenge never reached a commit: rendered as unfinished, not as a veto. */
  outcome: Outcome | null;
  attention_tokens: number | null;
}

export interface MoodTrajectory {
  steps: number;
  /** null where a stakeholder was not in the room, so the line breaks instead of diving to zero. */
  series: Record<string, Array<number | null>>;
}

export interface PatternRef {
  id: string;
  kind: "anti" | "design";
  name: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  locked: boolean;
  health?: number;
  status?: "healthy" | "degraded" | "broken";
  maturity?: number;
  broken?: number;
  starved?: number;
  debt?: number;
  patterns?: PatternRef[];
}

export interface ResultsPayload {
  run_index: number;
  /** From `Setting.json`, so the screen never hardcodes the fiction it is set in. */
  setting: { company: string; system: string };
  seeded_from_run: number | null;
  is_spiral: boolean;
  /** Whether this campaign lets the player start another game from here. */
  replay_allowed: boolean;
  grade: Grade;
  epilogue: Epilogue;
  pillars: Pillar[];
  metrics: { metrics: MetricResult[]; challenges: number; own_from: number };
  knowledge: KnowledgeDelta;
  intel: IntelBreakdown;
  decisions: DecisionRow[];
  mood: MoodTrajectory;
  stakeholders: Record<string, string>;
  /** Every configured stakeholder, in config order: a colour is bound to the entity's place here. */
  stakeholder_order: string[];
  escalation: { total: number; left: number };
  pipeline: {
    system_health: number | null;
    inherited_system_health: number | null;
    stages: PipelineStage[];
  };
  challenges: unknown[];
  events: GameEventPayload[];
}

/** Player-facing names for the four pillars. The ids are API vocabulary and never shown. */
export const PILLAR_LABEL: Record<PillarId, string> = {
  pipeline_health: "Pipeline health",
  stakeholder_relations: "Stakeholder relations",
  intel_accuracy: "Intel accuracy",
  decision_quality: "Decision quality",
};

export const PILLAR_ICON: Record<PillarId, string> = {
  pipeline_health: "ph:heartbeat-bold",
  stakeholder_relations: "ph:users-three-bold",
  intel_accuracy: "ph:magnifying-glass-bold",
  decision_quality: "ph:gavel-bold",
};

/** What each pillar means, one line, for the hover title and the accessible description. */
export const PILLAR_HINT: Record<PillarId, string> = {
  pipeline_health: "How well the MLOps system you built is actually running",
  stakeholder_relations: "How the room felt about you at the end, weighted by who mattered most",
  intel_accuracy: "How much you found out, and how many of those notes you read correctly",
  decision_quality: "How your proposals fared when the room voted",
};

export const SCOREBOARD_LABEL: Record<ScoreboardKey, string> = {
  availability: "Availability",
  waste: "Waste",
  residual_stock: "Residual stock",
  override_rate: "Override rate",
};

export const SCOREBOARD_ICON: Record<ScoreboardKey, string> = {
  availability: "ph:shopping-cart-bold",
  waste: "ph:trash-bold",
  residual_stock: "ph:package-bold",
  override_rate: "ph:hand-pointing-bold",
};

export const SCOREBOARD_ORDER: ScoreboardKey[] = [
  "availability",
  "waste",
  "residual_stock",
  "override_rate",
];
