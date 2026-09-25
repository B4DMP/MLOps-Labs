import { createContext } from "react";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";

/** One emotion dimension gating a stakeholder's state, bucketed server-side (never a raw score)
 * - see EmotionFactory.derive_gating_dimensions in game-api. */
export type EmotionGatingDimension = {
  metric: string;
  bucket: "low" | "medium" | "high";
};

/** The dimensions behind a stakeholder's mood, for the dossier's hover reveal. When the
 * stakeholder is neutral (nothing triggered), `state` names the closest edge they could tip
 * over instead and `is_current` is false - so a neutral stakeholder still shows where they land,
 * just framed as "leaning toward" rather than "why". */
export type EmotionGatingInfo = {
  state: string | null;
  is_current: boolean;
  dimensions: EmotionGatingDimension[];
};

export type Stakeholder = {
  id: string;
  name: string;
  responsibilities: string;
  priorities: string;
  constraints?: string;
  role_description: string;
  introduction?: string;
  metric_id: string;
  /** Text-to-speech gender hint (docs/plans/player-settings-and-tts.md). "neutral" falls back
   * to the narrator voice. */
  voice?: "male" | "female" | "neutral";
  stakeholder_color?: string;
  avatar?: StakeholderAvatar;
  power?: string;
  interest?: string;
  emotion?: string;
  facial_expression?: string;
  emotional_state?: string;
  emotion_values?: Record<string, number>;
  emotionValues?: Record<string, number>;
  /** Which 2-3 dimensions are gating (or nearest to gating) the current emotional_state. */
  emotion_dimensions?: EmotionGatingInfo;
  /** All 7 configured emotion dimensions, bucketed - for the dossier's full emotion reveal. */
  emotion_dimensions_full?: EmotionGatingDimension[];
};

type StakeholderContextType = {
  stakeholders: Record<string, Stakeholder>;
  setStakeholders: React.Dispatch<React.SetStateAction<any>>;
  emotionColors?: Record<string, string>;
  setEmotionColors?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
};

export const StakeholderContext = createContext<StakeholderContextType>({
  stakeholders: {},
  setStakeholders: () => {},
  emotionColors: {},
  setEmotionColors: () => {},
});
