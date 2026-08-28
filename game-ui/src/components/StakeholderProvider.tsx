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
};

type StakeholderContextType = {
  stakeholders: Record<string, Stakeholder>;
  setStakeholders: React.Dispatch<React.SetStateAction<any>>;
};

export const StakeholderContext = createContext<StakeholderContextType>({
  stakeholders: {},
  setStakeholders: () => {},
});
