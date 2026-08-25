import React, { useContext } from "react";
import { Icon } from "@iconify/react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import HoverTooltip from "./HoverToolTip";
import { StakeholderContext } from "./StakeholderProvider";
import type { ActionCard } from "../types/ActionCard";
import styles from "./online_intel_gathering.module.css";

function parseChallengeDescription(description?: string) {
  if (!description) return [];
  const parts = description.split(/(\{.*?\})/);
  return parts
    .map((part) => {
      if (part.startsWith("{") && part.endsWith("}")) {
        return { type: "id", value: part.slice(1, -1) };
      }
      return { type: "text", value: part };
    })
    .filter((part) => part.value !== "");
}

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
  challengeNumber?: number;
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
  challengeNumber = 1,
}: OnlineIntelHelpOverlayProps) {
  const { stakeholders } = useContext(StakeholderContext);

  if (!isOpen) return null;

  const challenge_desc_cutted = parseChallengeDescription(challengeDescription);
  const challenge_title = challengeTitle;
  const challenge_id = currentChallenge;
  const challenge_number = challengeNumber;
  const challenge_intro = challengeIntro;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.intelModal}
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
            onClick={onClose}
          />
        </div>

        <div className={styles.modalBody} style={{ overflowY: "auto" }}>
          {/* Phase Overview */}
          <div className="mb-4">
            <h6 className="fw-bold text-dark mb-2 d-flex align-items-center gap-2 fs-5">
              <Icon icon="ph:clipboard-text-bold" style={{ color: "#dc3545", fontSize: "1.8rem" }} /> Phase Overview
            </h6>
            <div className="p-3 rounded-3 shadow-sm" style={{ background: "#f8f9fa", border: "1px solid #dee2e6" }}>
              <PhaseOverview current_phase={currentPhase} />
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
            <div className="card shadow-sm w-100" style={{ background: "#ffffff", border: "1px solid #dee2e6" }}>
              <h5
                className="card-header"
                style={{ textAlign: "center", background: "rgba(130, 25, 25, 1)", color: "white" }}
              >
                <span style={{ color: "white" }}>
                  <b> {challenge_title}</b>
                </span>
                <span
                  className="text small ms-2"
                  style={{ color: "rgba(255, 255, 255, 0.85)", fontSize: "0.85rem" }}
                >
                  (Challenge {challenge_id + 1}/{challenge_number})
                </span>
              </h5>
              <div className="card-body bg-white text-dark">
                {challenge_intro && (
                  <p className="card-text text-center text-secondary mb-3">
                    <i>{challenge_intro}</i>
                  </p>
                )}
                <p className="card-text text-center text-dark fs-6">
                  {challenge_desc_cutted.map((item, index) => {
                    if (item.type === "text") {
                      return <span key={index}>{item.value} </span>;
                    } else if (item.type === "id") {
                      const st = Object.values(stakeholders).find(
                        (s) => s.name === item.value || s.id === item.value
                      );
                      if (!st) return <span key={index}>{item.value}</span>;
                      return (
                        <HoverTooltip key={index} description={st.role_description}>
                          <span
                            style={{
                              color: st.stakeholder_color,
                              fontWeight: "bold",
                            }}
                          >
                            {st.name}
                          </span>
                        </HoverTooltip>
                      );
                    }
                    return null;
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>


      </div>
    </div>
  );
}
