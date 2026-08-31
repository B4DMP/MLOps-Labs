import { useState, useEffect, useRef } from "react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelArtifactViewer from "./IntelArtifactViewer";

interface OfflineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: any;
  onTagArtifact?: (stakeholderId: string) => void;
  isDossierOpen?: boolean;
  setIsDossierOpen?: (open: boolean) => void;
  dossierData?: any[];
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
  categorized_type?: string;
}

const REQUIREMENT_TAGS = [
  {
    type: "requirement",
    label: "Core Requirement",
    icon: "📋",
    color: "#2563eb",
    description: "Core operational or technical project requirement.",
  },
  {
    type: "negotiable_preference",
    label: "Negotiable Preference",
    icon: "🤝",
    color: "#16a34a",
    description: "Desirable tool or workflow choice open to compromise.",
  },
  {
    type: "personal_friction",
    label: "Personal Friction",
    icon: "⚡",
    color: "#d97706",
    description: "Interpersonal concern or personal workflow friction.",
  },
];

export default function OfflineIntelGathering({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  onTagArtifact,
}: OfflineIntelGatheringProps) {
  const { emit, subscribe } = useGameWebSocket();
  const [artifacts, setArtifacts] = useState<IntelArtifact[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taggedTypes, setTaggedTypes] = useState<Record<string, string>>({});
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

  const hasRequestedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribe("intel:offline_artifacts", (data: any) => {
      if (data && data.artifacts) {
        setArtifacts(data.artifacts);
        const initialTagged: Record<string, string> = {};
        data.artifacts.forEach((art: IntelArtifact) => {
          if (art.categorized_type) {
            initialTagged[art.id || art.requirement_id] = art.categorized_type;
          }
        });
        setTaggedTypes(initialTagged);
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
    const artKey = currentArtifact.id || currentArtifact.requirement_id;

    setTaggedTypes((prev) => ({
      ...prev,
      [artKey]: categorizedType,
    }));

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
    }
  };

  const handlePrevItem = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleNextItem = () => {
    if (currentIndex < artifacts.length - 1) {
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
  const currentArtifactKey = currentArtifact ? currentArtifact.id || currentArtifact.requirement_id : "";
  const currentTaggedType = currentArtifactKey ? taggedTypes[currentArtifactKey] : undefined;

  return (
    <div className="game-container">
      {/* Main Content Area over Game Background Canvas */}
      <div
        className="container-fluid flex-grow-1 d-flex flex-column align-items-center justify-content-start overflow-auto p-2 p-md-3 position-relative"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Transparent Div Wrapper */}
        <div
          className="transparent-div p-2 p-md-3 shadow-lg mb-3"
          style={{
            maxWidth: "1240px",
            width: "100%",
            borderRadius: "16px",
          }}
        >
          {/* Header Title inside transparent-div */}
          <div className="w-100 d-flex justify-content-between align-items-center mb-2">
            <span className="transparent-div-label fs-6 mb-0 d-flex align-items-center gap-2">
              🔍 Offline Intel Gathering
            </span>

            {/* Quick direct item navigation pills */}
            {artifacts.length > 0 && !isFinished && (
              <div className="d-flex align-items-center gap-1 overflow-x-auto">
                {artifacts.map((art, idx) => {
                  const key = art.id || art.requirement_id;
                  const isTagged = !!taggedTypes[key];
                  const isCurrent = idx === currentIndex;
                  return (
                    <button
                      key={key || idx}
                      onClick={() => setCurrentIndex(idx)}
                      className={`btn btn-xs rounded-pill px-2 py-0 fw-bold ${
                        isCurrent
                          ? "btn-dark text-white border-2 border-light"
                          : isTagged
                          ? "btn-success text-dark opacity-90"
                          : "btn-outline-secondary text-white"
                      }`}
                      style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}
                      title={`Jump to item ${idx + 1}: ${art.stakeholder_name}`}
                    >
                      {idx + 1} {isTagged ? "✓" : "•"}
                    </button>
                  );
                })}
              </div>
            )}
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
              <div className="card-body bg-light p-4 text-center my-3">
                <div className="spinner-border text-primary mb-3" style={{ width: "2.5rem", height: "2.5rem" }} role="status" />
                <h5 className="fw-bold text-dark mb-2">Generating Offline Intel Artifacts...</h5>
                <p className="text-muted fs-6 mb-0">Analyzing scenario specifications across stakeholder items.</p>
              </div>
            ) : isFinished ? (
              /* Completion State */
              <div className="card-body bg-light p-4 text-center">
                <div
                  className="mx-auto mb-3 d-flex align-items-center justify-content-center"
                  style={{
                    width: "70px",
                    height: "70px",
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    borderRadius: "50%",
                    fontSize: "2rem",
                    boxShadow: "0 6px 16px rgba(16, 185, 129, 0.35)",
                    color: "#ffffff"
                  }}
                >
                  ✓
                </div>
                <h3 className="fw-bold text-dark mb-2">Intel Artifacts Tagged!</h3>
                <p className="text-muted mb-4 fs-6" style={{ maxWidth: "480px", margin: "0 auto" }}>
                  Your tagged requirement stances have been logged as <strong className="text-dark">unconfirmed intel</strong> in your Stakeholder Dossier.
                </p>
                <div className="d-flex justify-content-center align-items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setCurrentIndex(0)}
                    className="btn btn-outline-secondary btn-md px-4 py-2 rounded-pill fw-bold shadow-sm"
                    style={{ color: "#000000" }}
                  >
                    ◀ Review / Edit Tags
                  </button>
                  <button
                    onClick={handleFinalContinue}
                    disabled={isSubmitting}
                    className="btn btn-primary btn-md px-5 py-2 rounded-pill fw-bold shadow-sm"
                    style={{ color: "#000000" }}
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
              </div>
            ) : currentArtifact ? (
              /* Active Tagging View */
              <div>
                {/* Card Header with Top Left & Right Arrow Navigation */}
                <div className="card-header bg-dark text-white d-flex justify-content-between align-items-center py-2 px-3">
                  {/* Left Arrow Button */}
                  <button
                    onClick={handlePrevItem}
                    disabled={currentIndex <= 0}
                    className="btn btn-sm btn-light text-dark fw-bold d-flex align-items-center gap-1 shadow-sm px-3 py-1"
                    style={{ color: "#000000", opacity: currentIndex <= 0 ? 0.4 : 1 }}
                    title="Previous Intel Item (◀)"
                  >
                    ◀ Prev
                  </button>

                  {/* Item counter indicator */}
                  <div className="text-center">
                    <span className="fw-bold fs-6 me-2">
                      Artifact {currentIndex + 1} of {artifacts.length}
                    </span>
                    <span className="badge bg-secondary text-white me-2">
                      {currentArtifact.artifact_type.toUpperCase()}
                    </span>
                    {currentTaggedType ? (
                      <span className="badge bg-success text-dark fw-bold" style={{ color: "#000000" }}>
                        ✓ {REQUIREMENT_TAGS.find((t) => t.type === currentTaggedType)?.label || currentTaggedType}
                      </span>
                    ) : (
                      <span className="badge bg-warning text-dark fw-bold" style={{ color: "#000000" }}>
                        Uncategorized
                      </span>
                    )}
                  </div>

                  {/* Right Arrow Button */}
                  <button
                    onClick={handleNextItem}
                    className="btn btn-sm btn-light text-dark fw-bold d-flex align-items-center gap-1 shadow-sm px-3 py-1"
                    style={{ color: "#000000" }}
                    title={currentIndex < artifacts.length - 1 ? "Next Intel Item (▶)" : "Finish / View Summary"}
                  >
                    {currentIndex < artifacts.length - 1 ? "Next ▶" : "Finish ▶"}
                  </button>
                </div>

                <div className="card-body bg-light p-3">
                  {/* Formatted MLOps Intel Artifact Viewer */}
                  <div className="mb-3">
                    <IntelArtifactViewer
                      content={currentArtifact.content}
                      artifactType={currentArtifact.artifact_type}
                      stakeholderName={currentArtifact.stakeholder_name}
                      stakeholderRole={currentArtifact.stakeholder_role}
                    />
                  </div>

                  {/* Compact Tagging Prompt & Buttons Panel */}
                  <div className="card border-secondary p-2 p-md-3 bg-white shadow-sm">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h6 className="fw-bold text-dark mb-0 fs-6">
                        Categorize {currentArtifact.stakeholder_name}'s stance:
                      </h6>
                      <small className="text-muted" style={{ fontSize: "0.78rem" }}>Select a category below</small>
                    </div>

                    <div className="row g-2">
                      {REQUIREMENT_TAGS.map((tag) => {
                        const isSelected = currentTaggedType === tag.type;
                        const isHovered = hoveredTag === tag.type;
                        return (
                          <div key={tag.type} className="col-12 col-md-4">
                            <button
                              onClick={() => handleTagArtifact(tag.type)}
                              onMouseEnter={() => setHoveredTag(tag.type)}
                              onMouseLeave={() => setHoveredTag(null)}
                              className="btn w-100 py-2 px-3 text-start rounded-3 h-100 d-flex flex-column justify-content-between position-relative"
                              style={{
                                backgroundColor: "#ffffff",
                                border: isSelected
                                  ? `3px solid ${tag.color}`
                                  : `2px solid ${tag.color}`,
                                boxShadow: isSelected
                                  ? "0 4px 12px rgba(0, 0, 0, 0.15)"
                                  : isHovered
                                  ? "0 6px 14px rgba(0, 0, 0, 0.12)"
                                  : "0 2px 5px rgba(0, 0, 0, 0.06)",
                                transform: isHovered ? "translateY(-2px)" : "translateY(0px)",
                                color: "#000000",
                                cursor: "pointer",
                                minHeight: "68px",
                                transition: "all 0.15s ease-in-out",
                              }}
                            >
                              <div className="fw-bold d-flex align-items-center justify-content-between mb-1" style={{ color: "#000000", fontSize: "0.9rem" }}>
                                <span className="d-flex align-items-center gap-1" style={{ color: "#000000" }}>
                                  <span style={{ transform: isHovered ? "scale(1.15)" : "scale(1)", transition: "transform 0.15s ease" }}>{tag.icon}</span>{" "}
                                  <span style={{ color: tag.color, fontWeight: 700 }}>{tag.label}</span>
                                </span>
                                {isSelected && (
                                  <span className="badge text-white rounded-pill px-2 py-1 shadow-sm" style={{ backgroundColor: tag.color, fontSize: "0.65rem" }}>
                                    ✓ Selected
                                  </span>
                                )}
                              </div>
                              <small className="d-block fw-semibold text-truncate" style={{ fontSize: "0.75rem", color: "#334155", opacity: 0.95 }} title={tag.description}>
                                {tag.description}
                              </small>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card-body bg-light p-4 text-center">
                <p className="text-muted">No artifacts available for this challenge.</p>
                <button onClick={handleFinalContinue} className="btn btn-primary" style={{ color: "#000000" }}>
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

