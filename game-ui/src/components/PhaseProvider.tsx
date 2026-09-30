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
 * Phase 0 ("Introduction") is a tutorial challenge, skipped by default (campaign flag
 * `intro_phase_enabled` off): the first phase a player actually plays is then 1, and phase 0
 * still exists in `phases` purely as unplayed config, so it must not be counted as visited.
 * When the flag is on, phase 0 is a real first phase and phase 1 is no longer "first" - it
 * has a genuine previous phase to diff against. Shared so the phase briefing and the dossier
 * cannot disagree about who counts as new.
 */
export function isFirstPlayablePhase(
  phases: PhaseData[],
  currentPhase: number,
  introPhaseEnabled: boolean = false
): boolean {
  const hasIntroPhase =
    phases.length > 0 &&
    phases[0]?.id === 0 &&
    phases[0]?.phase_name?.toLowerCase() === "introduction";
  if (!hasIntroPhase) return currentPhase === 0;
  return introPhaseEnabled ? currentPhase === 0 : currentPhase <= 1;
}

type PhaseContextType = {
  currentPhase: number;
  setCurrentPhase: React.Dispatch<React.SetStateAction<number>>;
  phases: PhaseData[];
  setPhases: React.Dispatch<React.SetStateAction<any>>;
  introPhaseEnabled: boolean;
};

export const PhasesContext = createContext<PhaseContextType>({
  currentPhase: 0,
  setCurrentPhase: () => {},
  phases: [],
  setPhases: () => {},
  introPhaseEnabled: false,
});
