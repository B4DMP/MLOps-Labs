import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Icon } from "@iconify/react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelArtifactViewer from "./IntelArtifactViewer";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import styles from "./offline_intel_gathering.module.css";

interface OfflineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: any;
  onTagArtifact?: (stakeholderId: string) => void;
  isDossierOpen?: boolean;
  setIsDossierOpen?: (open: boolean) => void;
  dossierData?: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
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
  challengeTitle = "",
  challengeDescription = "",
  challengeIntro = "",
  challengeAmount = 1,
  dossierData = [],
  activeStakeholderId,
}: OfflineIntelGatheringProps) {
  const { emit, subscribe } = useGameWebSocket();
  const [artifacts, setArtifacts] = useState<IntelArtifact[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taggedTypes, setTaggedTypes] = useState<Record<string, string>>({});
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

  const hasRequestedRef = useRef(false);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

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
      emit("intel:get_dossier", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
      });
    }

    return () => unsubscribe();
  }, [currentPhase, currentChallenge]);

  useEffect(() => {
    if (artifacts.length > 0 && currentIndex < artifacts.length) {
      const art = artifacts[currentIndex];
      if (art && onTagArtifact) {
        onTagArtifact(art.stakeholder_id || art.stakeholder_name);
      }
    }
  }, [currentIndex, artifacts]);

  const handleTagArtifact = (categorizedType: string) => {
    if (currentIndex >= artifacts.length) return;
    if (transitionTimeoutRef.current) return; // Prevent multiple rapid clicks while transitioning

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

    transitionTimeoutRef.current = setTimeout(() => {
      transitionTimeoutRef.current = null;
      if (currentIndex + 1 < artifacts.length) {
        setDirection(1);
        setCurrentIndex((prev) => prev + 1);
      } else {
        setDirection(1);
        setCurrentIndex(artifacts.length);
      }
    }, 400);
  };

  const handlePrevItem = () => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleNextItem = () => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    setDirection(1);
    if (currentIndex < artifacts.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCurrentIndex(artifacts.length);
    }
  };

  const handleFinalContinue = () => {
    if (!allTagged) return;
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    setIsSubmitting(true);
    onContinue();
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;
  const currentArtifact = artifacts[currentIndex];
  const isFinished = artifacts.length > 0 && currentIndex >= artifacts.length;
  const currentArtifactKey = currentArtifact ? currentArtifact.id || currentArtifact.requirement_id : "";
  const currentTaggedType = currentArtifactKey ? taggedTypes[currentArtifactKey] : undefined;

  const totalArtifactsCount = artifacts.length;
  const taggedArtifactsCount = artifacts.filter((art) => {
    const key = art.id || art.requirement_id;
    return Boolean(taggedTypes[key]);
  }).length;
  const allTagged = totalArtifactsCount > 0 && taggedArtifactsCount === totalArtifactsCount;
  const firstUntaggedIndex = artifacts.findIndex((art) => {
    const key = art.id || art.requirement_id;
    return !taggedTypes[key];
  });

  const currentStakeholderId = currentArtifact?.stakeholder_id || currentArtifact?.stakeholder_name;

  return (
    <div className="game-container">
      {/* Main Content Area over Game Background Canvas */}
      <div
        className="container-fluid flex-grow-1 d-flex flex-column p-2 p-md-3 position-relative overflow-auto"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          height: "100%",
        }}
      >
        {/* Main Board Grid: Left Column = Stakeholder Dossier (2/5), Right Column = Artifact Viewer & Categorization (3/5) */}
        <div className="row g-3 align-items-stretch flex-grow-1 h-100">
          {/* LEFT COLUMN: Stakeholder Dossier (2/5 of screen) */}
          <div className={`col-12 d-flex flex-column h-100 ${styles.leftColumnDossier}`}>
            <div className="flex-grow-1 h-100" style={{ minHeight: "500px" }}>
              <StakeholderDossier
                isOpen={true}
                canClose={false}
                isEmbedded={true}
                dossierData={dossierData || []}
                activeStakeholderId={activeStakeholderId || currentStakeholderId}
                currentPhase={currentPhase}
                currentChallenge={currentChallenge}
                onClose={() => {}}
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Offline Intel Gathering Artifact Viewer & Categorization (3/5 of screen) */}
          <div className={`col-12 d-flex flex-column h-100 ${styles.rightColumnIntel}`}>
            {/* Transparent Div Wrapper */}
            <div
              className="transparent-div p-2 p-md-3 shadow-lg flex-grow-1 d-flex flex-column w-100 h-100"
              style={{
                borderRadius: "16px",
                minHeight: 0,
              }}
            >
              {/* Header Title inside transparent-div */}
              <div className="w-100 d-flex justify-content-between align-items-center mb-1 flex-shrink-0">
                <span className="transparent-div-label mb-0">
                  🔍 Offline Intel Gathering
                </span>

                {/* Quick direct item navigation pills */}
                {artifacts.length > 0 && (
                  <div
                    className="d-flex align-items-center gap-1 overflow-x-auto py-1 px-1"
                    style={{ scrollbarWidth: "none" }}
                  >
                    {artifacts.map((art, idx) => {
                      const key = art.id || art.requirement_id;
                      const isTagged = !!taggedTypes[key];
                      const isCurrent = idx === currentIndex;
                      return (
                        <button
                          key={key || idx}
                          onClick={() => {
                            if (transitionTimeoutRef.current) {
                              clearTimeout(transitionTimeoutRef.current);
                              transitionTimeoutRef.current = null;
                            }
                            setDirection(idx >= currentIndex ? 1 : -1);
                            setCurrentIndex(idx);
                            if (onTagArtifact) {
                              onTagArtifact(art.stakeholder_id || art.stakeholder_name);
                            }
                          }}
                          className="btn btn-xs px-2 py-0 fw-bold"
                      style={{
                        fontSize: "0.7rem",
                        whiteSpace: "nowrap",
                        height: "24px",
                        lineHeight: "22px",
                        borderRadius: "0.5rem",
                        backgroundColor: isTagged ? "var(--primary-bg)" : "#6c757d",
                        borderColor: isCurrent ? "#ffffff" : isTagged ? "var(--primary-bg)" : "#6c757d",
                        borderWidth: isCurrent ? "1.5px" : "1px",
                        borderStyle: "solid",
                        color: "#ffffff",
                        boxShadow: "none",
                        opacity: isCurrent ? 1 : 0.85,
                        transition: "all var(--transition)",
                        flexShrink: 0,
                      }}
                      title={`Jump to item ${idx + 1}: ${art.stakeholder_name} (${isTagged ? "Categorized" : "Uncategorized"})`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bootswatch Journal Card */}
          <div
            className="card border-secondary shadow-sm text-start w-100 flex-grow-1 d-flex flex-column"
            style={{
              borderRadius: "12px",
              overflow: "hidden",
              minHeight: 0,
            }}
          >
            {loading ? (
              <div className="card-body bg-light p-4 text-center my-3 d-flex flex-column justify-content-center align-items-center flex-grow-1">
                <div className="spinner-border text-primary mb-3" style={{ width: "2.5rem", height: "2.5rem" }} role="status" />
                <h5 className="fw-bold text-dark mb-2">Generating Offline Intel Artifacts...</h5>
                <p className="text-muted fs-6 mb-0">Analyzing scenario specifications across stakeholder items.</p>
              </div>
            ) : isFinished ? (
              /* Completion State / Summary Screen */
              <div className="d-flex flex-column flex-grow-1 h-100" style={{ minHeight: 0 }}>
                {/* Header matching Journal style */}
                <div className="card-header bg-light border-bottom d-flex justify-content-between align-items-center py-1 px-3 flex-shrink-0">
                  <div className="d-flex align-items-center gap-2">
                    <Icon
                      icon={allTagged ? "ph:check-circle-bold" : "ph:warning-circle-bold"}
                      className={allTagged ? "text-success" : "text-warning"}
                      style={{ fontSize: "1.1rem" }}
                    />
                    <strong className="text-dark" style={{ fontSize: "0.82rem" }}>
                      {allTagged ? "Intel Artifacts Tagged" : "Incomplete Intel Categorization"}
                    </strong>
                  </div>
                  <span
                    className={`badge ${allTagged ? "bg-primary text-white" : "bg-warning text-dark"} fw-bold`}
                    style={{ fontSize: "0.7rem" }}
                  >
                    {taggedArtifactsCount} / {totalArtifactsCount} Categorized
                  </span>
                </div>

                <div className="card-body bg-light p-4 d-flex flex-column justify-content-center align-items-center flex-grow-1 text-center" style={{ minHeight: 0 }}>
                  {allTagged ? (
                    <>
                      <div
                        className="mb-3 d-flex align-items-center justify-content-center shadow-sm"
                        style={{
                          width: "64px",
                          height: "64px",
                          borderRadius: "50%",
                          backgroundColor: "var(--primary-bg)",
                          border: "1px solid var(--secondary-bg)",
                          color: "#ffffff",
                          fontSize: "2rem",
                        }}
                      >
                        <Icon icon="ph:check-bold" />
                      </div>
                      <h4 className="fw-bold text-dark mb-2">Intel Artifacts Tagged!</h4>
                      <p className="text-muted mb-4 fs-6" style={{ maxWidth: "520px" }}>
                        All {totalArtifactsCount} stakeholder requirement stances have been categorized and recorded as <strong className="text-dark">unconfirmed intel</strong> in your Stakeholder Dossier.
                      </p>
                    </>
                  ) : (
                    <>
                      <div
                        className="mb-3 d-flex align-items-center justify-content-center shadow-sm"
                        style={{
                          width: "64px",
                          height: "64px",
                          borderRadius: "50%",
                          backgroundColor: "#f59e0b",
                          border: "1px solid #d97706",
                          color: "#ffffff",
                          fontSize: "2rem",
                        }}
                      >
                        <Icon icon="ph:warning-bold" />
                      </div>
                      <h4 className="fw-bold text-dark mb-2">Not All Artifacts Have Been Tagged</h4>
                      <p className="text-muted mb-4 fs-6" style={{ maxWidth: "520px" }}>
                        You have categorized <strong className="text-dark">{taggedArtifactsCount} of {totalArtifactsCount}</strong> artifacts. All artifacts must be tagged before proceeding to Online Intel Gathering.
                      </p>
                    </>
                  )}

                  {/* Action buttons styled like login screen button */}
                  <div className="d-flex justify-content-center align-items-center gap-3 flex-wrap mt-2">
                    <button
                      onClick={() => {
                        if (transitionTimeoutRef.current) {
                          clearTimeout(transitionTimeoutRef.current);
                          transitionTimeoutRef.current = null;
                        }
                        setDirection(-1);
                        setCurrentIndex(0);
                      }}
                      className={styles.secondaryButton}
                    >
                      ◀ Review All Tags
                    </button>

                    {!allTagged ? (
                      <button
                        onClick={() => {
                          if (transitionTimeoutRef.current) {
                            clearTimeout(transitionTimeoutRef.current);
                            transitionTimeoutRef.current = null;
                          }
                          const targetIdx = firstUntaggedIndex !== -1 ? firstUntaggedIndex : 0;
                          setDirection(targetIdx >= currentIndex ? 1 : -1);
                          setCurrentIndex(targetIdx);
                        }}
                        className={`${styles.actionButton} shadow-sm d-inline-flex align-items-center justify-content-center gap-2`}
                        style={{ width: "auto" }}
                      >
                        <Icon icon="ph:arrow-circle-right-bold" style={{ fontSize: "1.2rem" }} />
                        <span>Categorize Remaining ({totalArtifactsCount - taggedArtifactsCount} Left)</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleFinalContinue}
                        disabled={isSubmitting}
                        className={`${styles.actionButton} shadow-sm d-inline-flex align-items-center justify-content-center gap-2`}
                        style={{ width: "auto" }}
                      >
                        {isSubmitting ? (
                          <>
                            <span className="spinner-border spinner-border-sm" role="status" />
                            <span>Proceeding...</span>
                          </>
                        ) : (
                          <>
                            <span>Continue to Online Intel Gathering</span>
                            <Icon icon="ph:arrow-right-bold" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : currentArtifact ? (
              /* Active Tagging View */
              <div className="d-flex flex-column flex-grow-1 h-100" style={{ minHeight: 0 }}>
                {/* Card Header with Item Counter & Badges */}
                <div className="card-header bg-light border-bottom d-flex justify-content-between align-items-center py-1 px-3 flex-shrink-0">
                  <div className="d-flex align-items-center gap-2">
                    <strong className="text-dark" style={{ fontSize: "0.82rem" }}>
                      Artifact {currentIndex + 1} of {artifacts.length}
                    </strong>
                    <span
                      className="badge fw-semibold"
                      style={{ fontSize: "0.65rem", background: "var(--primary-bg)", color: "white" }}
                    >
                      {currentArtifact.artifact_type.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="card-body bg-light p-3 d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
                  {/* Challenge Description Card above Artifact Viewer */}
                  {(challengeTitle || challengeDescription) && (
                    <div className="mb-2 flex-shrink-0">
                      <ChallengeDescriptionCard
                        challengeTitle={challengeTitle}
                        challengeDescription={challengeDescription}
                        challengeIntro={challengeIntro}
                        currentChallenge={currentChallenge}
                        challengeAmount={challengeAmount}
                      />
                    </div>
                  )}

                  {/* Formatted MLOps Intel Artifact Viewer with Left and Right Navigation Buttons */}
                  <div className="d-flex align-items-center gap-2 mb-3 flex-grow-1 position-relative" style={{ minHeight: 0 }}>
                    {/* Previous Button (Left) */}
                    <button
                      onClick={handlePrevItem}
                      disabled={currentIndex <= 0}
                      className={styles.navButton}
                      title="Previous Intel Artifact"
                      aria-label="Previous Intel Artifact"
                    >
                      <Icon icon="ph:caret-left-bold" style={{ fontSize: "1.5rem" }} />
                    </button>

                    {/* Artifact Viewer with Slide Transition */}
                    <div className="flex-grow-1 h-100 position-relative overflow-hidden d-flex flex-column" style={{ minHeight: 0 }}>
                      <AnimatePresence mode="wait" custom={direction}>
                        <motion.div
                          key={`${currentIndex}-${currentArtifactKey}`}
                          custom={direction}
                          initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="h-100 flex-grow-1 d-flex flex-column"
                          style={{ minHeight: 0 }}
                        >
                          <IntelArtifactViewer
                            content={currentArtifact.content}
                            artifactType={currentArtifact.artifact_type}
                            stakeholderName={currentArtifact.stakeholder_name}
                            stakeholderRole={currentArtifact.stakeholder_role}
                          />
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    {/* Next / Finish Button (Right) */}
                    <button
                      onClick={handleNextItem}
                      className={styles.navButton}
                      title={currentIndex < artifacts.length - 1 ? "Next Intel Artifact" : "Finish / View Summary"}
                      aria-label={currentIndex < artifacts.length - 1 ? "Next Intel Artifact" : "Finish / View Summary"}
                    >
                      <Icon
                        icon={currentIndex < artifacts.length - 1 ? "ph:caret-right-bold" : "ph:arrow-right-bold"}
                        style={{ fontSize: "1.5rem" }}
                      />
                    </button>
                  </div>

                  {/* Compact Tagging Prompt & Buttons Panel */}
                  <div className="card border-secondary p-2 p-md-3 bg-white shadow-sm flex-shrink-0">
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
                                  <span>{tag.icon}</span>{" "}
                                  <span style={{ color: tag.color, fontWeight: 700 }}>{tag.label}</span>
                                </span>
                                {isSelected && (
                                  <span className="badge text-white rounded-pill px-2 py-1 shadow-sm" style={{ backgroundColor: "var(--primary-bg)", fontSize: "0.65rem" }}>
                                    Selected
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
      </div>
    </div>
  );
}

