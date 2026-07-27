import {
  Description,
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import styles from "./PrePhaseDialog.module.css";
import { PhasesContext } from "./PhaseProvider";
import { useContext } from "react";

interface PrePhaseDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  setIsRoundOpen: (open: boolean) => void;
}

export default function PrePhaseDialog({
  isOpen,
  setIsOpen,
  setIsRoundOpen,
}: PrePhaseDialogProps) {
  const { currentPhase, phases } = useContext(PhasesContext);

  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        setIsOpen(false);
        setIsRoundOpen(true);
      }}
      className={styles.dialogWrapper}
    >
      <DialogBackdrop className={styles.backdrop} />
      <div
        className={`${styles.dialogWrapper} intro2`}
        data-intro-group="intro2"
        data-intro="This phase overview appears when a new phase begins. Here you can see the new stakeholders and metrics that the phase introduces."
        data-step="1"
        data-position="middle-aligned"
      >
        <DialogPanel className={`${styles.panel} card shadow-lg`}>
          <div className="card-body">
            <DialogTitle className="h4 mb-3">
              <span>New Game Phase - </span>
              {phases[currentPhase] ? phases[currentPhase].phase_name : "Error"}
            </DialogTitle>
            <Description as="div" className="text-muted mb-3">
              {phases[currentPhase] != null && currentPhase >= 2 && (
                <p>
                  Congratulations! The project has entered a new development
                  phase with the following goals:{" "}
                  {phases[currentPhase]?.phase_desc}.
                </p>
              )}
              {phases[currentPhase] != null && currentPhase < 2 && (
                <p>
                  You are now entering the serious game environment. The ML
                  development project has entered its first phase (
                  {phases[currentPhase]?.phase_name}) with the following goals:{" "}
                  {phases[currentPhase]?.phase_desc}.
                </p>
              )}
            </Description>

            <div className={styles.actions}>
              <button
                style={{
                  backgroundColor: "var(--primary-bg)",
                  borderColor: "var(--primary-bg)",
                }}
                className="btn btn-primary"
                onClick={() => {
                  setIsOpen(false);
                  setIsRoundOpen(true);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
