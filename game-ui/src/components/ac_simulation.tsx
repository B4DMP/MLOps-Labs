import React, { useState } from "react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import type { ActionCard } from "../types/ActionCard";

interface AcSimulationProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
}

export default function AcSimulation({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
}: AcSimulationProps) {
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
            🚀 System Action Simulation
          </span>

          {/* Bootswatch Journal Theme Card */}
          <div
            className="card border-secondary shadow-sm text-start w-100"
            style={{
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            <div className="card-header bg-dark text-white d-flex align-items-center justify-content-between py-3 px-4">
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: "1.5rem" }}>🚀</span>
                <h4 className="mb-0 fw-bold text-white">System Action Simulation</h4>
              </div>
              <span className="badge bg-secondary text-white fw-bold px-3 py-2 fs-6">
                Loop 3 of 4
              </span>
            </div>

            <div className="card-body bg-light p-4 p-md-5">
              <div className="alert alert-warning border-warning mb-4" role="alert">
                <h5 className="alert-heading fw-bold mb-1">⚡ Simulation Objective</h5>
                <p className="mb-0 fs-6" style={{ lineHeight: "1.6" }}>
                  Simulating the technical and operational impact of your selected action card on the enterprise environment.
                </p>
              </div>

              <p className="text-muted fs-6 mb-4">
                Review metric value progressions and assess stakeholder satisfaction outcomes before advancing to the next challenge phase.
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
                    Advancing...
                  </>
                ) : (
                  "Finalize Challenge & Continue ▶"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
