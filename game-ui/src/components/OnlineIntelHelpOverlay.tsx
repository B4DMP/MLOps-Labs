import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import type { ActionCard } from "../types/ActionCard";
import styles from "./online_intel_gathering.module.css";

interface OnlineIntelHelpOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
}

export default function OnlineIntelHelpOverlay({
  isOpen,
  onClose,
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
  challengeTitle = "",
  challengeDescription = "",
  challengeIntro = "",
  challengeAmount = 1,
}: OnlineIntelHelpOverlayProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender && !isClosing) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
      setShouldRender(false);
    }, 200);
  };

  if (!shouldRender && !isOpen) return null;

  return (
    <div
      className={`${styles.modalBackdrop} ${isClosing ? styles.modalBackdropClosing : ""}`}
      onClick={handleClose}
    >
      <div
        className={`${styles.intelModal} ${isClosing ? styles.intelModalClosing : ""}`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "80vw", maxWidth: "80vw", height: "80vh", maxHeight: "80vh" }}
      >
        <div className={styles.modalHeader}>
          <h5 className="modal-title mb-0 fw-bold d-flex align-items-center gap-2 fs-5">
            <Icon icon="ph:question-bold" style={{ color: "#ffffffff", fontSize: "1.9rem" }} /> Phase, Metrics & Challenge Overview
          </h5>
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={handleClose}
          />
        </div>

        <div className={styles.modalBody} style={{ overflowY: "auto" }}>
          {/* Phase Overview */}
          <div className="mb-4">
            <h6 className="fw-bold text-dark mb-2 d-flex align-items-center gap-2 fs-5">
              <Icon icon="ph:clipboard-text-bold" style={{ color: "#dc3545", fontSize: "1.8rem" }} /> Phase Overview
            </h6>
            <div className="p-3 rounded-3 shadow-sm" style={{ background: "#f8f9fa", border: "1px solid #dee2e6" }}>
              <PhaseOverview />
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="mb-4">
            <h6 className="fw-bold text-dark mb-2 d-flex align-items-center gap-2 fs-5">
              <Icon icon="ph:chart-bar-bold" style={{ color: "#dc3545", fontSize: "1.8rem" }} /> Performance Metrics
            </h6>
            <div className="p-3 rounded-3 shadow-sm" style={{ background: "#f8f9fa", border: "1px solid #dee2e6" }}>
              <MetricTab
                current_phase={currentPhase}
                showMetricValueChanges={showMetricValueChanges}
                last_ac={last_ac}
              />
            </div>
          </div>

          {/* Challenge Details */}
          <div className="mb-2">
            <h6 className="fw-bold text-dark mb-2 d-flex align-items-center gap-2 fs-5">
              <Icon icon="ph:target-bold" style={{ color: "#dc3545", fontSize: "1.8rem" }} /> Challenge Description
            </h6>
            <ChallengeDescriptionCard
              challengeTitle={challengeTitle}
              challengeDescription={challengeDescription}
              challengeIntro={challengeIntro}
              currentChallenge={currentChallenge}
              challengeAmount={challengeAmount}
            />
          </div>
        </div>


      </div>
    </div>
  );
}
