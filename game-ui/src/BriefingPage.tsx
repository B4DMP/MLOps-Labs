import { useEffect, useRef, useState } from "react";
import type { Briefing } from "./types/Briefing";
import { Icon } from "@iconify/react";
import { Player } from "@lordicon/react";
import truckIcon from "./components/Results/icons/truck.json";
import { useSettings } from "./components/SettingsProvider";
import { useSpeech } from "./components/useSpeech";
import { cancelSpeech } from "./utils/speech";
import SpokenText from "./components/SpokenText";
import GlossaryText from "./components/glossary/GlossaryText";
import { StakeholderAvatarComponent } from "./components/StakeholderAvatarComponent";
import type { StakeholderAvatar } from "./types/StakeholderAvatar";
import styles from "./BriefingPage.module.css";

interface BriefingProps {
  onBriefingCompleted: () => void;
  briefing: Briefing;
}

/**
 * The player's onboarding guide - deliberately not one of the six stakeholders the player will
 * actually negotiate with later, so a returning player never mistakes this briefing for one of
 * their standing relationships. Gray hair reads as an experienced hand showing someone the ropes.
 * The clothing color sits outside OPEN_PEEPS_CLOTHING_PALETTE on purpose, the same way this
 * avatar sits outside the roster.
 */
const NARRATOR_NAME = "Program Director Moreau";
const NARRATOR_AVATAR: StakeholderAvatar = {
  head: "grayShort",
  face: "smile",
  emotion: "smile",
  accessories: "glasses",
  accessoriesProbability: 100,
  clothingColor: "6b95a8",
  headContrastColor: "3f3f46",
  backgroundColor: "e2e8f0",
};

/**
 * Truck's own "loop-cycle" state, replayed on every completion - @lordicon/react's Player has no
 * built-in loop trigger, just play()/onComplete, so continuous motion means driving that loop by
 * hand. The header keeps this small ambient flourish; the avatar below is the page's actual hero.
 */
function HeaderIcon() {
  const ref = useRef<Player>(null);

  useEffect(() => {
    ref.current?.playFromBeginning();
  }, []);

  return (
    <Player
      ref={ref}
      icon={truckIcon}
      state="loop-cycle"
      onComplete={() => ref.current?.playFromBeginning()}
    />
  );
}

export default function BriefingPage({
  onBriefingCompleted,
  briefing,
}: BriefingProps) {
  const { settings } = useSettings();
  const { speak: speakTts } = useSpeech();

  const text = briefing.briefing_description || "";

  const [isNarrating, setIsNarrating] = useState(false);
  const [hasAudioStarted, setHasAudioStarted] = useState(false);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const cancelRef = useRef<() => void>(() => {});

  const startNarration = () => {
    if (!text) return;
    cancelRef.current();
    setIsNarrating(true);
    setHasAudioStarted(false);
    setActiveSentenceIndex(null);
    cancelRef.current = speakTts(text, {
      slot: "narrator",
      onSentence: ({ index }) => {
        setHasAudioStarted(true);
        setActiveSentenceIndex(index);
      },
      onEnd: () => {
        setIsNarrating(false);
        setHasAudioStarted(false);
        setActiveSentenceIndex(null);
      },
    });
  };

  const stopNarration = () => {
    cancelRef.current();
    setIsNarrating(false);
    setHasAudioStarted(false);
    setActiveSentenceIndex(null);
  };

  // Auto-narrates once on arrival, same as PrePhaseDialog's phase introduction - skipped
  // entirely when the player has auto-skip on, so it never queues audio nobody asked for.
  useEffect(() => {
    if (!text || settings.auto_skip_conversations) return;
    startNarration();
    return () => cancelRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, settings.auto_skip_conversations]);

  useEffect(() => () => cancelSpeech(), []);

  const handleContinue = () => {
    cancelSpeech();
    onBriefingCompleted();
  };

  const isSpeaking = isNarrating && hasAudioStarted;

  return (
    <div className={styles.wrapper}>
      <div className={`card shadow-lg border-0 rounded-4 overflow-hidden ${styles.panel}`}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <span className={styles.headerIcon} aria-hidden="true">
              <HeaderIcon />
            </span>
            <div>
              <p className={styles.headerEyebrow}>Mission Briefing</p>
              <h2 className={styles.headerTitle}>{briefing.briefing_title}</h2>
            </div>
          </div>

          {/* Narrator controls, mirroring PrePhaseDialog's stop/repeat pair */}
          {!settings.mute_tts && text && (
            <span className={styles.narrationControls}>
              {isNarrating && !hasAudioStarted && (
                <Icon
                  icon="ph:circle-notch-bold"
                  className={styles.narrationLoading}
                  aria-hidden="true"
                />
              )}
              {isNarrating && (
                <button
                  type="button"
                  onClick={stopNarration}
                  className={`${styles.narrationButton} ${styles.narrationButtonPulsing}`}
                  title="Stop"
                  aria-label="Stop"
                >
                  <Icon icon="ph:stop-circle-bold" />
                </button>
              )}
              <button
                type="button"
                onClick={startNarration}
                className={styles.narrationButton}
                title="Play again"
                aria-label="Play again"
              >
                <Icon icon="ph:arrow-clockwise-bold" />
              </button>
            </span>
          )}
        </div>

        {/* Body */}
        <div className={styles.body}>
          <div className={styles.briefingLayout}>
            {/* Hero image: the onboarding guide, mouth animating while their narration plays */}
            <div className={styles.speakerColumn}>
              <div className={styles.speakerPortrait}>
                <StakeholderAvatarComponent
                  avatar={NARRATOR_AVATAR}
                  isFramed={false}
                  isSpeaking={isSpeaking}
                  play_blink_animation
                  hoverToSuspicious={false}
                  size="100%"
                  title={NARRATOR_NAME}
                />
              </div>
              <p className={styles.speakerName}>{NARRATOR_NAME}</p>
            </div>

            {text && (
              <p className={styles.briefingText}>
                <SpokenText
                  text={text}
                  activeSentenceIndex={isNarrating ? activeSentenceIndex : null}
                  renderSentence={(sentence) => (
                    <GlossaryText text={sentence} surface="challenge_briefing" />
                  )}
                />
              </p>
            )}
          </div>

          {/* Actions */}
          <div className={styles.actionArea}>
            <button
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton}`}
              onClick={handleContinue}
            >
              <span>Continue</span>
              <Icon icon="ph:arrow-right-bold" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
