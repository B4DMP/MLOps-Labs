import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./PrePhaseDialog.module.css";
import { PhasesContext } from "./PhaseProvider";
import { useContext } from "react";
import PowerInterestMatrix from "./PowerInterestMatrix";
import HoverTooltip from "./HoverToolTip";

interface PrePhaseDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  setIsRoundOpen?: (open: boolean) => void;
}

export default function PrePhaseDialog({
  isOpen,
  setIsOpen,
  setIsRoundOpen,
}: PrePhaseDialogProps) {
  const { currentPhase, phases } = useContext(PhasesContext);

  if (!isOpen) return null;

  const currentPhaseData = phases[currentPhase];
  
  // Phase 0 ("Introduction") is a skipped/hidden tutorial challenge; treat Phase 1 as the first playable game phase
  const hasIntroPhase = phases.length > 0 && phases[0]?.id === 0 && phases[0]?.name?.toLowerCase() === "introduction";
  const isFirstPhase = hasIntroPhase ? currentPhase <= 1 : currentPhase === 0;
  const previousPhaseData = isFirstPhase ? null : (currentPhase > 0 ? phases[currentPhase - 1] : null);

  const currentStakeholders = currentPhaseData?.stakeholder_power_interest || [];
  const previousStakeholders = previousPhaseData?.stakeholder_power_interest || [];

  const displayPhaseNumber = hasIntroPhase ? Math.max(1, currentPhase) : currentPhase + 1;
  const totalPlayablePhases = hasIntroPhase ? Math.max(1, phases.length - 1) : phases.length;

  const handleClose = () => {
    setIsOpen(false);
    if (setIsRoundOpen) {
      setIsRoundOpen(true);
    }
  };

  return (
    <Dialog open={isOpen} onClose={handleClose} className="position-relative z-50">
      <DialogBackdrop className={styles.backdrop} />
      <div
        className={`${styles.dialogWrapper} intro2`}
        data-intro-group="intro2"
        data-intro="This phase overview appears when a new phase begins. Here you can see the phase objectives and how stakeholders' power and interest dynamics evolve."
        data-step="1"
        data-position="middle-aligned"
      >
        <DialogPanel className={styles.panel}>
          {/* Header */}
          <div className={styles.header}>
            <div>
              <DialogTitle className={styles.headerTitle}>
                <Icon icon="ph:projector-screen-chart-bold" className={styles.headerIcon} />
                <span>Phase Briefing</span>
              </DialogTitle>
              <p className={styles.headerSubtitle}>
                Project Milestone Overview • Align technical decisions with stakeholder priorities
              </p>
            </div>
            {phases && phases.length > 0 && (
              <span className={styles.phaseBadge}>
                Phase {displayPhaseNumber} of {totalPlayablePhases}
              </span>
            )}
          </div>

          {/* Modal Body */}
          <div className={styles.modalBody}>
            <div className={styles.dossierGrid}>
              {/* Left Column: Mission Directive & Objectives */}
              <div className={styles.missionColumn}>
                <div className={styles.missionCard}>
                  <div className={styles.missionCardHeader}>
                    <Icon icon="ph:target-bold" />
                    <span>{currentPhaseData?.phase_name || `Phase ${displayPhaseNumber}`}</span>
                  </div>
                  <div className={styles.missionCardBody}>
                    {currentPhaseData?.phase_introduction && (
                      <p className={styles.missionIntro}>
                        {currentPhaseData.phase_introduction}
                      </p>
                    )}
                    <div className={styles.objectivesBox}>
                      <span className={styles.objectivesLabel}>
                        <Icon icon="ph:flag-checkered-bold" />
                        Phase Objectives
                      </span>
                      <p className={styles.objectivesText}>
                        {currentPhaseData?.phase_desc ||
                          "Enter this phase to address new project requirements and align with key stakeholders."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actionable Strategy & Instructions for the Player */}
                <div className={styles.actionPlanCard}>
                  <div className={styles.actionPlanHeader}>
                    <Icon icon="ph:list-checks-bold" className={styles.actionPlanIcon} />
                    <span>Player Action Plan</span>
                  </div>
                  <div className={styles.actionPlanList}>
                    <div className={styles.actionPlanItem}>
                      <span className={styles.stepBadge}>1</span>
                      <div>
                        <strong>Deliver Objectives:</strong> Align your technical choices with the phase deliverables defined above.
                      </div>
                    </div>
                    <div className={styles.actionPlanItem}>
                      <span className={styles.stepBadge}>2</span>
                      <div>
                        <strong>Involve Others:</strong> Prioritize <span className={styles.highlightManage}>Manage Closely</span> stakeholders, but make sure to involve the others as well.
                      </div>
                    </div>
                    <div className={styles.actionPlanItem}>
                      <span className={styles.stepBadge}>3</span>
                      <div>
                        <strong>Navigate Trade-offs:</strong> Check newcomer and shifted badges on the radar to anticipate which stakeholder priorities may clash during round dilemmas.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Stakeholder Matrix */}
              <div className={styles.matrixColumn}>
                <div className={styles.sectionHeader}>
                  <h6 className={styles.sectionTitle}>
                    <Icon icon="ph:users-three-bold" className={styles.sectionIcon} />
                    <span>Stakeholder Power & Interest Radar</span>
                  </h6>
                  <HoverTooltip
                    description="Radar Gameplay Guide: Power reflects authority to approve or veto your ML systems. Interest reflects how directly daily work is impacted. Focus your attention on 'Manage Closely' stakeholders, but don't disregard the others."
                  >
                    <span className={styles.radarHelpBtn}>
                      <Icon icon="ph:info-bold" />
                      <span>Radar Guide</span>
                    </span>
                  </HoverTooltip>
                </div>
                <PowerInterestMatrix
                  currentStakeholders={currentStakeholders}
                  previousStakeholders={previousStakeholders}
                  isFirstPhase={isFirstPhase}
                />
              </div>
            </div>

            {/* Footer with hint and action button */}
            <div className={styles.footer}>
              <div className={styles.footerHint}>
                <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
                <span>You can review this stakeholder matrix anytime during the phase.</span>
              </div>
              <div className={styles.actions}>
                <button className={styles.actionButton} onClick={handleClose}>
                  <span>Enter Phase & Begin Round</span>
                  <Icon icon="ph:arrow-right-bold" />
                </button>
              </div>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
