import { createContext } from "react";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";

export type Stakeholder = {
  id: string;
  name: string;
  responsibilities: string;
  priorities: string;
  constraints?: string;
  role_description: string;
  metric_id: string;
  stakeholder_color?: string;
  avatar?: StakeholderAvatar;
  power?: string;
  interest?: string;
  emotion?: string;
  facial_expression?: string;
  emotional_state?: string;
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
