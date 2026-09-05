import { useContext } from "react";
import HoverTooltip from "./HoverToolTip";
import { StakeholderContext } from "./StakeholderProvider";
import { PhasesContext } from "./PhaseProvider";
import styles from "./ChallengeDescriptionCard.module.css";

export function parseChallengeDescription(description?: string) {
  if (!description) return [];
  const parts = description.split(/(#[^#]+#|\{[^{}]+\})/);
  return parts
    .map((part) => {
      if (
        (part.startsWith("#") && part.endsWith("#")) ||
        (part.startsWith("{") && part.endsWith("}"))
      ) {
        return { type: "id", value: part.slice(1, -1) };
      }
      return { type: "text", value: part };
    })
    .filter((part) => part.value !== "");
}

export interface ChallengeDescriptionCardProps {
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  currentChallenge?: number;
  challengeAmount?: number;
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
}

export default function ChallengeDescriptionCard({
  challengeTitle = "",
  challengeDescription = "",
  challengeIntro = "",
  currentChallenge = 0,
  challengeAmount = 1,
  is_minimized = true,
  isNew = false,
}: ChallengeDescriptionCardProps) {
  const { stakeholders } = useContext(StakeholderContext);
  const { phases } = useContext(PhasesContext);
  const totalChallengeCount =
    phases && phases.length > 0 ? phases.length : challengeAmount;
  const challenge_desc_cutted = parseChallengeDescription(challengeDescription);

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
        </span>
        <span className={`badge ${styles.counterBadge}`}>
          Challenge {currentChallenge + 1}/{totalChallengeCount}
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
            {challengeIntro}
          </p>
        )}
        {!is_minimized && (
          <p className={`card-text text-center text-dark mb-0 ${styles.descriptionText}`}>
            {challenge_desc_cutted.map((item, index) => {
              if (item.type === "text") {
                return <span key={index}>{item.value}</span>;
              } else if (item.type === "id") {
                const st = Object.values(stakeholders || {}).find(
                  (s: any) => s.id === item.value || s.name === item.value
                );
                if (!st) return <span key={index}>{item.value}</span>;
                return (
                  <HoverTooltip key={index} description={st.role_description}>
                    <span
                      className={styles.stakeholderHighlight}
                      style={
                        {
                          "--stakeholder-color": st.stakeholder_color,
                        } as React.CSSProperties
                      }
                    >
                      {st.name}
                    </span>
                  </HoverTooltip>
                );
              }
              return null;
            })}
          </p>
        )}
      </div>
    </div>
  );
}
