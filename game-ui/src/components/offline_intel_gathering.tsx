import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Icon } from "@iconify/react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelArtifactViewer from "./IntelArtifactViewer";
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
  is_convincer_profile?: boolean;
  possible_archetypes?: string[];
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

const CONVINCER_TAGS = [
  {
    type: "Technical Excellence",
    label: "Technical Excellence",
    icon: "⚙️",
    color: "#2563eb",
    description: "Values architectural rigor, precision, and state-of-the-art tooling.",
  },
  {
    type: "Business Value",
    label: "Business Value",
    icon: "📈",
    color: "#16a34a",
    description: "Driven by ROI, time-to-market, and measurable business outcomes.",
  },
  {
    type: "Safety & Reliability",
    label: "Safety & Reliability",
    icon: "🛡️",
    color: "#dc2626",
    description: "Prioritizes uptime, stability, rollback strategies, and risk mitigation.",
  },
  {
    type: "Control & Governance",
    label: "Control & Governance",
    icon: "⚖️",
    color: "#7c3aed",
    description: "Focuses on regulatory compliance, auditability, and standardization.",
  },
  {
    type: "People & Trust",
    label: "People & Trust",
    icon: "🤝",
    color: "#ea580c",
    description: "Prioritizes team morale, transparency, psychological safety, and culture.",
  },
  {
    type: "Autonomy",
    label: "Autonomy",
    icon: "🚀",
    color: "#0891b2",
    description: "Values rapid iteration, developer freedom, and minimal friction.",
  },
  {
    type: "Pragmatism",
    label: "Pragmatism",
    icon: "🛠️",
    color: "#475569",
    description: "Prefers simple, working solutions over perfection or complex frameworks.",
  },
];

