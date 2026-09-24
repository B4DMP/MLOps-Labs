import { useContext } from "react";
import HoverTooltip from "./HoverToolTip";
import { StakeholderContext } from "./StakeholderProvider";
import { PhasesContext } from "./PhaseProvider";
import styles from "./ChallengeDescriptionCard.module.css";
import GlossaryText from "./glossary/GlossaryText";
import SpokenText from "./SpokenText";
import { splitSentences } from "../utils/speech";

export function parseChallengeDescription(description?: string) {
  if (!description) return [];
  const parts = description.split(/(#[^#]+#|\{[^{}]+\})/);
  return parts
    .map((part) => {
      if (
        (part.startsWith("#") && part.endsWith("#")) ||
        (part.startsWith("{") && part.endsWith("}"))
      ) {
        return { type: "id" as const, value: part.slice(1, -1).trim() };
      }
      return { type: "text" as const, value: part };
    })
    .filter((part) => part.value !== "");
}

/**
 * Tracks how many distinct challenges the player has traversed for a given phase
 * in this playthrough session.
 */
function getTraversedChallengesCount(phase: number, challengeId: number | string): number {
  if (typeof window === "undefined" || !window.sessionStorage) return 1;
  try {
    if (phase === 0) {
      for (let i = 1; i <= 10; i++) {
        window.sessionStorage.removeItem(`mlops_phase_${i}_challenges`);
      }
    }
    const key = `mlops_phase_${phase}_challenges`;
    const raw = window.sessionStorage.getItem(key);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const idStr = String(challengeId);
    if (!list.includes(idStr)) {
      list.push(idStr);
      window.sessionStorage.setItem(key, JSON.stringify(list));
    }
    return list.length;
  } catch {
    return 1;
  }
}

export interface ChallengeDescriptionCardProps {
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  currentChallenge?: number;
  challengeAmount?: number;
  traversedChallenges?: number;
  is_minimized?: boolean;
  /**
   * Marks this challenge as newly introduced so the card can draw the player's
   * attention (e.g. a "NEW" tag). Not wired up to any game logic yet.
   *
   * Intended future use: PrePhaseDialog is only reopened automatically on a
   * phase transition, but a phase can contain multiple challenges in
   * sequence (see Game.tsx `currentChallenge`). When the dialog is shown
   * again for a later challenge within the *same* phase, set this to true so
   * players don't mistake the briefing for one they've already read. A
   * caller can derive it by comparing the challenge id shown against the
   * last one the player has seen (e.g. a ref/state similar to
   * `prevShownPhaseRef` in Game.tsx, but tracking `currentChallenge`).
   */
  isNew?: boolean;
  /** Which sentence of "title. intro" (PrePhaseDialog's own narration pass, see
   *  `buildBriefingNarration`) is playing right now - negative while phase_introduction is still
   *  being read (nothing here yet), then 0-based across the title and intro once it's their turn.
   *  Null whenever nothing is being narrated at all (muted, finished, review reopen). */
  activeSentenceIndex?: number | null;
}

export default function ChallengeDescriptionCard({
  challengeTitle = "",
  challengeDescription = "",
  challengeIntro = "",
  currentChallenge = 0,
  challengeAmount = 1,
  traversedChallenges,
  is_minimized = true,
  isNew = false,
  activeSentenceIndex = null,
}: ChallengeDescriptionCardProps) {
  const { stakeholders } = useContext(StakeholderContext);
  const { phases, currentPhase } = useContext(PhasesContext);

  const currentPhaseData =
    phases?.find((p) => p.id === currentPhase) || phases?.[currentPhase];

  const totalChallengeCount =
    currentPhaseData?.challenge_quota ??
    currentPhaseData?.challenges_per_phase ??
    (challengeAmount && challengeAmount > 0 && challengeAmount < 20 ? challengeAmount : 1);

  const traversedCount =
    traversedChallenges ??
    getTraversedChallengesCount(currentPhase, currentChallenge);

  const displayChallengeNumber = Math.min(
    Math.max(1, traversedCount),
    totalChallengeCount
  );

  // Same split PrePhaseDialog's `buildBriefingNarration` implicitly makes by joining
  // "title. intro" into one narration pass - the title always reads as its own sentence(s)
  // first, then the intro's own sentences follow at this offset.
  const titleSentenceCount = splitSentences(challengeTitle)
    .map((s) => s.trim())
    .filter(Boolean).length;
  const isTitleActive =
    activeSentenceIndex != null && activeSentenceIndex >= 0 && activeSentenceIndex < titleSentenceCount;
  const introActiveSentenceIndex =
    activeSentenceIndex != null ? activeSentenceIndex - titleSentenceCount : null;

  const renderFormattedText = (text: string) => {
    const tokens = parseChallengeDescription(text);
    return tokens.map((item, index) => {
      if (item.type === "text") {
        return (
          <GlossaryText
            key={index}
            as="span"
            text={item.value}
            surface="challenge_briefing"
          />
        );
      } else if (item.type === "id") {
        const st =
          stakeholders[item.value] ||
          Object.values(stakeholders || {}).find(
            (s: any) => s.id === item.value || s.name === item.value
          );

        if (!st) {
          return <span key={index}>{item.value}</span>;
        }

        const stColor =
          st.stakeholder_color?.startsWith("#")
            ? st.stakeholder_color
            : st.stakeholder_color
            ? `#${st.stakeholder_color}`
            : "#38bdf8";

        const highlightSpan = (
          <span
            className={styles.stakeholderHighlight}
            style={
              {
                color: stColor,
                "--stakeholder-color": stColor,
              } as React.CSSProperties
            }
          >
            {st.name}
          </span>
        );

        if (st.role_description) {
          return (
            <HoverTooltip key={index} description={st.role_description}>
              {highlightSpan}
            </HoverTooltip>
          );
        }

        return <span key={index}>{highlightSpan}</span>;
      }
      return null;
    });
  };

  return (
    <div
      className={`card shadow-sm w-100 rounded-2 position-relative ${styles.challengeCard}`}
    >
      {isNew && (
        <span className={`badge position-absolute ${styles.newBadge}`}>
          NEW
        </span>
      )}
      <div
        className={`card-header py-1 px-3 d-flex align-items-center justify-content-center gap-2 ${styles.cardHeader}`}
      >
        <span className={`fw-bold ${styles.cardTitle}`}>
          {challengeTitle}
          {isTitleActive && <span className={styles.titleCaret} aria-hidden="true" />}
        </span>
        <span className={`badge ${styles.counterBadge}`}>
          Challenge {displayChallengeNumber}/{totalChallengeCount}
        </span>
      </div>
      <div className="card-body bg-white text-dark py-2 px-3">
        {challengeIntro && (
          <p
            className={`card-text text-center ${styles.introText} ${
              is_minimized
                ? `text-dark mb-0 ${styles.introMinimized}`
                : `text-secondary mb-1 ${styles.introExpanded}`
            }`}
          >
            {activeSentenceIndex != null ? (
              <SpokenText
                text={challengeIntro}
                activeSentenceIndex={introActiveSentenceIndex}
                renderSentence={(sentence) => renderFormattedText(sentence)}
              />
            ) : (
              renderFormattedText(challengeIntro)
            )}
          </p>
        )}
        {!is_minimized && challengeDescription && (
          <p className={`card-text text-center text-dark mb-0 ${styles.descriptionText}`}>
            {renderFormattedText(challengeDescription)}
          </p>
        )}
      </div>
    </div>
  );
}
