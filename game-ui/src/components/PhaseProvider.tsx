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
  challenges_per_phase?: number;
  challenge_quota?: number;
  stakeholder_power_interest?: PhaseStakeholderEntry[];
};

/**
 * Phase 0 ("Introduction") is a skipped tutorial challenge, so the first phase a
 * player actually plays is 1 when it exists and 0 otherwise. Shared so the phase
 * briefing and the dossier cannot disagree about who counts as new.
 */
export function isFirstPlayablePhase(phases: PhaseData[], currentPhase: number): boolean {
  const hasIntroPhase =
    phases.length > 0 &&
    phases[0]?.id === 0 &&
    phases[0]?.phase_name?.toLowerCase() === "introduction";
  return hasIntroPhase ? currentPhase <= 1 : currentPhase === 0;
}

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
