import { useContext } from "react";
import { PhasesContext } from "./PhaseProvider";

export default function PhaseOverview() {
  const { currentPhase, phases } = useContext(PhasesContext);

  return (
    <div className="d-flex flex-nowrap gap-2 intro1" data-intro-group="intro1" data-intro="The serious game consists of five MLOps phases illustrated by this phase overview. The phases cover the whole development process of ML projects from defining business objectives and architecture, over deployment, to monitoring and maintenance." data-step="2">
      {phases.map((phase, index) => (
        <div key={phase.phase_name} style={{ flex: "1 1 0", minWidth: 0 }}>
          <div
            className="stat-card hover-card p-2 text-white rounded"
            style={{
              backgroundColor:
                index > currentPhase
                  ? "var(--card-bg-locked)"
                  : index === currentPhase
                    ? "var(--card-bg-active)"
                    : "var(--card-bg-done)",
              border:
                index > currentPhase
                  ? "3px solid var(--card-border-default)"
                  : index === currentPhase
                    ? "3px solid var(--card-border-active)"
                    : "3px solid var(--card-border-done)",
            }}
          >
            <div className="d-flex align-items-center gap-2 mb-1">
              <div
                className="stat-icon rounded-circle"
                style={{
                  width: "30px",
                  height: "30px",
                  flexShrink: 0,
                  backgroundColor:
                    index > currentPhase
                      ? "var(--icon-bg-locked)"
                      : index === currentPhase
                        ? "var(--icon-bg-active)"
                        : "var(--icon-bg-done)",
                }}
              >
                <span style={{ fontSize: "0.9rem", lineHeight: 1 }}>
                  {index > currentPhase
                    ? "🔒"
                    : index === currentPhase
                      ? "➡️"
                      : "✅"}
                </span>
              </div>
              <span className="fw-semibold">{phase.phase_name}</span>
            </div>
            <small
              style={{
                color: "rgba(255, 255, 255, 0.95)",
                fontSize: "0.78rem",
                lineHeight: "1.25",
                fontWeight: 400,
                display: "block",
              }}
            >
              {phase.phase_desc ?? "Phase description"}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
