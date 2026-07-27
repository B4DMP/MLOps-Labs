import type { ActionCard } from "../types/ActionCard";
import ActionCardComponent from "./ActionCardComponent";
import styles from "./AcRevealPanel.module.css";

interface AcRevealPanelProps {
  last_ac: ActionCard;
  current_phase: number;
  goToNextChallenge: () => void;
}

export default function AcRevealPanel({
  last_ac,
  current_phase,
  goToNextChallenge,
}: AcRevealPanelProps) {
  return (
    <div
      className={`d-flex flex-column align-items-center justify-content-center text-center text-white p-4 ${styles.revealOverlay}`}
    >
      <h2 className="mb-4 fw-bold">Action Card Played!</h2>
      <p className="mb-4">You chose to play the following action card:</p>
      <div
        className={`mb-4 ${styles.cardWrapper} intro6`}
        data-intro-group="intro6"
        data-step="1"
        data-intro="Now the action card's values are revealed."
      >
        <ActionCardComponent
          ac={last_ac}
          current_phase={current_phase}
          highlight={false}
          id="revealCard"
          showValues={true}
          displayMetrics={true}
          interactable={false}
          hasDropIndicator={false}
        />
      </div>
      <p className="mb-4">The metrics have changed accordingly.</p>
      <button
        onClick={goToNextChallenge}
        className={`btn btn-primary btn-lg px-5 rounded shadow ${styles.continueButton} intro6`}
        data-intro-group="intro6"
        data-step="3"
        data-intro="Thank you for playing through the introduction! Now the actual game begins."
      >
        Continue
      </button>
    </div>
  );
}
