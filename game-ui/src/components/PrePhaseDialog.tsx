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
  const previousPhaseData = currentPhase > 0 ? phases[currentPhase - 1] : null;

  const currentStakeholders = currentPhaseData?.stakeholder_power_interest || [];
  const previousStakeholders = previousPhaseData?.stakeholder_power_interest || [];

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
        <DialogPanel className={`${styles.panel} card shadow-lg border-0`}>
          {/* Header matching Challenge Briefing style */}
          <div
            className="p-3 d-flex align-items-center justify-content-between text-white"
            style={{ backgroundColor: "var(--primary-bg)" }}
          >
            <DialogTitle className="h5 mb-0 fw-bold d-flex align-items-center gap-2">
              <Icon
                icon="ph:projector-screen-chart-bold"
                style={{ color: "var(--secondary-bg)", fontSize: "1.8rem" }}
              />
              <span>Phase Briefing</span>
            </DialogTitle>
            {phases && phases.length > 0 && (
              <span
                className="badge px-3 py-2 rounded-pill fw-semibold"
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                  color: "#ffffff",
                  fontSize: "0.85rem",
                  letterSpacing: "0.5px",
                }}
              >
                Phase {currentPhase + 1} of {phases.length}
              </span>
            )}
          </div>

          {/* Modal Body */}
          <div className={styles.modalBody}>
            {/* 1. Phase Objectives Card (matching ChallengeDescriptionCard style) */}
            <div
              className="card shadow-sm w-100"
              style={{ background: "#ffffff", border: "1px solid #dee2e6", borderRadius: "0.75rem" }}
            >
              <h5
                className="card-header text-center"
                style={{
                  background: "var(--primary-bg)",
                  color: "white",
                  padding: "0.75rem 1.25rem",
                  borderTopLeftRadius: "0.75rem",
                  borderTopRightRadius: "0.75rem",
                }}
              >
                <span className="fw-bold">
                  {currentPhaseData?.phase_name || `Phase ${currentPhase + 1}`}
                </span>
              </h5>
              <div className="card-body bg-white text-dark p-3">
                {currentPhaseData?.phase_introduction && (
                  <p className="card-text text-secondary fst-italic mb-2" style={{ fontSize: "0.95rem" }}>
                    {currentPhaseData.phase_introduction}
                  </p>
                )}
                <p className="card-text text-dark fs-6 mb-0" style={{ lineHeight: "1.5" }}>
                  <strong>Phase Objectives: </strong>
                  {currentPhaseData?.phase_desc ||
                    "Enter this phase to address new project requirements and align with key stakeholders."}
                </p>
              </div>
            </div>

            {/* 2. Stakeholder Dynamics & 4-Quadrant Power-Interest Matrix */}
            <div>
              <div className={styles.sectionHeader}>
                <h6 className={styles.sectionTitle}>
                  <Icon
                    icon="ph:users-three-bold"
                    style={{ color: "var(--primary-bg)", fontSize: "1.25rem" }}
                  />
                  <span>Stakeholder Power & Interest Matrix</span>
                </h6>
              </div>
              <PowerInterestMatrix
                currentStakeholders={currentStakeholders}
                previousStakeholders={previousStakeholders}
                isFirstPhase={currentPhase === 0}
              />
            </div>

            {/* 3. Action Footer Button */}
            <div className={styles.actions}>
              <button className={styles.actionButton} onClick={handleClose}>
                <span>Enter Phase</span>
                <Icon icon="ph:arrow-right-bold" />
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