export default function OfflineIntelGathering({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  onTagArtifact,
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
  const [, setHoveredTag] = useState<string | null>(null);
  const [showIntroBanner, setShowIntroBanner] = useState(() => {
    try {
      return localStorage.getItem("mlops_offline_intel_intro_seen") !== "true";
    } catch {
      return true;
    }
  });

  const dismissIntroBanner = () => {
    setShowIntroBanner(false);
    try {
      localStorage.setItem("mlops_offline_intel_intro_seen", "true");
    } catch {
      // ignore storage failures (e.g. private browsing)
    }
  };

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
            initialTagged[art.id] = art.categorized_type;
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
    const artKey = currentArtifact.id;

    setTaggedTypes((prev) => ({
      ...prev,
      [artKey]: categorizedType,
    }));

    if (onTagArtifact) {
      onTagArtifact(currentArtifact.stakeholder_id || currentArtifact.stakeholder_name);
    }

    if (currentArtifact.is_convincer_profile) {
      emit("intel:tag_convincer", {
        stakeholder_id: currentArtifact.stakeholder_id,
        categorized_archetype: categorizedType,
      });
    } else {
      emit("intel:tag_item", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
        intel_id: currentArtifact.requirement_id || currentArtifact.id,
        categorized_type: categorizedType,
      });
    }

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
  const currentArtifactKey = currentArtifact ? currentArtifact.id : "";
  const currentTaggedType = currentArtifactKey ? taggedTypes[currentArtifactKey] : undefined;

  const totalArtifactsCount = artifacts.length;
  const taggedArtifactsCount = artifacts.filter((art) => {
    return Boolean(taggedTypes[art.id]);
  }).length;
  const allTagged = totalArtifactsCount > 0 && taggedArtifactsCount === totalArtifactsCount;
  const firstUntaggedIndex = artifacts.findIndex((art) => {
    return !taggedTypes[art.id];
  });

  const currentStakeholderId = currentArtifact?.stakeholder_id || currentArtifact?.stakeholder_name;

  return (
    <div className="game-container">
      {/* Main Content Area over Game Background Canvas */}
      <div
        className={`container-fluid flex-grow-1 d-flex flex-column px-2 px-md-3 py-1 position-relative overflow-auto ${styles.mainContainer}`}
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
        }}
      >
        {/* Main Board Grid: Left Column = Stakeholder Dossier (2/5), Right Column = Artifact Viewer & Categorization (3/5) */}
        <div className={`row g-2 align-items-stretch h-100 ${styles.boardRow}`}>
          {/* LEFT COLUMN: Stakeholder Dossier (2/5 of screen) */}
          <div className={`col-12 d-flex flex-column h-100 ${styles.leftColumnDossier}`}>
            <div className={`h-100 ${styles.dossierContainer}`}>
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
              className={`transparent-div shadow-lg w-100 ${styles.transparentDivWrapper}`}
            >
              {/* Header Title inside transparent-div - Merged Artifact Info */}
              <div className={styles.headerRow}>
                <div className={styles.headerTitleGroup}>
                  <span className="transparent-div-label mb-0">
                    🔍 Offline Intel Gathering
                  </span>
                  <span className={styles.infoTooltipWrapper}>
                    <button
                      type="button"
                      className={styles.infoTooltipButton}
                      aria-label="How offline intel gathering works"
                      tabIndex={0}
                    >
                      <Icon icon="ph:info-bold" />
                    </button>
                    <span className={styles.infoTooltipContent} role="tooltip">
                      Every artifact reveals something about a stakeholder. Read it, then tag it below.
                      Your call is saved as <strong>unconfirmed</strong> intel on their page in the Stakeholder
                      Dossier. You'll get to confirm or correct it later by talking to them directly during
                      Online Intel Gathering. Not sure yet? Use ◀ ▶ or the numbered tabs above to jump around
                      before you lock everything in.
                    </span>
                  </span>
                  {!isFinished && currentArtifact && (
                    <div className={styles.headerArtifactMeta}>
                      <span className={styles.headerDivider}>|</span>
                      <span className={styles.headerArtifactCount}>
                        Artifact {currentIndex + 1} of {artifacts.length}
                      </span>
                      <span className={styles.headerArtifactBadge}>
                        {currentArtifact.artifact_type.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Quick direct item navigation pills */}
                {artifacts.length > 0 && (
                  <div className={styles.navPillsContainer}>
                    {artifacts.map((art, idx) => {
                      const key = art.id;
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
                          className={`btn btn-xs fw-bold ${styles.navPill} ${isTagged ? styles.navPillTagged : styles.navPillUntagged} ${isCurrent ? styles.navPillCurrent : ""}`}
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
                className={`card border-secondary shadow-sm text-start w-100 ${styles.journalCard}`}
              >
                {loading ? (
                  <div className="card-body bg-light p-4 text-center my-3 d-flex flex-column justify-content-center align-items-center flex-grow-1">
                    <div className={`spinner-border text-primary mb-3 ${styles.loadingSpinner}`} role="status" />
                    <h5 className="fw-bold text-dark mb-2">Generating Offline Intel Artifacts...</h5>
                    <p className="text-muted fs-6 mb-0">Analyzing scenario specifications across stakeholder items.</p>
                  </div>
                ) : isFinished ? (
                  /* Completion State / Summary Screen */
                  <div className={styles.summaryContainer}>
                    {/* Header matching Journal style */}
                    <div className={styles.completionHeader}>
                      <div className="d-flex align-items-center gap-2">
                        <Icon
                          icon={allTagged ? "ph:check-circle-bold" : "ph:warning-circle-bold"}
                          className={`${allTagged ? "text-success" : "text-warning"} ${styles.completionStatusIcon}`}
                        />
                        <strong className={styles.completionHeaderText}>
                          {allTagged ? "Intel Artifacts Tagged" : "Incomplete Intel Categorization"}
                        </strong>
                      </div>
                      <span
                        className={`badge ${allTagged ? "bg-primary text-white" : "bg-warning text-dark"} ${styles.completionStatusBadge}`}
                      >
                        {taggedArtifactsCount} / {totalArtifactsCount} Categorized
                      </span>
                    </div>

                    <div className={styles.completionBody}>
                      {allTagged ? (
                        <>
                          <div className={`${styles.completionIconCircle} ${styles.completionIconSuccess}`}>
                            <Icon icon="ph:check-bold" />
                          </div>
                          <h4 className="fw-bold text-dark mb-2">Intel Artifacts Tagged!</h4>
                          <p className={`text-muted mb-4 fs-6 ${styles.completionDescription}`}>
                            All {totalArtifactsCount} stakeholder requirement stances have been categorized and recorded as <strong className="text-dark">unconfirmed intel</strong> in your Stakeholder Dossier. You'll be able to verify or correct each tag by talking to that stakeholder directly during Online Intel Gathering.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className={`${styles.completionIconCircle} ${styles.completionIconWarning}`}>
                            <Icon icon="ph:warning-bold" />
                          </div>
                          <h4 className="fw-bold text-dark mb-2">Not All Artifacts Have Been Tagged</h4>
                          <p className={`text-muted mb-4 fs-6 ${styles.completionDescription}`}>
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
                            className={`${styles.actionButton} ${styles.btnAutoWidth} shadow-sm d-inline-flex align-items-center justify-content-center gap-2`}
                          >
                            <Icon icon="ph:arrow-circle-right-bold" className={styles.btnIcon} />
                            <span>Categorize Remaining ({totalArtifactsCount - taggedArtifactsCount} Left)</span>
                          </button>
                        ) : (
                          <button
                            onClick={handleFinalContinue}
                            disabled={isSubmitting}
                            className={`${styles.actionButton} ${styles.btnAutoWidth} shadow-sm d-inline-flex align-items-center justify-content-center gap-2`}
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
                  <div className={styles.activeStateGrid}>
                    <div className={`card-body bg-light ${styles.activeCardBody}`}>
                      {/* One-time intro banner: shown on the first artifact only, until dismissed */}
                      {showIntroBanner && currentIndex === 0 && (
                        <div className={styles.introBanner}>
                          <span className={styles.introBannerIcon}>🕵️</span>
                          <span className={styles.introBannerBody}>
                            <strong>New intel just came in.</strong> Read each item to learn more about your
                            stakeholders, then tag it below. It's saved as unconfirmed intel in their Dossier
                            until you verify it by talking to them in the next gameplay phase.
                          </span>
                          <button
                            type="button"
                            onClick={dismissIntroBanner}
                            className={styles.introBannerDismiss}
                          >
                            Got it
                          </button>
                        </div>
                      )}

                      {/* Artifact Viewer with Slide Transition - fills all remaining space, no chrome around it */}
                      <div className={styles.viewerWrapper}>
                        <AnimatePresence mode="wait" custom={direction}>
                          <motion.div
                            key={`${currentIndex}-${currentArtifactKey}`}
                            custom={direction}
                            initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className={styles.viewerMotionContainer}
                          >
                            <IntelArtifactViewer
                              content={currentArtifact.content}
                              artifactType={currentArtifact.artifact_type}
                              stakeholderName={currentArtifact.stakeholder_name}
                            />
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Compact Tagging Prompt & Buttons Panel - flush against the card's own edges, no nested box */}
                    <div
                      className={`${styles.taggingPanel} ${
                        currentArtifact.is_convincer_profile ? styles.taggingPanelConvincer : styles.taggingPanelStance
                      }`}
                    >
                      <div className={styles.taggingPanelHeader}>
                        <button
                          onClick={handlePrevItem}
                          disabled={currentIndex <= 0}
                          className={styles.navButton}
                          title="Previous Intel Artifact"
                          aria-label="Previous Intel Artifact"
                        >
                          <Icon icon="ph:caret-left-bold" className={styles.navButtonIcon} />
                        </button>

                        <div className={styles.taggingPanelHeaderText}>
                          <span
                            className={`${styles.taggingTypeBadge} ${
                              currentArtifact.is_convincer_profile
                                ? styles.taggingTypeBadgeConvincer
                                : styles.taggingTypeBadgeStance
                            }`}
                          >
                            {currentArtifact.is_convincer_profile ? "Convincer Profile" : "Stance"}
                          </span>
                          <h6 className={styles.taggingTitle}>
                            {currentArtifact.is_convincer_profile
                              ? `Categorize ${currentArtifact.stakeholder_name}'s Convincer Archetype:`
                              : `Categorize ${currentArtifact.stakeholder_name}'s stance:`}
                          </h6>
                        </div>
                        <small className={styles.taggingSubtitle}>
                          {currentArtifact.is_convincer_profile ? "Select Archetype" : "Select Category"}
                        </small>

                        <button
                          onClick={handleNextItem}
                          className={styles.navButton}
                          title={currentIndex < artifacts.length - 1 ? "Next Intel Artifact" : "Finish / View Summary"}
                          aria-label={currentIndex < artifacts.length - 1 ? "Next Intel Artifact" : "Finish / View Summary"}
                        >
                          <Icon
                            icon={currentIndex < artifacts.length - 1 ? "ph:caret-right-bold" : "ph:arrow-right-bold"}
                            className={styles.navButtonIcon}
                          />
                        </button>
                      </div>

                      <p className={styles.taggingHint}>
                        {currentArtifact.is_convincer_profile
                          ? "A Convincer Archetype is what will actually change this stakeholder's mind later on: tag the driver behind what they just said."
                          : "Is this a must-have, a nice-to-have, or just interpersonal friction? Tag it based on what they're really asking for."}
                      </p>

                      <div className={`row ${currentArtifact.is_convincer_profile ? "g-1" : "g-2"} ${styles.tagGrid}`}>
                        {(currentArtifact.is_convincer_profile ? CONVINCER_TAGS : REQUIREMENT_TAGS).map((tag) => {
                          const isSelected = currentTaggedType === tag.type;
                          const colClass = currentArtifact.is_convincer_profile
                            ? "col-12 col-md-6 col-lg-4"
                            : "col-12 col-md-4";
                          const sizeClass = currentArtifact.is_convincer_profile
                            ? styles.tagButtonConvincer
                            : styles.tagButtonRequirement;

                          return (
                            <div key={tag.type} className={colClass}>
                              <button
                                onClick={() => handleTagArtifact(tag.type)}
                                onMouseEnter={() => setHoveredTag(tag.type)}
                                onMouseLeave={() => setHoveredTag(null)}
                                className={`btn ${styles.tagButton} ${sizeClass} ${isSelected ? styles.tagButtonSelected : ""}`}
                                style={{ borderColor: tag.color }}
                              >
                                <div className={styles.tagButtonHeader}>
                                  <span className={styles.tagButtonLabelGroup}>
                                    <span>{tag.icon}</span>{" "}
                                    <span className={styles.tagButtonLabel} style={{ color: tag.color }}>{tag.label}</span>
                                  </span>
                                  {isSelected && (
                                    <span
                                      className={`badge text-white ${styles.tagButtonBadge}`}
                                      title="Pick another category to re-tag this artifact"
                                    >
                                      <Icon icon="ph:pencil-simple-bold" className={styles.tagButtonBadgeIcon} />
                                      Selected
                                    </span>
                                  )}
                                </div>
                                <small className={styles.tagButtonDescription}>
                                  {tag.description}
                                </small>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card-body bg-light p-4 text-center">
                    <p className="text-muted">No artifacts available for this challenge.</p>
                    <button onClick={handleFinalContinue} className={`${styles.actionButton} ${styles.btnAutoWidth}`}>
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

