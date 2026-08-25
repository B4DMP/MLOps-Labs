import React, { useState, useEffect, useRef } from "react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelArtifactViewer from "./IntelArtifactViewer";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import type { ActionCard } from "../types/ActionCard";

interface OfflineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
  onTagArtifact?: (stakeholderId: string) => void;
  isDossierOpen?: boolean;
  setIsDossierOpen?: (open: boolean) => void;
  dossierData?: StakeholderDossierEntry[];
  activeStakeholderId?: string;
}

export interface IntelArtifact {
  id: string;
  requirement_id: string;
  stakeholder_id: string;
  stakeholder_name: string;
  stakeholder_role: string;
  artifact_type: string;
  content: string;
}

const REQUIREMENT_TAGS = [
  {
    type: "hard_constraint",
    label: "Hard Constraint",
    icon: "🚫",
    color: "btn-outline-danger",
    description: "Non-negotiable security, regulatory, or technical constraint.",
  },
  {
    type: "requirement",
    label: "Requirement",
    icon: "📋",
    color: "btn-outline-primary",
    description: "Core operational or technical project requirement.",
  },
  {
    type: "negotiable_preference",
    label: "Negotiable Preference",
    icon: "🤝",
    color: "btn-outline-success",
    description: "Desirable tool or workflow choice open to compromise.",
  },
  {
    type: "personal_friction",
    label: "Personal Friction",
    icon: "⚡",
    color: "btn-outline-warning",
    description: "Interpersonal concern or personal workflow friction.",
  },
];

export default function OfflineIntelGathering({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
  onTagArtifact,
  isDossierOpen = false,
  setIsDossierOpen,
  dossierData = [],
  activeStakeholderId,
}: OfflineIntelGatheringProps) {
  const { emit, subscribe } = useGameWebSocket();
  const [artifacts, setArtifacts] = useState<IntelArtifact[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasRequestedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribe("intel:offline_artifacts", (data: any) => {
      if (data && data.artifacts) {
        setArtifacts(data.artifacts);
        setCurrentIndex(0);
      }
      setLoading(false);
    });

    if (!hasRequestedRef.current) {
      hasRequestedRef.current = true;
      emit("intel:get_offline_artifacts", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
      });
    }

    return () => unsubscribe();
  }, [currentPhase, currentChallenge]);

  const handleTagArtifact = (categorizedType: string) => {
    if (currentIndex >= artifacts.length) return;

    const currentArtifact = artifacts[currentIndex];

    if (onTagArtifact) {
      onTagArtifact(currentArtifact.stakeholder_id || currentArtifact.stakeholder_name);
    }

    emit("intel:tag_item", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      requirement_id: currentArtifact.requirement_id,
      categorized_type: categorizedType,
    });

    emit("intel:get_dossier", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
    });

    if (currentIndex + 1 < artifacts.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCurrentIndex(artifacts.length);
    }
  };

  const handleFinalContinue = () => {
    setIsSubmitting(true);
    onContinue();
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;
  const currentArtifact = artifacts[currentIndex];
  const isFinished = artifacts.length > 0 && currentIndex >= artifacts.length;

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
        className="container-fluid flex-grow-1 d-flex flex-column align-items-center justify-content-start overflow-auto p-4 position-relative"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Transparent Div Wrapper (matching Phase Overview style) */}
        <div
          className="transparent-div p-3 p-md-4 shadow-lg mb-4"
          style={{
            maxWidth: "960px",
            width: "100%",
            borderRadius: "16px",
          }}
        >
          {/* Header Title inside transparent-div */}
          <div className="w-100 d-flex justify-content-between align-items-center mb-3">
            <span className="transparent-div-label fs-6 mb-0 d-flex align-items-center gap-2">
              🔍 Offline Intel Gathering
            </span>
          </div>

          {/* Bootswatch Journal Card */}
          <div
            className="card border-secondary shadow-sm text-start w-100"
            style={{
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            {loading ? (
              <div className="card-body bg-light p-5 text-center my-4">
                <div className="spinner-border text-primary mb-3" style={{ width: "3rem", height: "3rem" }} role="status" />
                <h5 className="fw-bold text-dark mb-2">Generating Offline Intel Artifacts...</h5>
                <p className="text-muted fs-6 mb-0">Analyzing scenario specifications across 5 stakeholder items.</p>
              </div>
            ) : isFinished ? (
              /* Completion State */
              <div className="card-body bg-light p-5 text-center">
                <div
                  className="mx-auto mb-4 d-flex align-items-center justify-content-center"
                  style={{
                    width: "80px",
                    height: "80px",
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    borderRadius: "50%",
                    fontSize: "2.2rem",
                    boxShadow: "0 8px 20px rgba(16, 185, 129, 0.4)",
                    color: "#ffffff"
                  }}
                >
                  ✓
                </div>
                <h3 className="fw-bold text-dark mb-2">All Intel Artifacts Tagged!</h3>
                <p className="text-muted mb-4 fs-6" style={{ maxWidth: "480px", margin: "0 auto" }}>
                  Your tagged requirement stances have been logged as <strong className="text-dark">unconfirmed intel</strong> in your Stakeholder Dossier.
                </p>
                <button
                  onClick={handleFinalContinue}
                  disabled={isSubmitting}
                  className="btn btn-primary btn-lg px-5 py-3 rounded-pill fw-bold shadow-sm"
                >
                  {isSubmitting ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" />
                      Proceeding...
                    </>
                  ) : (
                    "Continue to Online Intel Gathering ▶"
                  )}
                </button>
              </div>
            ) : currentArtifact ? (
              /* Active Tagging View */
              <div>
                {/* Card Header */}
                <div className="card-header bg-dark text-white d-flex justify-content-between align-items-center py-3 px-4">
                  <span className="fw-bold fs-6">
                    Artifact {currentIndex + 1} of {artifacts.length}
                  </span>
                  <span className="badge bg-secondary text-white fw-bold">
                    {currentArtifact.artifact_type.toUpperCase()}
                  </span>
                </div>

                <div className="card-body bg-light p-4">
                  {/* Formatted MLOps Intel Artifact Viewer */}
                  <div className="mb-4">
                    <IntelArtifactViewer
                      content={currentArtifact.content}
                      artifactType={currentArtifact.artifact_type}
                      stakeholderName={currentArtifact.stakeholder_name}
                      stakeholderRole={currentArtifact.stakeholder_role}
                    />
                  </div>

                  {/* Tagging Prompt & Buttons */}
                  <div className="card border-secondary p-3 bg-white shadow-sm">
                    <h6 className="fw-bold text-dark mb-2 text-center">
                      Categorize {currentArtifact.stakeholder_name}'s stance into a requirement category:
                    </h6>

                    <div className="row g-2">
                      {REQUIREMENT_TAGS.map((tag) => (
                        <div key={tag.type} className="col-6">
                          <button
                            onClick={() => handleTagArtifact(tag.type)}
                            className={`btn ${tag.color} w-100 p-3 text-start rounded-3 shadow-sm h-100 d-flex flex-column justify-content-between`}
                          >
                            <div className="fw-bold d-flex align-items-center gap-2 fs-6 mb-1">
                              <span>{tag.icon}</span> {tag.label}
                            </div>
                            <small className="d-block opacity-75" style={{ fontSize: "0.78rem", lineHeight: "1.3" }}>
                              {tag.description}
                            </small>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card-body bg-light p-5 text-center">
                <p className="text-muted">No artifacts available for this challenge.</p>
                <button onClick={handleFinalContinue} className="btn btn-primary">
                  Continue
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
