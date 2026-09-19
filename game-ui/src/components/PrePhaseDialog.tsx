import { Icon } from "@iconify/react";
import styles from "./PrePhaseDialog.module.css";
import { PhasesContext, isFirstPlayablePhase } from "./PhaseProvider";
import { useContext, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FADE_TRANSITION } from "../utils/transitions";
import PowerInterestMatrix from "./PowerInterestMatrix";
import HoverTooltip from "./HoverToolTip";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";

interface PrePhaseDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  setIsRoundOpen?: (open: boolean) => void;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  currentChallenge?: number;
  challengeAmount?: number;
  /**
   * See `ChallengeDescriptionCard.isNew` — surfaces a "NEW" tag on the
   * embedded challenge card. Set by the caller (Game.tsx) to true when the
   * challenge shown differs from the last one the player has already seen,
   * whether or not the phase itself changed.
   */
  isNewChallenge?: boolean;
  /**
   * Reopened from the dossier during a phase rather than shown on entering it.
   * The briefing then just closes again instead of starting the round.
   */
  isReview?: boolean;
}

export default function PrePhaseDialog({
  isOpen,
  setIsOpen,
  setIsRoundOpen,
  challengeTitle,
  challengeDescription,
  challengeIntro,
  currentChallenge,
  challengeAmount,
  isNewChallenge = false,
  isReview = false,
}: PrePhaseDialogProps) {
  const { currentPhase, phases } = useContext(PhasesContext);
  // Overlay layer the radar portals its bubbles and tooltips into. The page
  // clips its own overflow and the matrix column keeps a transform from its
  // entrance animation, so neither can host a fixed-position bubble.
  const [bubbleLayer, setBubbleLayer] = useState<HTMLDivElement | null>(null);
  const wasReviewRef = useRef(false);
  if (isOpen) {
    wasReviewRef.current = isReview;
  }

  const handleClose = () => {
    setIsOpen(false);
    // Reviewing mid-phase just returns the player to where they were; only the
    // briefing shown on entering a phase starts the round.
    if (!isReview && setIsRoundOpen) {
      setIsRoundOpen(true);
    }
  };

  useEffect(() => {
    if (!isOpen || !isReview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isReview]);

  const currentPhaseData = phases[currentPhase];
  
  const hasIntroPhase =
    phases.length > 0 &&
    phases[0]?.id === 0 &&
    phases[0]?.phase_name?.toLowerCase() === "introduction";
  const isFirstPhase = isFirstPlayablePhase(phases, currentPhase);
  const previousPhaseData = isFirstPhase ? null : (currentPhase > 0 ? phases[currentPhase - 1] : null);

  const currentStakeholders = currentPhaseData?.stakeholder_power_interest || [];
  const previousStakeholders = previousPhaseData?.stakeholder_power_interest || [];

  const displayPhaseNumber = hasIntroPhase ? Math.max(1, currentPhase) : currentPhase + 1;
  const totalPlayablePhases = hasIntroPhase ? Math.max(1, phases.length - 1) : phases.length;

  const panelContent = (
      <div className={wasReviewRef.current ? styles.dashboardPanel : styles.panel}>
          {/* Header */}
          <div className={styles.header}>
            <div>
              <h1 className={styles.headerTitle}>
                <Icon icon="ph:projector-screen-chart-bold" className={styles.headerIcon} />
                <span>Phase Briefing</span>
              </h1>
              <p className={styles.headerSubtitle}>
                Project Milestone Overview • Align technical decisions with stakeholder priorities
              </p>
            </div>
            <div className="d-flex align-items-center gap-2">
              {phases && phases.length > 0 && (
                <span className={styles.phaseBadge}>
                  Phase {displayPhaseNumber} of {totalPlayablePhases}
                </span>
              )}
              {isReview && (
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={handleClose}
                  aria-label="Close Phase Briefing"
                  title="Close Phase Briefing (Esc)"
                  style={{ cursor: "pointer" }}
                />
              )}
            </div>
          </div>

          {/* Modal Body */}
          <div className={styles.modalBody}>
            {/* Horizontal Directive Banner: full width across top of modal body */}
            <div className={styles.directiveBanner}>
              <div className={styles.directiveBannerHeader}>
                <Icon icon="ph:list-checks-bold" className={styles.directiveIcon} />
                <span>Player Action Plan</span>
              </div>
              <div className={styles.directiveStepsGrid}>
                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>1</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Deliver Objectives:</strong> Align your technical choices with the phase deliverables defined above.
                  </div>
                </div>
                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>2</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Involve Others:</strong> Prioritize <span className={styles.highlightManage}>Manage Closely</span> stakeholders, but make sure to involve the others as well.
                  </div>
                </div>
                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>3</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Navigate Trade-offs:</strong> Check newcomer and shifted badges on the radar to anticipate which stakeholder priorities may clash during round dilemmas.
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.dossierGrid}>
              {/* Left Column: Mission Directive & Objectives */}
              <div className={styles.missionColumn}>
                <div className={styles.missionCard}>
                  <div className={styles.missionCardHeader}>
                    <Icon icon="ph:target-bold" />
                    <span>{currentPhaseData?.phase_name || `Phase ${displayPhaseNumber}`}</span>
                  </div>
                  <div className={styles.missionCardBody}>
                    {currentPhaseData?.phase_introduction && (
                      <p className={styles.missionIntro}>
                        {currentPhaseData.phase_introduction}
                      </p>
                    )}
                    <div className={styles.objectivesBox}>
                      <span className={styles.objectivesLabel}>
                        <Icon icon="ph:flag-checkered-bold" />
                        Phase Objectives
                      </span>
                      <p className={styles.objectivesText}>
                        {currentPhaseData?.phase_desc ||
                          "Enter this phase to address new project requirements and align with key stakeholders."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Minimized Challenge Briefing: the current challenge's story, excluding the stakeholder-specific breakdown */}
                {challengeTitle && (
                  <ChallengeDescriptionCard
                    challengeTitle={challengeTitle}
                    challengeDescription={challengeDescription}
                    challengeIntro={challengeIntro}
                    currentChallenge={currentChallenge}
                    challengeAmount={challengeAmount}
                    is_minimized={true}
                    isNew={isNewChallenge}
                  />
                )}
              </div>

              {/* Right Column: Stakeholder Matrix */}
              <div className={styles.matrixColumn}>
                <div className={styles.sectionHeader}>
                  <h6 className={styles.sectionTitle}>
                    <Icon icon="ph:users-three-bold" className={styles.sectionIcon} />
                    <span>Stakeholder Power & Interest Radar</span>
                  </h6>
                  <HoverTooltip
                    portalTarget={bubbleLayer}
                    description="Radar Gameplay Guide: Power reflects authority to approve or veto your ML systems. Interest reflects how directly daily work is impacted. Focus your attention on 'Manage Closely' stakeholders, but don't disregard the others."
                  >
                    <span className={styles.radarHelpBtn}>
                      <Icon icon="ph:info-bold" />
                      <span>Radar Guide</span>
                    </span>
                  </HoverTooltip>
                </div>
                <PowerInterestMatrix
                  currentStakeholders={currentStakeholders}
                  previousStakeholders={previousStakeholders}
                  isFirstPhase={isFirstPhase}
                  bubblePortalTarget={bubbleLayer}
                  autoPlayIntroductions={!isReview}
                />
              </div>
            </div>

            {/* Footer with hint and action button */}
            <div className={styles.footer}>
              <div className={styles.footerHint}>
                <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
                <span>You can review this stakeholder matrix anytime.</span>
              </div>
              <div className={styles.actions}>
                <button className={styles.actionButton} onClick={handleClose}>
                  <span>{isReview ? "Back to the Phase" : "Enter Phase & Begin Round"}</span>
                  <Icon icon="ph:arrow-right-bold" />
                </button>
              </div>
            </div>
          </div>

          {/* Fixed, click-through overlay the radar portals its bubbles into */}
          <div ref={setBubbleLayer} className={styles.bubbleLayer} />
      </div>
  );

  // Reopened from the dossier mid-phase: a modal matching Performance and Event Log overlays
  if (wasReviewRef.current) {
    return (
      <div
        className={`${styles.helpOverlayLayer} ${
          isOpen ? styles.helpLayerVisible : styles.helpLayerHidden
        }`}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        {panelContent}
      </div>
    );
  }

  // Shown on entering a phase: its own full-screen page, not an overlay over the phase behind it.
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          {...FADE_TRANSITION}
          key="prephase-dialog-page"
          className={`${styles.pageWrapper} intro2`}
          data-intro-group="intro2"
          data-intro="This phase overview appears when a new phase begins. Here you can see the phase objectives and how stakeholders' power and interest dynamics evolve."
          data-step="1"
          data-position="middle-aligned"
        >
          {panelContent}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
