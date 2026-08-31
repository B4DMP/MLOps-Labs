import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./PreRoundDialog.module.css";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";

interface PreRoundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  currentChallenge?: number;
  challengeAmount?: number;
}

export default function PreRoundDialog({
  isOpen,
  onClose,
  challengeTitle = "",
  challengeDescription = "",
  challengeIntro = "",
  currentChallenge = 0,
  challengeAmount = 1,
}: PreRoundDialogProps) {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={onClose} className="position-relative z-50">
      <DialogBackdrop className={styles.backdrop} />
      <div
        className="fixed-top bottom-0 start-0 end-0 d-flex align-items-center justify-content-center p-3"
        style={{ zIndex: 1050, position: "fixed", inset: 0 }}
      >
        <DialogPanel
          className="card shadow-lg border-0 rounded-4 overflow-hidden"
          style={{ width: "90%", maxWidth: "720px", background: "#f8f9fa" }}
        >
          {/* Header */}
          <div
            className="p-3 d-flex align-items-center justify-content-between text-white"
            style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)" }}
          >
            <DialogTitle className="h5 mb-0 fw-bold d-flex align-items-center gap-2">
              <Icon icon="ph:target-bold" style={{ color: "#ef4444", fontSize: "1.8rem" }} />
              Challenge Briefing
            </DialogTitle>
          </div>

          {/* Body */}
          <div className="p-4">
            <ChallengeDescriptionCard
              challengeTitle={challengeTitle}
              challengeDescription={challengeDescription}
              challengeIntro={challengeIntro}
              currentChallenge={currentChallenge}
              challengeAmount={challengeAmount}
            />

            {/* Actions */}
            <div className="d-flex justify-content-end mt-4">
              <button
                className="btn btn-danger btn-lg px-4 py-2 fw-semibold shadow-sm d-flex align-items-center gap-2 rounded-3"
                onClick={onClose}
              >
                <span>Start Challenge</span>
                <Icon icon="ph:arrow-right-bold" />
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
