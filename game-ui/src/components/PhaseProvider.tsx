import { createContext } from "react";

export type PhaseStakeholderEntry = {
  stakeholder_id: string;
  power: string;
  interest: string;
};

export type PhaseData = {
  id?: number;
  phase_name: string;
  phase_desc?: string;
  phase_introduction?: string;
  stakeholder_power_interest?: PhaseStakeholderEntry[];
};

type PhaseContextType = {
  currentPhase: number;
  setCurrentPhase: React.Dispatch<React.SetStateAction<number>>;
  phases: PhaseData[];
  setPhases: React.Dispatch<React.SetStateAction<any>>;
};

export const PhasesContext = createContext<PhaseContextType>({
  currentPhase: 0,
  setCurrentPhase: () => {},
  phases: [],
  setPhases: () => {},
});
