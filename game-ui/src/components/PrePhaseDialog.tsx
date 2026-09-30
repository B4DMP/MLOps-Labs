import { Icon } from "@iconify/react";
import styles from "./PrePhaseDialog.module.css";
import { PhasesContext, isFirstPlayablePhase } from "./PhaseProvider";
import { useSettings } from "./SettingsProvider";
import { useSpeech } from "./useSpeech";
import { cancelSpeech, splitSentences, TOUR_GUIDE_SEED } from "../utils/speech";
import { useContext, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FADE_TRANSITION } from "../utils/transitions";
import PowerInterestMatrix from "./PowerInterestMatrix";
import PhaseOverview from "./PhaseOverview";
import HoverTooltip from "./HoverToolTip";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import CheatSheetModal from "./CheatSheetModal";
import SpokenText from "./SpokenText";
import GlossaryText from "./glossary/GlossaryText";
import { startTour } from "../utils/tour";

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
  /** Opens/closes the settings panel. Hidden while `isReview`: the dossier that reopened this
   * briefing already has its own Settings button, and showing a second one here would be
   * redundant. */
  onSettingsToggle?: () => void;
  isSettingsOpen?: boolean;
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
  onSettingsToggle,
  isSettingsOpen = false,
}: PrePhaseDialogProps) {
  const { currentPhase, phases } = useContext(PhasesContext);
  const { settings } = useSettings();
  const { speak: speakTts } = useSpeech();
  // Overlay layer the radar portals its bubbles and tooltips into. The page
  // clips its own overflow and the matrix column keeps a transform from its
  // entrance animation, so neither can host a fixed-position bubble.
  const [bubbleLayer, setBubbleLayer] = useState<HTMLDivElement | null>(null);
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);
  const wasReviewRef = useRef(false);
  const introTourStartedRef = useRef(false);
  if (isOpen) {
    wasReviewRef.current = isReview;
  }

  // Narrator reads the phase introduction and this round's challenge before the stakeholders
  // introduce themselves, only on a genuine phase entry (a review reopen never auto-plays
  // introductions either, and re-narrating every time a player reopens the briefing mid-phase
  // would get repetitive). `introsUnlocked` gates PowerInterestMatrix's own auto-play so the
  // two don't talk over each other; it resolves immediately (no gap before the stakeholders
  // start) whenever there is nothing to narrate, auto-skip is on, or narration is muted, since
  // speak() then calls onEnd synchronously.
  const [isNarratingBriefing, setIsNarratingBriefing] = useState(false);
  const [introsUnlocked, setIntrosUnlocked] = useState(false);
  // Phase 0's guided tour (intro2) walks the phase bar/description/challenge/radar chrome before
  // any of it is narrated. Flips true once intro2 finishes or is skipped. Only phase 0 waits on
  // it, read from the live phase: this dialog can mount or stay mounted across the switch to
  // phase 1, and a gate seeded once at mount left phase 1's briefing silent.
  const [introTourDone, setIntroTourDone] = useState(false);
  const introTourPending = currentPhase === 0 && !introTourDone;
  const briefingCancelRef = useRef<() => void>(() => {});
  // Which sentence of the briefing narration is playing right now, for SpokenText below. Only
  // `phase_introduction`'s own sentences are rendered here (the challenge title/intro read in the
  // same pass live inside ChallengeDescriptionCard, not this component), so an index landing past
  // phase_introduction's own sentence count is treated as "nothing to highlight here" rather than
  // clamped to its last sentence - see phaseIntroSentenceCount below.
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  // Same narration, counted from the start of the challenge title/intro instead: negative while
  // phase_introduction is still being read (ChallengeDescriptionCard treats that as "nothing of
  // mine yet", not literally nothing), then 0-based across "title. intro" once it's their turn.
  // Passed straight through to ChallengeDescriptionCard, which splits out the title's own share.
  const [challengeSentenceIndex, setChallengeSentenceIndex] = useState<number | null>(null);
  // True once the first sentence has actually started playing. Distinct from `activeSentenceIndex`
  // being non-null: phase_introduction can be empty while the challenge text still narrates, in
  // which case activeSentenceIndex stays null for the whole reading (nothing here to highlight),
  // but this still flips true - it is what drives the "waiting on audio" loading indicator, not
  // the highlight.
  const [hasBriefingAudioStarted, setHasBriefingAudioStarted] = useState(false);

  const currentPhaseData = phases[currentPhase];
  const phaseIntroductionText = currentPhaseData?.phase_introduction || "";
  const phaseIntroSentenceCount = splitSentences(phaseIntroductionText)
    .map((s) => s.trim())
    .filter(Boolean).length;
  const buildBriefingNarration = () =>
    [
      currentPhaseData?.phase_introduction,
      challengeTitle ? `${challengeTitle}. ${challengeIntro || ""}`.trim() : challengeIntro,
    ]
      .filter(Boolean)
      .join(" ");

  useEffect(() => {
    if (!isOpen || isReview || introTourPending) return;
    const text = buildBriefingNarration();
    if (!text || settings.auto_skip_conversations) {
      setIntrosUnlocked(true);
      return;
    }
    setIntrosUnlocked(false);
    setIsNarratingBriefing(true);
    setActiveSentenceIndex(null);
    setChallengeSentenceIndex(null);
    setHasBriefingAudioStarted(false);
    briefingCancelRef.current = speakTts(text, {
      slot: "narrator",
      onSentence: ({ index }) => {
        setHasBriefingAudioStarted(true);
        setActiveSentenceIndex(index < phaseIntroSentenceCount ? index : null);
        setChallengeSentenceIndex(index - phaseIntroSentenceCount);
      },
      onEnd: () => {
        setIsNarratingBriefing(false);
        setIntrosUnlocked(true);
        setActiveSentenceIndex(null);
        setChallengeSentenceIndex(null);
        setHasBriefingAudioStarted(false);
      },
    });
    return () => {
      briefingCancelRef.current();
      setIsNarratingBriefing(false);
      setActiveSentenceIndex(null);
      setChallengeSentenceIndex(null);
      setHasBriefingAudioStarted(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    isReview,
    introTourPending,
    currentPhaseData?.phase_introduction,
    challengeTitle,
    challengeIntro,
    settings.auto_skip_conversations,
  ]);

  // The intro2 tour walks the phase bar/description/challenge/radar chrome *before* any of it is
  // narrated - it runs first, then unblocks the briefing narration effect above (introTourDone),
  // which in turn unblocks the stakeholders' own self-introductions (introsUnlocked). All three
  // stay strictly sequential because they share one speech arbiter; running any two at once means
  // the second one silently cuts the first off.
  useEffect(() => {
    // Also waits for real phase data (`phases.length`): on a cold load this dialog can open
    // before `game:init_data` arrives, and starting against an empty phase bar is exactly the
    // "phase rail wasn't fully loaded" layout mismatch intro.js can't self-correct for later.
    if (!isOpen || isReview || currentPhase !== 0 || phases.length === 0) return;
    if (introTourStartedRef.current) return;
    // A beat past this dialog's own fade-in (FADE_TRANSITION, 0.18s) so intro.js measures the
    // phase bar once it has actually settled, not mid-transition. Only marked started once the
    // timer actually fires, so a cleared timer (isOpen flipping again first) can still retry.
    const timer = setTimeout(() => {
      introTourStartedRef.current = true;
      startTour("intro2", {
        narrate: (text) => speakTts(text, { slot: "narrator", seed: TOUR_GUIDE_SEED }),
        onFinish: () => setIntroTourDone(true),
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [isOpen, isReview, currentPhase, phases.length]);

  const replayBriefingNarration = () => {
    const text = buildBriefingNarration();
    if (!text) return;
    briefingCancelRef.current();
    setIsNarratingBriefing(true);
    setActiveSentenceIndex(null);
    setChallengeSentenceIndex(null);
    setHasBriefingAudioStarted(false);
    briefingCancelRef.current = speakTts(text, {
      slot: "narrator",
      onSentence: ({ index }) => {
        setHasBriefingAudioStarted(true);
        setActiveSentenceIndex(index < phaseIntroSentenceCount ? index : null);
        setChallengeSentenceIndex(index - phaseIntroSentenceCount);
      },
      onEnd: () => {
        setIsNarratingBriefing(false);
        setActiveSentenceIndex(null);
        setChallengeSentenceIndex(null);
        setHasBriefingAudioStarted(false);
      },
    });
  };

  const stopBriefingNarration = () => {
    briefingCancelRef.current();
    setIsNarratingBriefing(false);
    setActiveSentenceIndex(null);
    setChallengeSentenceIndex(null);
    setHasBriefingAudioStarted(false);
  };

  const handleClose = () => {
    // A stakeholder introduction can still be mid-sentence when the player moves on (they don't
    // have to wait for it), and the round behind this dialog starts immediately on close - so
    // without this, its own narration could start while the old introduction was still audible.
    cancelSpeech();
    setActiveSentenceIndex(null);
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
            <div className={styles.headerTitleGroup}>
              <h1 className={styles.headerTitle}>
                <Icon icon="ph:projector-screen-chart-bold" className={styles.headerIcon} />
                <span>Phase Briefing</span>
              </h1>
              <p className={styles.headerSubtitle}>
                Project Milestone Overview
              </p>
            </div>
            {/* Same lifecycle breadcrumb as the Performance Dashboard header, so "where am I
                in the project" looks identical wherever the player reads it. */}
            <div
              className={styles.headerPhases}
              data-intro-group="intro2"
              data-title="Phase Bar"
              data-intro="This is the phase bar - the same lifecycle breadcrumb you'll see in every header. It shows which of the five MLOps phases you're in, and that the game is a spiral: after the last one, it loops back to the first, forever, undefeated by closure. You don't act on it directly, but it's worth a glance whenever you're deciding how much time to sink into this round versus moving on - there's always another phase coming, ready or not."
              data-step="1"
              data-position="bottom-middle-aligned"
            >
              <PhaseOverview />
            </div>
            <div className="d-flex align-items-center gap-2">
              {phases && phases.length > 0 && (
                <span className={styles.phaseBadge}>
                  Phase {displayPhaseNumber} of {totalPlayablePhases}
                </span>
              )}
              {/* Hidden on a review reopen: the dossier behind this already has its own
                  Settings and Cheat Sheet buttons, so a second pair here would be redundant. */}
              {!isReview && (
                <>
                  {onSettingsToggle && (
                    <button
                      type="button"
                      className={`${styles.dashboardLink} ${isSettingsOpen ? styles.dashboardLinkActive : ""}`}
                      onClick={onSettingsToggle}
                      title={isSettingsOpen ? "Close settings" : "Open settings"}
                    >
                      <Icon icon="ph:gear-six-bold" />
                      <span>Settings</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.dashboardLink}
                    onClick={() => setIsCheatSheetOpen(true)}
                    title="Cheat Sheet"
                  >
                    <Icon icon="ph:question-bold" />
                    <span>Cheat Sheet</span>
                  </button>
                </>
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
                <div
                  className={styles.missionCard}
                  data-intro-group="intro2"
                  data-title="Phase Objectives"
                  data-intro="This is the phase description: what this phase is about, and the objectives you're expected to deliver on before moving to the next one. Keep them in mind while you dig through intel and pitch - they're what your proposal actually gets judged against; being well-liked is a nice bonus, not a substitute."
                  data-step="2"
                >
                  <div className={styles.missionCardHeader}>
                    <Icon icon="ph:target-bold" />
                    <span>{currentPhaseData?.phase_name || `Phase ${displayPhaseNumber}`}</span>
                    {/* Narrator controls for the phase/challenge reading above the radar. Stop
                        only while it's actually playing; Play again works whenever there's
                        something to read and narration isn't globally muted (mirrors the
                        per-utterance controls in offline intel gathering). */}
                    {!settings.mute_tts && buildBriefingNarration() && (
                      <span className={styles.briefingNarrationControls}>
                        {isNarratingBriefing && !hasBriefingAudioStarted && (
                          <Icon
                            icon="ph:circle-notch-bold"
                            className={styles.briefingNarrationLoading}
                            aria-hidden="true"
                          />
                        )}
                        {isNarratingBriefing && (
                          <button
                            type="button"
                            onClick={stopBriefingNarration}
                            className={`${styles.briefingNarrationButton} ${styles.briefingNarrationButtonPulsing}`}
                            title="Stop"
                            aria-label="Stop"
                          >
                            <Icon icon="ph:stop-circle-bold" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={replayBriefingNarration}
                          className={styles.briefingNarrationButton}
                          title="Play again"
                          aria-label="Play again"
                        >
                          <Icon icon="ph:arrow-clockwise-bold" />
                        </button>
                      </span>
                    )}
                  </div>
                  <div className={styles.missionCardBody}>
                    {currentPhaseData?.phase_introduction && (
                      <p className={styles.missionIntro}>
                        <SpokenText
                          text={currentPhaseData.phase_introduction}
                          activeSentenceIndex={isNarratingBriefing ? activeSentenceIndex : null}
                          renderSentence={(sentence) => (
                            <GlossaryText text={sentence} surface="challenge_briefing" />
                          )}
                        />
                      </p>
                    )}
                    <div className={styles.objectivesBox}>
                      <span className={styles.objectivesLabel}>
                        <Icon icon="ph:flag-checkered-bold" />
                        Phase Objectives
                      </span>
                      <GlossaryText
                        as="p"
                        className={styles.objectivesText}
                        text={
                          currentPhaseData?.phase_desc ||
                          "Enter this phase to address new project requirements and align with key stakeholders."
                        }
                        surface="challenge_briefing"
                      />
                    </div>
                  </div>
                </div>

                {/* Minimized Challenge Briefing: the current challenge's story, excluding the stakeholder-specific breakdown */}
                {challengeTitle && (
                  <div
                    data-intro-group="intro2"
                    data-title="This Round's Challenge"
                    data-intro="This is the challenge description: the specific situation you're dropped into this round, and why the stakeholders don't agree about it. Whatever you pitch later has to actually resolve that disagreement, not just please one side of it - reread it if you have to, nobody's timing you."
                    data-step="3"
                  >
                    <ChallengeDescriptionCard
                      challengeTitle={challengeTitle}
                      challengeDescription={challengeDescription}
                      challengeIntro={challengeIntro}
                      currentChallenge={currentChallenge}
                      challengeAmount={challengeAmount}
                      is_minimized={true}
                      isNew={isNewChallenge}
                      activeSentenceIndex={isNarratingBriefing ? challengeSentenceIndex : null}
                    />
                  </div>
                )}
              </div>

              {/* Right Column: Stakeholder Matrix */}
              <div
                className={styles.matrixColumn}
                data-intro-group="intro2"
                data-title="Power & Interest Radar"
                data-intro="This is the power/interest radar. High power, high interest stakeholders go in 'Manage Closely' - track them down first once you start gathering intel. The others still matter, they just won't sink your pitch if you get to them second, a fact they have made their peace with."
                data-step="4"
              >
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
                  // wasReviewRef, not the live isReview prop: the reopened-from-dossier overlay
                  // never unmounts on close (it just toggles a CSS class), and the parent flips
                  // isReview back to false the instant it closes - reading it live here would
                  // restart the whole introduction round on close, since the effect that seeds
                  // introState depends on this prop.
                  autoPlayIntroductions={!wasReviewRef.current && !settings.auto_skip_conversations && introsUnlocked}
                />
              </div>
            </div>

            {/* Footer with hint and action button */}
            <div className={styles.footer}>
              <div className={styles.footerHint}>
                <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
                <span>
                  You can review this stakeholder matrix anytime. Each phase feeds the next, and
                  the last one feeds the next iteration: MLOps is a spiral, not a checklist.
                </span>
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
          <CheatSheetModal
            isOpen={isCheatSheetOpen}
            onClose={() => setIsCheatSheetOpen(false)}
            activeSectionTitle="Briefing"
          />
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
          className={styles.pageWrapper}
        >
          {panelContent}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
