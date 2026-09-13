import { Fragment, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Icon } from "@iconify/react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelArtifactViewer from "./IntelArtifactViewer";
import StakeholderDossier, { type IntelDebugInfo, type StakeholderDossierEntry } from "./StakeholderDossier";
import styles from "./offline_intel_gathering.module.css";
import { INTEL_TAGS } from "../types/IntelTag";

interface OfflineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  onTagArtifact?: (stakeholderId: string) => void;
  isDossierOpen?: boolean;
  setIsDossierOpen?: (open: boolean) => void;
  dossierData?: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
  /** Lets the embedded dossier reopen the phase briefing. */
  onOpenPhaseBriefing?: () => void;
  /** Opens performance (gameplay metrics + the project pipeline) from the dossier, as in the pitch phase. */
  onPerformanceToggle?: () => void;
  isPerformanceOpen?: boolean;
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
  /** Already on the public record: dealt in pre-tagged and locked, not the player's to call. */
  is_known?: boolean;
  /** Answer key, only sent when the API runs with ENABLE_DOSSIER_DEBUG. */
  debug?: IntelDebugInfo;
}

// Stakeholder tags first, then the one tag that is about the system rather than a person.
const REQUIREMENT_TAGS = INTEL_TAGS.map((t) => ({
  type: t.type,
  label: t.label,
  icon: t.emoji,
  color: t.color,
  description: t.description,
  about: t.about,
}));

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
  onOpenPhaseBriefing,
  onPerformanceToggle,
  isPerformanceOpen = false,
}: OfflineIntelGatheringProps) {
  const { emit, subscribe } = useGameWebSocket();
  const [artifacts, setArtifacts] = useState<IntelArtifact[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taggedTypes, setTaggedTypes] = useState<Record<string, string>>({});
  const [, setHoveredTag] = useState<string | null>(null);
  // Debug builds only: stays open across cards so the key can be read while flipping through the deck.
  const [isDebugOpen, setIsDebugOpen] = useState(false);
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

  // Two-step so a stray click cannot wipe the player's work
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const hasRequestedRef = useRef(false);
  const resetConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
      if (resetConfirmTimeoutRef.current) {
        clearTimeout(resetConfirmTimeoutRef.current);
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
    if (currentArtifact.is_known) return; // already on the record, not the player's call to make
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

  const handleResetClick = () => {
    if (resetConfirmTimeoutRef.current) {
      clearTimeout(resetConfirmTimeoutRef.current);
      resetConfirmTimeoutRef.current = null;
    }

    if (!isConfirmingReset) {
      setIsConfirmingReset(true);
      // Back out on its own if the player does not follow through
      resetConfirmTimeoutRef.current = setTimeout(() => {
        resetConfirmTimeoutRef.current = null;
        setIsConfirmingReset(false);
      }, 4000);
      return;
    }

    setIsConfirmingReset(false);
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    // Keep the locked pre-tagged items; only the player's own calls get cleared.
    setTaggedTypes((prev) => {
      const kept: Record<string, string> = {};
      artifacts.forEach((art) => {
        if (art.is_known && prev[art.id]) {
          kept[art.id] = prev[art.id];
        }
      });
      return kept;
    });
    setDirection(-1);
    setCurrentIndex(firstPlayerIndex !== -1 ? firstPlayerIndex : 0);
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

  // Known artifacts arrive pre-tagged and locked, so they stay out of every progress count:
  // the player should see how many calls are theirs to make, not a number they cannot move.
  const playerArtifacts = artifacts.filter((art) => !art.is_known);
  const totalArtifactsCount = playerArtifacts.length;
  const taggedArtifactsCount = playerArtifacts.filter((art) => {
    return Boolean(taggedTypes[art.id]);
  }).length;
  const allTagged = artifacts.length > 0 && taggedArtifactsCount === totalArtifactsCount;
  const firstUntaggedIndex = artifacts.findIndex((art) => {
    return !art.is_known && !taggedTypes[art.id];
  });
  const firstPlayerIndex = artifacts.findIndex((art) => !art.is_known);
  const knownArtifactsCount = artifacts.length - playerArtifacts.length;
  const isOnKnownArtifact = Boolean(currentArtifact?.is_known);
  // On record come the challenge itself, as a Fact about the disputed component, and the sides
  // arguing over it, as stances. Only the stances make up the clash.
  const isOnRecordStance = (art: IntelArtifact) => Boolean(art.is_known) && art.categorized_type !== "fact";
  const isOnKnownFact = isOnKnownArtifact && currentArtifact.categorized_type === "fact";
  // The on-record pair is one argument seen from two sides. Name the other side so the
  // player reads the second card as a rebuttal instead of an unrelated statement.
  const conflictPartnerIndex = isOnKnownArtifact && !isOnKnownFact
    ? artifacts.findIndex(
        (art) => isOnRecordStance(art) && art.stakeholder_id !== currentArtifact.stakeholder_id
      )
    : -1;
  const conflictPartner = conflictPartnerIndex !== -1 ? artifacts[conflictPartnerIndex] : undefined;
  const hasSeenConflictPartner = conflictPartnerIndex !== -1 && conflictPartnerIndex < currentIndex;

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
                showPhaseChangeBadges={true}
                onOpenPhaseBriefing={onOpenPhaseBriefing}
                onPerformanceToggle={onPerformanceToggle}
                isPerformanceOpen={isPerformanceOpen}
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
                      Every artifact reveals something, about a stakeholder or about the system itself. Whoever
                      wrote it, read closely, then tag it below. Your call is saved as <strong>unconfirmed</strong>{" "}
                      intel in the Stakeholder Dossier. You'll get to confirm or correct it later by talking to them directly during
                      the pitch phase. Not sure yet? Use ◀ ▶ or the numbered tabs above to jump around
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
                    <button
                      type="button"
                      onClick={handleResetClick}
                      disabled={taggedArtifactsCount === 0}
                      className={`${styles.resetTagsButton} ${
                        isConfirmingReset ? styles.resetTagsButtonConfirming : ""
                      }`}
                      title={
                        taggedArtifactsCount === 0
                          ? "Nothing categorized yet"
                          : "Clear every category you have picked and start again from the first artifact"
                      }
                    >
                      <Icon
                        icon={isConfirmingReset ? "ph:warning-bold" : "ph:arrow-counter-clockwise-bold"}
                        className={styles.resetTagsButtonIcon}
                      />
                      <span>{isConfirmingReset ? "Confirm reset?" : "Reset all"}</span>
                    </button>
                    {artifacts.map((art, idx) => {
                      const key = art.id;
                      const isTagged = !!taggedTypes[key];
                      const isCurrent = idx === currentIndex;
                      // Each challenge's on-record pair is a disagreement between two stakeholders,
                      // and that disagreement is the challenge. Mark the seam between them.
                      const previous = idx > 0 ? artifacts[idx - 1] : undefined;
                      const opensConflictSeam = Boolean(
                        isOnRecordStance(art) &&
                        previous &&
                        isOnRecordStance(previous) &&
                        previous.stakeholder_id !== art.stakeholder_id
                      );
                      const pill = (
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
                          className={`btn btn-xs fw-bold ${styles.navPill} ${
                            art.is_known
                              ? styles.navPillOnRecord
                              : isTagged
                                ? styles.navPillTagged
                                : styles.navPillUntagged
                          } ${isCurrent ? styles.navPillCurrent : ""}`}
                          title={`Jump to item ${idx + 1}: ${art.stakeholder_name} (${
                            art.is_known ? "On record, nothing to tag" : isTagged ? "Categorized" : "Uncategorized"
                          })`}
                        >
                          {art.is_known ? <Icon icon="ph:megaphone-simple-bold" /> : idx + 1}
                        </button>
                      );

                      if (!opensConflictSeam) return pill;

                      return (
                        <span key={`seam-${key || idx}`} className={styles.conflictSeam}>
                          <span
                            className={styles.conflictSeamBolt}
                            title={`${previous?.stakeholder_name} and ${art.stakeholder_name} want different things here. Sorting that out is the job.`}
                          >
                            <Icon icon="ph:lightning-fill" aria-hidden="true" />
                          </span>
                          {pill}
                        </span>
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
                            All {totalArtifactsCount} artifacts have been categorized and recorded as <strong className="text-dark">unconfirmed intel</strong> in your Stakeholder Dossier. You'll be able to verify or correct each tag by talking to the stakeholders directly during the pitch phase.
                            {knownArtifactsCount > 0 && (
                              <>
                                {" "}The {knownArtifactsCount} item{knownArtifactsCount === 1 ? "" : "s"} you couldn't tag
                                {knownArtifactsCount === 1 ? " is" : " are"} filed as <strong className="text-dark">on record</strong>: they said
                                {knownArtifactsCount === 1 ? " it" : " those"} in public, so there's nothing left to check.
                              </>
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className={`${styles.completionIconCircle} ${styles.completionIconWarning}`}>
                            <Icon icon="ph:warning-bold" />
                          </div>
                          <h4 className="fw-bold text-dark mb-2">Not All Artifacts Have Been Tagged</h4>
                          <p className={`text-muted mb-4 fs-6 ${styles.completionDescription}`}>
                            You have categorized <strong className="text-dark">{taggedArtifactsCount} of {totalArtifactsCount}</strong> artifacts. All artifacts must be tagged before proceeding to the pitch phase.
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
                                <span>Continue to the Pitch</span>
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
                      {/* Known artifacts open the deck: say plainly why this one is not the player's to tag */}
                      {isOnKnownArtifact && (
                        <div className={`${styles.introBanner} ${styles.onRecordBanner}`}>
                          <span className={styles.introBannerIcon}>📣</span>
                          <span className={styles.introBannerBody}>
                            {isOnKnownFact ? (
                              <>
                                <strong>This is what the challenge is about.</strong> {currentArtifact.stakeholder_name}{" "}
                                posted it in a channel the whole team reads, so everyone already knows how things stand.
                                It's filed under <strong>The System</strong> in the Dossier as <strong>on record</strong>,
                                and there's nothing here for you to work out. Read it, then keep going.
                              </>
                            ) : (
                              <>
                                <strong>{currentArtifact.stakeholder_name} said this in the open.</strong> It went to a
                                channel the whole team reads, so everyone already knows where they stand. It's filed in
                                the Dossier as <strong>on record</strong> and there's nothing here for you to work out.
                                Read it, then keep going.
                              </>
                            )}
                            {conflictPartner && (
                              <span className={styles.conflictNote}>
                                <Icon icon="ph:lightning-fill" className={styles.conflictNoteIcon} />
                                {hasSeenConflictPartner
                                  ? `That's different than what ${conflictPartner.stakeholder_name} just said. Working out that clash is the job.`
                                  : `${conflictPartner.stakeholder_name} sees it differently, and you'll read their side next.`}
                              </span>
                            )}
                          </span>
                          {firstPlayerIndex !== -1 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (transitionTimeoutRef.current) {
                                  clearTimeout(transitionTimeoutRef.current);
                                  transitionTimeoutRef.current = null;
                                }
                                setDirection(1);
                                setCurrentIndex(firstPlayerIndex);
                              }}
                              className={styles.introBannerDismiss}
                            >
                              Skip ahead
                            </button>
                          )}
                        </div>
                      )}

                      {/* One-time intro banner: shown on the player's first taggable artifact, until dismissed */}
                      {showIntroBanner && currentIndex === firstPlayerIndex && (
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
                              isPublicRecord={Boolean(currentArtifact.is_known)}
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
                          <div className={styles.taggingBadgeRow}>
                          <span
                            className={`${styles.taggingTypeBadge} ${
                              isOnKnownArtifact
                                ? styles.taggingTypeBadgeOnRecord
                                : currentArtifact.is_convincer_profile
                                  ? styles.taggingTypeBadgeConvincer
                                  : styles.taggingTypeBadgeStance
                            }`}
                          >
                            {isOnKnownArtifact
                              ? "On Record"
                              : currentArtifact.is_convincer_profile
                                ? "Convincer Profile"
                                : "Stance"}
                          </span>
                          {currentArtifact.debug && (
                            <button
                              type="button"
                              className={`${styles.debugToggle} ${
                                !currentTaggedType
                                  ? ""
                                  : currentTaggedType === currentArtifact.debug.correct_tag
                                    ? styles.debugRight
                                    : styles.debugWrong
                              }`}
                              onClick={() => setIsDebugOpen((open) => !open)}
                              title={`Debug: true tag is ${currentArtifact.debug.correct_tag}`}
                              aria-label="Toggle answer key (debug)"
                            >
                              <Icon icon="ph:bug-bold" />
                            </button>
                          )}
                          </div>
                          <h6 className={styles.taggingTitle}>
                            {isOnKnownArtifact
                              ? isOnKnownFact
                                ? "How the system stands, already filed:"
                                : `${currentArtifact.stakeholder_name}'s stance, already filed:`
                              : currentArtifact.is_convincer_profile
                                ? `Categorize ${currentArtifact.stakeholder_name}'s Convincer Archetype:`
                                : `Categorize ${currentArtifact.stakeholder_name}'s stance:`}
                          </h6>
                        </div>
                        <small className={styles.taggingSubtitle}>
                          {isOnKnownArtifact
                            ? "Nothing to pick"
                            : currentArtifact.is_convincer_profile
                              ? "Select Archetype"
                              : "Select Category"}
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

                      {currentArtifact.debug && isDebugOpen && (
                        <div className={styles.debugPanel}>
                          <strong>True tag:</strong>{" "}
                          <span
                            className={
                              !currentTaggedType || currentTaggedType === currentArtifact.debug.correct_tag
                                ? styles.debugRightText
                                : styles.debugWrongText
                            }
                          >
                            {currentArtifact.debug.correct_tag}
                          </span>
                          {currentArtifact.debug.target && (
                            <>
                              {" "}· {currentArtifact.debug.target}
                              {currentArtifact.debug.level != null && <> at level {currentArtifact.debug.level}</>}
                            </>
                          )}
                          {" "}· <span className={styles.debugId}>{currentArtifact.debug.id}</span>
                        </div>
                      )}

                      <p className={styles.taggingHint}>
                        {isOnKnownArtifact
                          ? "This one is already sorted, and the category below is the right one. It's here so you can see what a finished call looks like before you make your own."
                          : currentArtifact.is_convincer_profile
                          ? "A Convincer Archetype is what will actually change this stakeholder's mind later on: tag the driver behind what they just said."
                          : "First ask: is this about a person or about the system? If it is about a person, do they want it, refuse to cross it, or accept giving it up?"}
                      </p>

                      <div className={`row ${currentArtifact.is_convincer_profile ? "g-1" : "g-2"} ${styles.tagGrid}`}>
                        {(currentArtifact.is_convincer_profile ? CONVINCER_TAGS : REQUIREMENT_TAGS).map((tag) => {
                          const isSelected = currentTaggedType === tag.type;
                          const isSystemTag = (tag as { about?: string }).about === "system";
                          const colClass = currentArtifact.is_convincer_profile
                            ? "col-12 col-md-6 col-lg-4"
                            : isSystemTag
                            ? "col-12"
                            : "col-12 col-md-4";
                          const sizeClass = currentArtifact.is_convincer_profile
                            ? styles.tagButtonConvincer
                            : styles.tagButtonRequirement;

                          return (
                            <Fragment key={tag.type}>
                            {isSystemTag && (
                              <div className="col-12">
                                <small className={styles.tagGroupLabel}>Not about anyone: about the system</small>
                              </div>
                            )}
                            <div className={colClass}>
                              <button
                                onClick={() => handleTagArtifact(tag.type)}
                                onMouseEnter={() => setHoveredTag(tag.type)}
                                onMouseLeave={() => setHoveredTag(null)}
                                disabled={isOnKnownArtifact}
                                title={isOnKnownArtifact ? "Already on record, nothing to change here" : undefined}
                                className={`btn ${styles.tagButton} ${sizeClass} ${isSelected ? styles.tagButtonSelected : ""} ${
                                  isOnKnownArtifact ? styles.tagButtonLocked : ""
                                }`}
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
                                      title={
                                        isOnKnownArtifact
                                          ? "This is the right category, already filed for you"
                                          : "Pick another category to re-tag this artifact"
                                      }
                                    >
                                      <Icon
                                        icon={isOnKnownArtifact ? "ph:lock-simple-bold" : "ph:pencil-simple-bold"}
                                        className={styles.tagButtonBadgeIcon}
                                      />
                                      {isOnKnownArtifact ? "On record" : "Selected"}
                                    </span>
                                  )}
                                </div>
                                <small className={styles.tagButtonDescription}>
                                  {tag.description}
                                </small>
                              </button>
                            </div>
                            </Fragment>
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

