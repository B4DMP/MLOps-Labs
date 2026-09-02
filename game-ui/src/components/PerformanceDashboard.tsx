import { Icon } from "@iconify/react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import type { ActionCard } from "../types/ActionCard";
import styles from "./PerformanceDashboard.module.css";

interface PerformanceDashboardProps {
  isOpen: boolean;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
}

export default function PerformanceDashboard({
  isOpen,
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
  challengeTitle = "",
  challengeDescription = "",
  challengeIntro = "",
  challengeAmount = 1,
}: PerformanceDashboardProps) {
  return (
    <div
      className={`${styles.helpOverlayLayer} ${isOpen ? styles.helpLayerVisible : styles.helpLayerHidden
        }`}
    >
      <div className="container-fluid h-100 d-flex flex-column gap-3 p-1 p-md-2" style={{ maxWidth: "1400px" }}>
        {/* Top Header Label */}
        <div className="d-flex align-items-center gap-2 mb-1">
          <Icon
            icon="material-symbols:dashboard-rounded"
            style={{ fontSize: "1.8rem", color: "var(--primary-bg)" }}
          />
          <h4 className="fw-bold text-white mb-0" style={{ letterSpacing: "0.05em" }}>
            Performance Dashboard
          </h4>
        </div>

        {/* Phase Overview Section */}
        <div className="w-100 flex-shrink-0">
          <div className="transparent-div p-3 shadow-lg">
            <span className="transparent-div-label mb-2 d-flex align-items-center gap-2 fs-6">
              <Icon icon="ph:clipboard-text-bold" style={{ color: "var(--primary-bg)", fontSize: "1.2rem" }} /> Phase Overview
            </span>
            <div className="pt-1">
              <PhaseOverview />
            </div>
          </div>
        </div>

        {/* Performance Metrics Section (below Phase Overview) */}
        <div className="w-100 flex-shrink-0">
          <div className="transparent-div p-3 shadow-lg">
            <span className="transparent-div-label mb-2 d-flex align-items-center gap-2 fs-6">
              <Icon icon="ph:chart-bar-bold" style={{ color: "var(--primary-bg)", fontSize: "1.2rem" }} /> Performance Metrics
            </span>
            <div className="pt-1">
              <MetricTab
                current_phase={currentPhase}
                showMetricValueChanges={showMetricValueChanges}
                last_ac={last_ac}
              />
            </div>
          </div>
        </div>

        {/* Challenge Description Section */}
        <div className="w-100 flex-grow-1">
          <div className="transparent-div p-3 shadow-lg h-100">
            <span className="transparent-div-label mb-2 d-flex align-items-center gap-2 fs-6">
              <Icon icon="ph:target-bold" style={{ color: "var(--primary-bg)", fontSize: "1.2rem" }} /> MLOps Project Graph
            </span>
            <div className="pt-1">

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
