import React, { useState } from "react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import type { ActionCard } from "../types/ActionCard";

interface OnlineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
}

export default function OnlineIntelGathering({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
}: OnlineIntelGatheringProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    setLoading(true);
    onContinue();
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;

  return (
    <div className="game-container">
      {/* Top Navbar Header matching PitchDebate */}
      <nav
        className="navbar navbar-expand-lg flex-shrink-0"
        style={{ backgroundColor: "var(--primary-bg)" }}
      >
        <div
          className="container-fluid d-flex align-items-stretch py-1"
          style={{ gap: "1rem" }}
          data-bs-theme="dark"
        >
          <div className="transparent-div" style={{ flex: "0 0 50%" }}>
            <span className="transparent-div-label">📋 Phase Overview</span>
            <PhaseOverview />
          </div>
          <div className="transparent-div" style={{ flex: "1 1 0" }}>
            <span className="transparent-div-label">📊 Performance Metrics</span>
            <MetricTab
              current_phase={currentPhase}
              showMetricValueChanges={showMetricValueChanges}
              last_ac={last_ac}
            />
          </div>
        </div>
      </nav>

      {/* Main Content Area over Game Background Canvas */}
      <div
        className="container-fluid flex-grow-1 d-flex align-items-center justify-content-center overflow-auto p-4 position-relative"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Transparent Div Wrapper (matching Phase Overview style) */}
        <div
          className="transparent-div p-3 p-md-4 shadow-lg"
          style={{
            maxWidth: "800px",
            width: "100%",
            borderRadius: "16px",
          }}
        >
          <span className="transparent-div-label fs-6 mb-3 d-flex align-items-center gap-2">
            🌐 Online Intel Gathering
          </span>

          {/* Bootswatch Journal Theme Card */}
          <div
            className="card border-secondary shadow-sm text-start w-100"
            style={{
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            <div className="card-header bg-primary text-white d-flex align-items-center justify-content-between py-3 px-4">
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: "1.5rem" }}>🌐</span>
                <h4 className="mb-0 fw-bold text-white">Online Intel Gathering</h4>
              </div>
              <span className="badge bg-light text-dark fw-bold px-3 py-2 fs-6">
                Loop 1 of 4
              </span>
            </div>

            <div className="card-body bg-light p-4 p-md-5">
              <div className="alert alert-info border-info mb-4" role="alert">
                <h5 className="alert-heading fw-bold mb-1">🔍 Phase Objective</h5>
                <p className="mb-0 fs-6" style={{ lineHeight: "1.6" }}>
                  Research live industry patterns and gather data online. Compare the project state against standard MLOps best practices and formulate concrete technical proposals.
                </p>
              </div>

              <p className="text-muted fs-6 mb-4">
                Your research insights will be processed and used to inform the upcoming pitch debate and action card selection.
              </p>

              <button
                onClick={handleClick}
                disabled={loading}
                className="btn btn-primary btn-lg w-100 py-3 rounded-pill fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2"
                style={{ fontSize: "1.1rem" }}
              >
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    Processing Online Intel...
                  </>
                ) : (
                  "Continue to Pitch Debate ▶"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
