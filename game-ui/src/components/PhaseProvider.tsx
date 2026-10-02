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
 * True when phase 0 ("Introduction") is present - a self-contained demo whose state is thrown
 * away afterwards. Shared so every screen that needs to know "did this run go through the demo"
 * (the phase briefing, the dossier, the pre/post-demo briefing screens) agrees on the same check.
 */
export function hasIntroPhase(phases: PhaseData[]): boolean {
  return (
    phases.length > 0 &&
    phases[0]?.id === 0 &&
    phases[0]?.phase_name?.toLowerCase() === "introduction"
  );
}

/**
 * Phase 0 ("Introduction") is a self-contained demo whose state is thrown away afterwards, so
 * the first phase a player really plays is 1 whether or not the demo ran, and the demo must
 * not count as a previous phase to diff against.
 */
export function isFirstPlayablePhase(phases: PhaseData[], currentPhase: number): boolean {
  return hasIntroPhase(phases) ? currentPhase <= 1 : currentPhase === 0;
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
