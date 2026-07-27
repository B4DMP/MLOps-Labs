import { createContext } from "react";

type PhaseContextType = {
  currentPhase: number;
  setCurrentPhase: React.Dispatch<React.SetStateAction<number>>;
  phases: {
    phase_name: string;
    phase_desc?: string;
  }[];
  setPhases: React.Dispatch<React.SetStateAction<any>>;
};

export const PhasesContext = createContext<PhaseContextType>({
  currentPhase: 0,
  setCurrentPhase: () => {},
  phases: [],
  setPhases: () => {},
});
